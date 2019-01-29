/************************************************************************/
/* FILE:                DMAppTvEmuController.js                         */
/* DESCRIPTION:         DMApp TV emulator controller                    */
/* VERSION:             (see git)                                       */
/* DATE:                (see git)                                       */
/* AUTHOR:              Jonathan Rennison <jonathan.rennison@bt.com>    */
/*                                                                      */
/*                      © British Telecommunications plc 2018           */
/*                                                                      */
/* Licensed under the Apache License, Version 2.0 (the "License");      */
/* you may not use this file except in compliance with the License.     */
/* You may obtain a copy of the License at                              */
/*                                                                      */
/*   http://www.apache.org/licenses/LICENSE-2.0                         */
/*                                                                      */
/* Unless required by applicable law or agreed to in writing, software  */
/* distributed under the License is distributed on an "AS IS" BASIS,    */
/* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or      */
/* implied.                                                             */
/* See the License for the specific language governing permissions and  */
/* limitations under the License.                                       */
/************************************************************************/

"use strict";

const DMAppClientLib = require('DMAppClientLib');
const ReconnectingWebSocket = require("reconnectingwebsocket");

const defaultServerUrl = "ws://127.0.0.1:7692";
const defaultAppEndpoint = "eu.2-immerse";

/**
 * @classdesc
 *
 * TV emulator discovery server control and app2app functionality.
 * App2app is not started on construction.
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {?Object} options optional options object
 * @param {string} [options.serverUrl=ws://127.0.0.1:7692] override tvemu discovery/app2app server URL
 */
function DMAppTvEmuController(dMAppController, options) {
	const self = this;
	if (!options) options = {};
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DMAppTvEmuController") });
	Object.defineProperty(self, 'app2appSockets',  { value: new Set() });
	Object.defineProperty(self, 'listenerTracker', { value: new DMAppClientLib.deps.listenerTracker.createTracker() });
	Object.defineProperty(self, '_wsStateOks',     { value: {} });
	Object.defineProperty(self, '_presenceTimers', { value: new Map() });
	this._auxData = null;
	Object.defineProperty(self, '_auxDataMap',     { value: new Map() });

	this.logger.info("DMAppTvEmuController version: " + require('__VERSION__'));

	this._app2appEnabled = false;

	if (DMAppTvEmuController._debugConstructorHooks.length) {
		/* global console */
		console.warn("Executing " + DMAppTvEmuController._debugConstructorHooks.length + " DMAppTvEmuController debug constructor hooks");
		if (!options) options = {};
		for (let i = 0; i < DMAppTvEmuController._debugConstructorHooks.length; i++) {
			DMAppTvEmuController._debugConstructorHooks[i](this, options);
		}
	}

	Object.defineProperty(self, 'serverUrl',       { value: options.serverUrl || defaultServerUrl });

	DMAppClientLib.argCheck(arguments, 2, self.logger, "DMAppTvEmuSync DMAppTvEmuController", options, ['serverUrl', 'disabled']);

	Object.defineProperty(self, 'disabled',        { value: !!options.disabled });
	if (options.disabled) {
		this.logger.warn("Disabled by constructor option");
		return;
	}

	const ws = new ReconnectingWebSocket(self.serverUrl + "/control", [], {
		reconnectInterval: 500,
		reconnectDecay: 2,
		maxReconnectInterval: 30000,
	});
	Object.defineProperty(self, 'ws',              { value: ws });

	self.controlErrorCounter = self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "TV emulator control websocket error(s)");
	self.app2appErrorCounter = self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "App2app websocket error(s)");

	self.wsConnected = false;
	self.ws.addEventListener("open", function() {
		self.logger.info("TV emulator control websocket open");
		self.controlErrorCounter.flush();
		self.wsConnected = true;
		self.ws.send(self.getInstanceIdMsg());
		self.ws.send(self.getDeviceIdMsg());
		self.ws.send(self.getContextIdMsg());
		self.ws.send(self.getInterContextIdMsg());
		self.ws.send(self.getSessionIdMsg());
		for (let [k, v] of self._auxDataMap) {
			if (v != null) self.ws.send(self.getSetAuxDataKeyMsg(k, v));
		}
		self._setWsOkState("Control", true);
	});
	self.ws.addEventListener("close", function() {
		self.logger.error("TV emulator control websocket close");
		self.wsConnected = false;
		self._setWsOkState("Control", false);
	});
	self.ws.addEventListener("error", function() {
		self.controlErrorCounter.event();
		self.wsConnected = false;
		self._setWsOkState("Control", false);
	});
	self.listenerTracker.subscribeTo(self.dMAppController.layout).on("contextChange", function(info) {
		if (self.wsConnected) self.ws.send(self.getContextIdMsg());
		self.app2appBroadcastSend(self.getContextIdMsg());
	});
	self.listenerTracker.subscribeTo(self.dMAppController.layout).on("dmAppChange", function(info) {
		self.app2appBroadcastSend(self.getDmAppIdMsg());
	});
	self.listenerTracker.subscribeTo(self.dMAppController.layout._interCtxIdSignal).on("change", function(info) {
		if (self.wsConnected) self.ws.send(self.getInterContextIdMsg());
		self.app2appBroadcastSend(self.getInterContextIdMsg());
	});
	self.listenerTracker.subscribeTo(self.dMAppController._sessionIdSignal).on("change", function(info) {
		if (self.wsConnected) self.ws.send(self.getSessionIdMsg());
		self.app2appBroadcastSend(self.getSessionIdMsg());
	});
	self.listenerTracker.subscribeTo(self.dMAppController._modeSignal).on("change", function(info) {
		self.app2appBroadcastSend(self.getModeSignalMsg());
	});
	self.listenerTracker.subscribeTo(self.dMAppController.localDevGroupErrorSummary).on("change", function(info) {
		self.app2appBroadcastSend(self.getLocalDevGroupErrorSummarySignalMsg());
	});
	self.listenerTracker.subscribeTo(window).on("beforeunload", function() {
		self.controlErrorCounter.flush();
		self.app2appErrorCounter.flush();
	});
}

DMAppTvEmuController.prototype.getInstanceIdMsg = function() {
	return JSON.stringify({
		type: 'instance',
		value: this.dMAppController.instanceId,
	});
};

DMAppTvEmuController.prototype.getDeviceIdMsg = function() {
	return JSON.stringify({
		type: 'device',
		value: this.dMAppController.getDeviceId(),
	});
};

DMAppTvEmuController.prototype.getContextIdMsg = function() {
	return JSON.stringify({
		type: 'context',
		value: this.dMAppController.layout.contextId,
	});
};

DMAppTvEmuController.prototype.getInterContextIdMsg = function() {
	return JSON.stringify({
		type: 'interContext',
		value: this.dMAppController.layout.interContextId,
	});
};

DMAppTvEmuController.prototype.getSessionIdMsg = function() {
	return JSON.stringify({
		type: 'session',
		value: this.dMAppController.sessionId,
	});
};

DMAppTvEmuController.prototype.getModeSignalMsg = function() {
	return JSON.stringify({
		type: 'setMode',
		value: this.dMAppController._modeSignal.getValue(),
	});
};

DMAppTvEmuController.prototype.getLocalDevGroupErrorSummarySignalMsg = function() {
	return JSON.stringify({
		type: 'localDevGroupErrorSummary',
		value: this.dMAppController.localDevGroupErrorSummary.getValue(),
	});
};

DMAppTvEmuController.prototype.getDmAppIdMsg = function() {
	return JSON.stringify({
		type: 'dmApp',
		value: this.dMAppController.layout.dmAppId,
	});
};

DMAppTvEmuController.prototype.getServiceUrlsMsg = function() {
	return JSON.stringify({
		type: 'serviceUrls',
		value: this.dMAppController._urls,
	});
};

DMAppTvEmuController.prototype.getSetAuxDataMsg = function() {
	return JSON.stringify({
		type: 'setAllAuxData',
		value: this._auxData,
	});
};

DMAppTvEmuController.prototype.getSetAuxDataKeyMsg = function(k, v) {
	return JSON.stringify({
		type: 'setAuxData',
		key: k,
		value: JSON.stringify(v),
	});
};

DMAppTvEmuController.prototype._updateErrorSummary = function(deviceId, instanceId, summary) {
	const state = this.dMAppController.localDevGroupErrorSummary.getValue() || {};
	const key = deviceId + ':' + instanceId;
	if (!summary || !summary.length) {
		delete state[key];
	} else {
		state[key] = summary;
	}
	this.dMAppController.localDevGroupErrorSummary._change(state);
};

DMAppTvEmuController.prototype.setAuxData = function(data) {
	this._auxData = data;
	for (let k of this._auxDataMap.keys()) {
		this._auxDataMap.set(k, undefined);
	}
	if (data) {
		for (let k in data) {
			this._auxDataMap.set(k, data[k]);
		}
	}
	if (this.wsConnected) {
		for (let [k, v] of this._auxDataMap) {
			this.ws.send(this.getSetAuxDataKeyMsg(k, v));
		}
	}
	this.app2appBroadcastSend(this.getSetAuxDataMsg());
};

/**
 * Start app2app functionality if not already started
 * @param {string} [appEndpoint=eu.2-immerse]
 */
DMAppTvEmuController.prototype.startApp2App = function(appEndpoint) {
	if (this.disabled) return;
	if (this._app2appEnabled) return;
	this._app2appEnabled = true;
	this._app2appSetup(appEndpoint || defaultAppEndpoint);
	this.dMAppController.app2appMsgBusCtl.setMaster(true);
	this.dMAppController.app2appMsgBusCtl.setEnabled(true);

	const localErrorSummary = this.dMAppController.getErrorSignalSummarySignal();
	const updateLocal = function() {
		this._updateErrorSummary(this.dMAppController.getDeviceId(), this.dMAppController.instanceId, localErrorSummary.getValue());
	}.bind(this);
	this.listenerTracker.subscribeTo(localErrorSummary).on("change", updateLocal);
};

/** Stop app2app functionality if not already stopped */
DMAppTvEmuController.prototype.stopApp2App = function() {
	if (!this._app2appEnabled) return;
	this._app2appEnabled = false;
	this._setWsOkState("App2app", true);
	if (this._currentApp2App) {
		this._currentApp2App.close();
	}
	for (let sock of this.app2appSockets) {
		sock.close();
	}
	this.dMAppController.app2appMsgBusCtl.setEnabled(false);
	this.listenerTracker.removeAllListeners(this.dMAppController.getErrorSignalSummarySignal());
	this.dMAppController.localDevGroupErrorSummary._change(null);
};

DMAppTvEmuController.prototype._app2appSetup = function(appEndpoint, retryCount) {
	if (!this._app2appEnabled) return;
	if (!retryCount) retryCount = 0;
	const self = this;
	const socket = new WebSocket(this.serverUrl + "/app2app/local/" + appEndpoint);
	this._currentApp2App = socket;
	let paired = false;
	let app2appSync;
	let deviceId = '';
	const signalSubscriptionListenerTracker = DMAppClientLib.deps.listenerTracker.createTracker();
	const activeMergedPerDeviceSignals = new Map();
	const activeMergedPerDeviceRCSignals = new Map();

	const mpdSubscribe = function(msg, activeMap, mergedMap, messageType) {
		for (let i = 0; i < msg.keys.length; i++) {
			const key = msg.keys[i];
			if (activeMap.has(key)) {
				self.logger.warn("Duplicate merged per device signal subscription attempt, ignoring: " + key);
				continue;
			}
			const info = mergedMap.getSignal(key);
			activeMap.set(key, info);
			info.signal.onImmediate("change", function() {
				socket.send(JSON.stringify({
					type: messageType,
					key: key,
					value: info.signal.getValue(),
				}));
			}, signalSubscriptionListenerTracker);
		}
	};

	const mpdUnsubscribe = function(msg, activeMap) {
		for (let i = 0; i < msg.keys.length; i++) {
			const key = msg.keys[i];
			const info = activeMap.get(key);
			if (!info) {
				self.logger.warn("Unexpected merged per device signal unsubscription attempt, ignoring: " + key);
				continue;
			}
			signalSubscriptionListenerTracker.removeAllListeners(info.signal);
			info.unref();
			activeMap.delete(key);
		}
	};

	const processApp2AppMsg = function(msg) {
		try {
			if (msg.type === "device") {
				deviceId = msg.value;
				self.dMAppController.app2appMsgBusCtl.setDeviceIdWebsocket(deviceId, socket);

				const timerId = self._presenceTimers.get(deviceId);
				if (timerId != null) {
					window.clearTimeout(timerId);
					self._presenceTimers.delete(deviceId);
				}
			} else if (msg.type === "instance") {
				const info = self.dMAppController.app2appMsgBusCtl._getSocketMetadata(socket, true);
				info.instanceId = msg.value;
			} else if (msg.type === "remoteAddr") {
				const info = self.dMAppController.app2appMsgBusCtl._getSocketMetadata(socket, true);
				info.remoteAddress = msg.address;
				info.remotePort = msg.port;
			} else if (msg.type === "app2appSyncCtl") {
				if (msg.sync && !app2appSync) {
					app2appSync = new App2AppSyncServer(self.dMAppController, socket, deviceId);
				} else if (!msg.sync && app2appSync) {
					app2appSync.destroy();
					app2appSync = null;
				}
			} else if (msg.type === "app2appMsgBus") {
				self.dMAppController.app2appMsgBusCtl.recv(msg);
			} else if (msg.type === "errorSummary") {
				const info = self.dMAppController.app2appMsgBusCtl._getSocketMetadata(socket, true);
				self._updateErrorSummary(deviceId, info.instanceId, msg.value);
			} else if (msg.type === "subscribeSharedSignals") {
				for (let i = 0; i < msg.keys.length; i++) {
					const key = msg.keys[i];
					const signal = self.dMAppController._sharedSignalStorage.getSignal(key);
					signal.onImmediate("change", function() {
						socket.send(JSON.stringify({
							type: 'sharedSignalChange',
							key: key,
							value: signal.getValue(),
						}));
					}, signalSubscriptionListenerTracker);
				}
			} else if (msg.type === "unsubscribeSharedSignals") {
				for (let i = 0; i < msg.keys.length; i++) {
					const signal = self.dMAppController._sharedSignalStorage.getSignal(msg.keys[i]);
					signalSubscriptionListenerTracker.removeAllListeners(signal);
				}
			} else if (msg.type === "subscribeMergedPerDeviceSignals") {
				mpdSubscribe(msg, activeMergedPerDeviceSignals, self.dMAppController._perDeviceSignalMerged, 'mergedPerDeviceSignalChange');
			} else if (msg.type === "subscribeMergedPerDeviceRCSignals") {
				mpdSubscribe(msg, activeMergedPerDeviceRCSignals, self.dMAppController._perDeviceRCSignalMerged, 'mergedPerDeviceRCSignalChange');
			} else if (msg.type === "unsubscribeMergedPerDeviceSignals") {
				mpdUnsubscribe(msg, activeMergedPerDeviceSignals);
			} else if (msg.type === "unsubscribeMergedPerDeviceRCSignals") {
				mpdUnsubscribe(msg, activeMergedPerDeviceRCSignals);
			} else if (msg.type === "setPerDeviceSignal" || msg.type === "setPerDeviceRCSignal") {
				const rc = msg.type === "setPerDeviceRCSignal";
				const perDeviceInfo = self.dMAppController._getPerDeviceSignalInfo(deviceId, rc);
				perDeviceInfo.values.set(msg.key, msg.value);
				self.dMAppController._updateMergedPerDeviceGenericSignal(msg.key, rc);
			} else if (msg.type === "setAllPerDeviceSignals" || msg.type === "setAllPerDeviceRCSignals") {
				const rc = msg.type === "setAllPerDeviceRCSignals";
				const perDeviceInfo = self.dMAppController._getPerDeviceSignalInfo(deviceId, rc);
				const oldValues = perDeviceInfo.values;
				perDeviceInfo.values = new Map();
				for (let i = 0; i < msg.signals.length; i++) {
					const k = msg.signals[i][0];
					const v = msg.signals[i][1];
					oldValues.delete(k);
					perDeviceInfo.values.set(k, v);
					self.dMAppController._updateMergedPerDeviceGenericSignal(k, rc);
				}
				for (let k of oldValues.keys()) self.dMAppController._updateMergedPerDeviceGenericSignal(k, rc);
			} else {
				self.logger.warn("Unexpected message from app2app websocket", msg);
			}
		} catch(e) {
			self.logger.error("Error in handling app2app websocket message; ", e, msg);
		}
	};

	socket.addEventListener("open", function() {
		self._setWsOkState("App2app", true);
		self.app2appErrorCounter.flush();
	});
	socket.addEventListener("message", function(msg) {
		if (!paired && msg.data === "pairingcompleted") {
			paired = true;
			delete self._currentApp2App;
			self.app2appSockets.add(socket);
			socket.send(self.getInstanceIdMsg());
			socket.send(self.getDeviceIdMsg());
			socket.send(self.getInterContextIdMsg());
			socket.send(self.getSessionIdMsg());
			socket.send(self.getContextIdMsg());
			socket.send(self.getDmAppIdMsg());
			socket.send(self.getServiceUrlsMsg());
			socket.send(self.getSetAuxDataMsg());
			if (self.dMAppController._modeSignal.getValue() !== undefined) {
				socket.send(self.getModeSignalMsg());
			}
			socket.send(self.getLocalDevGroupErrorSummarySignalMsg());
			self._app2appSetup(appEndpoint);
			return;
		}
		try {
			const msg = JSON.parse(event.data);
			if (Array.isArray(msg)) {
				for (let i = 0; i < msg.length; i++) {
					processApp2AppMsg(msg[i]);
				}
			} else {
				processApp2AppMsg(msg);
			}
		} catch(e) {
			self.logger.error("Error in handling app2app websocket message; ", e, event.data);
		}
	});
	const closeSocket = function() {
		signalSubscriptionListenerTracker.removeAllListeners();
		for (let info of activeMergedPerDeviceSignals.values()) {
			info.unref();
		}
		activeMergedPerDeviceSignals.clear();
		for (let info of activeMergedPerDeviceRCSignals.values()) {
			info.unref();
		}
		activeMergedPerDeviceRCSignals.clear();
		if (app2appSync) {
			app2appSync.destroy();
			app2appSync = null;
		}
		self.app2appSockets.delete(socket);
		if (socket === self._currentApp2App) {
			delete self._currentApp2App;
			if (self._app2appEnabled) {
				window.setTimeout(function() {
					self._app2appSetup(appEndpoint, retryCount + 1);
				}, Math.pow(2, Math.min(6, retryCount)) * 500);
			}
		}
		if (deviceId) {
			self.dMAppController.app2appMsgBusCtl.setDeviceIdWebsocket(deviceId, null);
			if (!self._presenceTimers.has(deviceId)) {
				self._presenceTimers.set(deviceId, window.setTimeout(function() {
					self.dMAppController._removePerDeviceSignal(deviceId);
					self._presenceTimers.delete(deviceId);
				}, 5000));
			}
		}
	};
	socket.addEventListener("close", function() {
		closeSocket();
	});
	socket.addEventListener("error", function() {
		closeSocket();
		self.app2appErrorCounter.event();
		self._setWsOkState("App2app", false);
	});
};

/** Broadcast arguments to all app2app sockets */
DMAppTvEmuController.prototype.app2appBroadcastSend = function() {
	const args = [].slice.call(arguments);
	for (let sock of this.app2appSockets) {
		sock.send.apply(sock, args);
	}
};

DMAppTvEmuController.prototype._setWsOkState = function(socketName, ok) {
	if (ok === this._wsStateOks[socketName]) return;
	this._wsStateOks[socketName] = ok;
	const badSockets = [];
	for (let prop in this._wsStateOks) {
		if (!this._wsStateOks[prop]) badSockets.push(prop);
	}
	if (badSockets.length === 0) {
		if (this._wsStateDevLogCtl) this._wsStateDevLogCtl.clear();
		this.dMAppController.errorSignals.localServices.unregisterReference(this);
	} else {
		if (!this._wsStateDevLogCtl) this._wsStateDevLogCtl = this.dMAppController.makeDevLoggingCtl({ single: true });
		this.dMAppController.devDialogLogger.error("Error connecting/using TV emulator " + badSockets.join(", ") + " websocket(s). Check that TV emulator services are operational.", this._wsStateDevLogCtl);
		this.dMAppController.errorSignals.localServices.registerReference(this);
	}
};

DMAppTvEmuController._debugConstructorHooks = [];

/**
 * Destructor, the instance MAY NOT be used after calling this.
 */
DMAppTvEmuController.prototype.destroy = function() {
	this.controlErrorCounter.flush();
	this.app2appErrorCounter.flush();
	this.stopApp2App();
	if (this.ws) this.ws.close();
	this.listenerTracker.removeAllListeners();
};

function App2AppSyncServer(dMAppController, socket, deviceId) {
	Object.defineProperty(this, 'logger',          { value: dMAppController.createNamedLogger("App2AppSyncServer: (" + deviceId + ")") });
	Object.defineProperty(this, 'dMAppController', { value: dMAppController });
	Object.defineProperty(this, 'socket',          { value: socket });
	Object.defineProperty(this, 'deviceId',        { value: deviceId });
	Object.defineProperty(this, 'clock',           { value: dMAppController.timeline.defaultClock });

	this.dMAppController.timeline.synchroniseExternalToClock(this.clock, this);
}

App2AppSyncServer.prototype.changeEvent = function(subtype) {
	this.timerCtl();
	this.sendUpdate(subtype);
};

App2AppSyncServer.prototype.sendUpdate = function(subtype) {
	this.socket.send(JSON.stringify({
		type: "app2appSyncEvent",
		subtype: subtype,
		speed: this.clock.getEffectiveSpeed(),
		time: this.clock.now() / this.clock.getTickRate(),
	}));
};

App2AppSyncServer.prototype.timerCtl = function() {
	const needTimer = this.isSynced && this.clock.getEffectiveSpeed() !== 0;
	if (needTimer && this._intervalId == null) {
		this._intervalId = window.setInterval(this.sendUpdate.bind(this, "update"), 2000);
	} else if (!needTimer && this._intervalId != null) {
		window.clearInterval(this._intervalId);
		delete this._intervalId;
	}
};

App2AppSyncServer.prototype.sync = function(info) {
	this.logger.info("Syncing from clock: " + this.dMAppController.timeline.getClockInfo(this.clock));
	this.isSynced = true;
	this._clockChangeHandler = this.changeEvent.bind(this, "change");
	this.clock.on("change", this._clockChangeHandler);
	this.changeEvent("available");
};

App2AppSyncServer.prototype.unsync = function(info) {
	this.logger.info("Unsyncing from clock: " + this.dMAppController.timeline.getClockInfo(this.clock));
	this.isSynced = false;
	this.timerCtl();
	this.clock.removeListener("change", this._clockChangeHandler);
	delete this._clockChangeHandler;
	if (this.socket.readyState < this.socket.CLOSING) {
		this.socket.send(JSON.stringify({
			type: "app2appSyncEvent",
			subtype: "unavailable",
		}));
	}
};

App2AppSyncServer.prototype.dump = function(info, dumper) {
	const cat = dumper.subcategory("App2AppSync");
	if (this.isSynced) {
		cat.keyValue("sync", "yes");
	} else {
		cat.keyValue("sync", "no");
	}
	cat.keyValue("deviceId", this.deviceId);
};

App2AppSyncServer.prototype.destroy = function() {
	this.dMAppController.timeline.unsynchroniseFromClock(this.clock, this);
};

try {
	Object.freeze(DMAppTvEmuController.prototype);
	Object.freeze(App2AppSyncServer.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppTvEmuController;
