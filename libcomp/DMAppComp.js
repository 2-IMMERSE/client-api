/************************************************************************/
/* FILE:                DMAppComp.js                                    */
/* DESCRIPTION:         DMApp companion lib                             */
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

const SyncProtocolsCiiSyncHandler = require("./SyncProtocolsCiiSyncHandler");
const DMAppCompDiscoveryFilter = require("./DMAppCompDiscoveryFilter");

const inherits = DMAppClientLib.deps.inherits;
const URI = DMAppClientLib.deps.URI;
const ListenerTracker = DMAppClientLib.deps.listenerTracker;
const $ = DMAppClientLib.deps.jquery;
const PromiseExecQueue = DMAppClientLib.PromiseExecQueue;
const TimeoutHandler = DMAppClientLib.TimeoutHandler;
const argCheck = DMAppClientLib.argCheck;

const defaultAppEndpoint = "eu.2-immerse";

const app2appBlocks = Object.freeze({
	deviceJoinOption:    Symbol("Device join option: noApp2AppSync"),
	notConnected:        Symbol("App2App not connected"),
	disableOption:       Symbol("Enable option: useApp2AppSync, set to false"),
});

/**
 * @classdesc
 *
 * General functionality for a companion application to join/connect to a master/TV application.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {?Object} options optional options object
 * @param {string} [options.appEndpoint=eu.2-immerse] override app endpoint used in app2app
 * @param {boolean} [options.useApp2AppSync=true] enable sync over app2app websocket channel
 * @param {boolean} [options.noContextJoin=false] do not join the associated context/DMApp when joining a device
 */
function DMAppComp(dMAppController, options) {
	const self = this;
	if (!options) options = {};
	Object.defineProperties(self, {
		dMAppController:     { value: dMAppController },
		logger:              { value: dMAppController.createNamedLogger("DMAppComp") },
		listenerTracker:     { value: new DMAppClientLib.deps.listenerTracker.createTracker() },
		appEndpoint:         { value: options.appEndpoint || defaultAppEndpoint },
		_contextOpQueue:     { value: new PromiseExecQueue(dMAppController.createNamedLogger("DMAppComp context op queue")) },
		app2AppSyncBlockSignal: { value: new DMAppClientLib.Signal.BlockCountSignal() },
		_discoveryInstances: { value: new Set() },
		_serviceUrlErrorFlag:{ value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, dMAppController.errorSignals.configuration, DMAppClientLib.ErrorUtil.ErrorMode.DEV,
				"Service URL mismatch between this device and TV/master") },
		_app2appErrorFlag:   { value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, dMAppController.errorSignals.localServices, DMAppClientLib.ErrorUtil.ErrorMode.DEV,
				"Error connecting/using app2app websocket") },
		_auxData:            { value: new DMAppClientLib.Signal.SettableSignal({}) },
		noContextJoin:       { value: !!options.noContextJoin },
	});
	Object.defineProperty(self, 'auxDataSignal', { value: new DMAppClientLib.Signal.ConstWrapperSignal(self._auxData) });

	if (options.useApp2AppSync === false) self.app2AppSyncBlockSignal.registerBlocker(app2appBlocks.disableOption);
	self.app2AppSyncBlockSignal.registerBlocker(app2appBlocks.notConnected);

	if (!dMAppController._debugDmAppCompInstances) {
		Object.defineProperty(dMAppController, '_debugDmAppCompInstances', { value: [] });
	}
	dMAppController._debugDmAppCompInstances.push(this);
	dMAppController.emit("_debugNewDmAppCompInstance", this);

	this.logger.info("DMAppComp version: " + require('__VERSION__'));

	DMAppClientLib.argCheck(arguments, 2, self.logger, "DMAppComp constructor", options, ['appEndpoint', 'useApp2AppSync', 'noContextJoin']);

	this._lastDeviceId = null;
	this._lastDeviceInstanceId = null;

	self.app2AppSyncBlockSignal.on("fall", function() {
		if (!self.app2appSyncClient) self.app2appSyncClient = new App2AppSyncClient(self.dMAppController);
	});
	self.app2AppSyncBlockSignal.on("rise", function() {
		if (self.app2appSyncClient) {
			self.app2appSyncClient.destroy();
			delete self.app2appSyncClient;
		}
	});
	self.listenerTracker.subscribeTo(window).on("beforeunload", function() {
		if (self.app2appErrorCounter) {
			self.app2appErrorCounter.flush();
		}
	});

	self._spCiiHandler = new SyncProtocolsCiiSyncHandler(dMAppController, self);
}


/** @member {Signal.BlockCountSignal} DMAppComp#app2AppSyncBlockSignal App2app sync block signal */

inherits(DMAppComp, DMAppClientLib.SafeEventEmitter);

/**
 * CII sync URL handler interface
 *
 * @interface CiiSyncHandler
 */
/**
 * Method called to start synchronisation
 *
 * @method CiiSyncHandler#sync
 * @param {!DMAppController} dMAppController parent controller
 * @param {!string} url CII sync URL
 * @param {string=} name optional Synchroniser name
 */
/**
 * Method called to stop synchronisation
 *
 * @method CiiSyncHandler#unsync
 */

/**
 * Set CII Sync URL handler
 *
 * @param {?CiiSyncHandler} handler
 */
DMAppComp.prototype.setCiiSyncHandler = function(handler) {
	if (handler === this._ciiSyncHandler) return;
	if (this._ciiSyncHandler && this._lastCiiSyncUrl) {
		this._ciiSyncHandler.unsync();
	}
	this._ciiSyncHandler = handler;
	if (this._ciiSyncHandler && this._lastCiiSyncUrl) {
		this._ciiSyncHandler.sync(this.dMAppController, this._ciiSyncHandler, "Device: " + this._lastDeviceId);
	}
	this.emit("_debugInfoChange");
};

/**
 * Get CII Sync URL handler
 *
 * @returns {?CiiSyncHandler} handler
 */
DMAppComp.prototype.getCiiSyncHandler = function() {
	return this._ciiSyncHandler;
};

DMAppComp.prototype._joinContext = function(contextId) {
	const self = this;
	if (self.noContextJoin) return;
	if (contextId === self._lastContextId) return;

	if (contextId == null || self._lastContextId != null) {
		this.logger.info("Leaving context");
		self._lastContextId = null;
		self._contextOpQueue.enqueue(function() {
			return self.dMAppController.layout.io.leaveContext();
		});
	}
	if (contextId != null) {
		this.logger.info("Joining context ID: ", contextId);
		self._lastContextId = contextId;
		self._contextOpQueue.enqueue(function() {
			return self.dMAppController.layout.io.joinContext(contextId);
		});
		self._remoteServiceUrlsCheck();
	}
};

DMAppComp.prototype._joinDmApp = function(dmAppId) {
	const self = this;
	if (self.noContextJoin) return;
	if (dmAppId === self._lastDmAppId) return;

	if (dmAppId == null || self._lastDmAppId != null) {
		self.logger.info("Leaving DmApp");
		self._lastDmAppId = null;
		self._contextOpQueue.enqueue(function() {
			return self.dMAppController.layout.io.leaveDmApp();
		});
	}
	if (dmAppId != null) {
		self.logger.info("Joining DmApp ID: ", dmAppId);
		self._lastDmAppId = dmAppId;
		self._contextOpQueue.enqueue(function() {
			return self.dMAppController.layout.io.joinDmApp(dmAppId);
		});
	}
};

/**
 * Get device ID of last joined device
 * @returns {?string} device ID
 */
DMAppComp.prototype.getJoinedDeviceId = function() {
	return this._lastDeviceId;
};

/**
 * Get host of last joined App2App websocket
 * @returns {?string} device ID
 */
DMAppComp.prototype.getLastApp2AppHost = function() {
	return this._lastApp2AppHost;
};

/**
 * Get message describing the current join state
 * @returns {?string} message
 */
DMAppComp.prototype.getJoinStateMessage = function() {
	let str = "Not joined";
	if (this.getJoinedDeviceId()) {
		str = "Joined device ID: " + this.getJoinedDeviceId() + " at " + this.getLastApp2AppHost();
	} else if (this.getLastApp2AppHost()) {
		str = "Joined device which does not yet have a device ID at " + this.getLastApp2AppHost();
	}
	return str;
};

/**
 * Get detail message describing the current join state
 * @returns {?string} message
 */
DMAppComp.prototype.getJoinStateDetail = function() {
	let str = '';
	if (this._lastDeviceInstanceId) str = "Joined device instance ID: " + this._lastDeviceInstanceId;
	return str;
};

/**
 * Remote connected device ID change event.
 *
 * @event DMAppComp#remoteDeviceIdChange
 * @type {string}
 */
/**
 * Remote join state change event.
 *
 * @event DMAppComp#remoteJoinStateChange
 */
/**
 * A join has just occurred.
 *
 * @event DMAppComp#join
 */

DMAppComp.prototype._deviceIdUpdate = function(deviceId) {
	if (this._lastDeviceId !== deviceId) {
		this._clearDeviceIdTimeout();
		this._lastDeviceId = deviceId;
		this.logger.info("Joined device has device ID: ", deviceId);
		this.emit("remoteDeviceIdChange", deviceId);
		this.emit("remoteJoinStateChange");
	}
};

DMAppComp.prototype._deviceInstanceIdUpdate = function(instanceId) {
	if (this._lastDeviceInstanceId !== instanceId) {
		this._lastDeviceInstanceId = instanceId;
		this.logger.info("Joined device has instance ID: " + instanceId);
		this.emit("remoteJoinStateChange");
	}
};

DMAppComp.prototype._remoteServiceUrlsUpdate = function(urls) {
	if (!DMAppClientLib.deps.nanoEqual(this._lastRemoteServiceUrls, urls)) {
		this._lastRemoteServiceUrls = urls;
		this._remoteServiceUrlsCheck();
	}
};

DMAppComp.prototype._remoteServiceUrlsCheck = function() {
	let ok = true;
	if (this._lastContextId && this._lastRemoteServiceUrls) {
		const adjustUrls = function(obj) {
			const out = {};
			for (let prop in obj) {
				out[prop] = obj[prop] ? obj[prop].replace(/^https:\/\//, "http://") : obj[prop];
			}
			return out;
		};
		if (!DMAppClientLib.deps.nanoEqual(adjustUrls(this._lastRemoteServiceUrls), adjustUrls(this.dMAppController._urls))) {
			ok = false;
		}
	}
	this._serviceUrlErrorFlag.setState(!ok);
};

DMAppComp.prototype._ciiSyncUrlUpdate = function(ciiSyncUrl) {
	if (this._lastCiiSyncUrl !== ciiSyncUrl) {
		const prev = this._lastCiiSyncUrl;
		this._lastCiiSyncUrl = ciiSyncUrl;
		this.logger.info("CII sync URL update: ", ciiSyncUrl);
		if (this._ciiSyncHandler) {
			if (prev) this._ciiSyncHandler.unsync();
			if (ciiSyncUrl) this._ciiSyncHandler.sync(this.dMAppController, ciiSyncUrl, "Device: " + this._lastDeviceId);
		}
	}
};

DMAppComp.prototype._setupApp2App = function(url) {
	const self = this;
	if (self.app2appConnected || self.app2appActive) {
		self.logger.throwError("App2app is already connected, cannot connect to: ", url);
	}

	self._lastApp2AppHost = new URI(url).hostname();

	self.dMAppController.app2appMsgBusCtl.setMaster(false);
	self.dMAppController.app2appMsgBusCtl.setEnabled(true);
	self.dMAppController.app2appMsgBusCtl.setUpstreamWebsocket(null);

	const ws = new ReconnectingWebSocket(url + self.appEndpoint, [], {
		reconnectInterval: 500,
		reconnectDecay: 2,
		maxReconnectInterval: 30000,
	});
	self.app2appWs = ws;

	self.app2appActive = true;
	self.app2appConnected = false;
	self.app2AppSyncBlockSignal.unregisterBlocker(app2appBlocks.notConnected);

	let paired = false;

	const listenerTracker = new ListenerTracker();

	const errorSummary = self.dMAppController.getErrorSignalSummarySignal();
	self.app2appErrorCounter = self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "App2app websocket error: ", url);

	ws.addEventListener("open", function() {
		self.app2appErrorCounter.flush();
		self._app2appErrorFlag.clear();
		self.app2appConnected = true;
		paired = false;
		listenerTracker.subscribeTo(self.app2AppSyncBlockSignal).on("toggle", function() {
			if (paired) {
				ws.send(JSON.stringify({
					type: "app2appSyncCtl",
					sync: !self.app2AppSyncBlockSignal.isBlocked(),
				}));
			}
		});
		listenerTracker.subscribeTo(errorSummary).on("change", function() {
			if (paired) {
				ws.send(JSON.stringify({
					type: "errorSummary",
					value: errorSummary.getValue(),
				}));
			}
		});

		const subscribeShared = function(rcMap, postfix) {
			const sharedSignalTracker = listenerTracker.subscribeTo(rcMap);
			sharedSignalTracker.on("newSignal", function(info) {
				if (paired) {
					ws.send(JSON.stringify({
						type: "subscribe" + postfix,
						keys: [info.key],
					}));
				}
			});
			sharedSignalTracker.on("removeSignal", function(info) {
				if (paired) {
					ws.send(JSON.stringify({
						type: "unsubscribe" + postfix,
						keys: [info.key],
					}));
				}
			});
		};
		subscribeShared(self.dMAppController._sharedSignalMap, "SharedSignals");
		subscribeShared(self.dMAppController._perDeviceSignalMerged, "MergedPerDeviceSignals");
		subscribeShared(self.dMAppController._perDeviceRCSignalMerged, "MergedPerDeviceRCSignals");

		const handleNewLpdSignals = function(event, messageType) {
			listenerTracker.subscribeTo(self.dMAppController).on(event, function(key, signal) {
				listenerTracker.subscribeTo(signal).on("change", function() {
					if (paired) {
						ws.send(JSON.stringify({
							type: messageType,
							key: key,
							value: signal.getValue(),
						}));
					}
				});
			});
		};
		handleNewLpdSignals("_newPerDeviceSignalLocal", "setPerDeviceSignal");
		handleNewLpdSignals("_newPerDeviceRefCountSignalLocal", "setPerDeviceRCSignal");
	});
	ws.addEventListener("close", function() {
		self.app2appConnected = false;
		self.dMAppController.app2appMsgBusCtl.setUpstreamWebsocket(null);
		listenerTracker.removeAllListeners();
	});
	ws.addEventListener("error", function(err) {
		self._app2appErrorFlag.setMessage("Error connecting/using app2app websocket: " + url);
		self._app2appErrorFlag.raise();
		self.app2appErrorCounter.event();
	});
	const sendAllLpdSignals = function(map, messageType, allMessageType) {
		const signals = [];
		for (let [key, signal] of map.getEntries()) {
			signals.push([key, signal.getValue()]);
			listenerTracker.subscribeTo(signal).on("change", function() {
				ws.send(JSON.stringify({
					type: messageType,
					key: key,
					value: signal.getValue(),
				}));
			});
		}
		ws.send(JSON.stringify({
			type: allMessageType,
			signals: signals,
		}));
	};
	ws.addEventListener("message", function(event) {
		if (!paired && event.data === "pairingcompleted") {
			paired = true;
			ws.send(JSON.stringify({
				type: 'device',
				value: self.dMAppController.getDeviceId(),
			}));
			ws.send(JSON.stringify({
				type: 'instance',
				value: self.dMAppController.instanceId,
			}));
			ws.send(JSON.stringify({
				type: "errorSummary",
				value: errorSummary.getValue(),
			}));
			sendAllLpdSignals(self.dMAppController.localPerDeviceSignalMap, "setPerDeviceSignal", "setAllPerDeviceSignals");
			sendAllLpdSignals(self.dMAppController.localPerDeviceRefCountSignalMap, "setPerDeviceRCSignal", "setAllPerDeviceRCSignals");
			if (!self.app2AppSyncBlockSignal.isBlocked()) {
				ws.send(JSON.stringify({
					type: "app2appSyncCtl",
					sync: true,
				}));
			}

			const subscribeShared = function(rcMap, postfix) {
				const sharedkeys = rcMap.getKeys();
				if (sharedkeys.length) {
					ws.send(JSON.stringify({
						type: "subscribe" + postfix,
						keys: sharedkeys,
					}));
				}
			};
			subscribeShared(self.dMAppController._sharedSignalMap, "SharedSignals");
			subscribeShared(self.dMAppController._perDeviceSignalMerged, "MergedPerDeviceSignals");
			subscribeShared(self.dMAppController._perDeviceRCSignalMerged, "MergedPerDeviceRCSignals");

			self.dMAppController.app2appMsgBusCtl.setUpstreamWebsocket(ws);
			return;
		}
		try {
			const msg = JSON.parse(event.data);
			if (Array.isArray(msg)) {
				for (let i = 0; i < msg.length; i++) {
					self._processApp2AppMsg(msg[i]);
				}
			} else {
				self._processApp2AppMsg(msg);
			}
		} catch(e) {
			self.logger.error("Error in handling app2app websocket message; ", e, event.data);
		}
	});
};

DMAppComp.prototype._processApp2AppMsg = function(msg) {
	const self = this;
	try {
		if (msg.type === "device") {
			self._deviceIdUpdate(msg.value);
		} else if (msg.type === "instance") {
			self._deviceInstanceIdUpdate(msg.value);
		} else if (msg.type === "context") {
			self._joinContext(msg.value);
		} else if (msg.type === "dmApp") {
			self._joinDmApp(msg.value);
		} else if (msg.type === "interContext") {
			self.logger.info("Setting inter context ID from app2app websocket to: " + msg.value);
			self.dMAppController.layout._interCtxIdSignal.setValue(msg.value || null);
		} else if (msg.type === "session") {
			self.logger.info("Setting session ID from app2app websocket to: " + msg.value);
			self.dMAppController._sessionIdSignal.setValue(msg.value || self.dMAppController._defaultSessionId);
		} else if (msg.type === "setMode") {
			self.logger.info("Setting mode from app2app websocket to: ", msg.value);
			self.dMAppController._modeSignal.setValue(msg.value || null);
		} else if (msg.type === "app2appSyncEvent") {
			if (self.app2appSyncClient) {
				self.app2appSyncClient.msg(msg);
			}
		} else if (msg.type === "app2appMsgBus") {
			self.dMAppController.app2appMsgBusCtl.recv(msg);
		} else if (msg.type === "serviceUrls") {
			self._remoteServiceUrlsUpdate(msg.value);
		} else if (msg.type === "localDevGroupErrorSummary") {
			self.dMAppController.localDevGroupErrorSummary._change(msg.value);
		} else if (msg.type === "sharedSignalChange") {
			const signal = self.dMAppController._sharedSignalMap.getExistingSignal(msg.key);
			if (signal) {
				signal.setValue(msg.value);
			} else {
				self.logger.warn("Received shared signal change for key with no local instance: ", msg.key);
			}
		} else if (msg.type === "mergedPerDeviceSignalChange") {
			const signal = self.dMAppController._perDeviceSignalMerged.getExistingSignal(msg.key);
			if (signal) {
				signal.setValue(msg.value);
			} else {
				self.logger.warn("Received merged per device signal change for key with no local instance: ", msg.key);
			}
		} else if (msg.type === "mergedPerDeviceRCSignalChange") {
			const signal = self.dMAppController._perDeviceRCSignalMerged.getExistingSignal(msg.key);
			if (signal) {
				signal.setValue(msg.value);
			} else {
				self.logger.warn("Received merged per device RC signal change for key with no local instance: ", msg.key);
			}
		} else if (msg.type === "setAllAuxData") {
			self._auxData.setValue(msg.value || {});
		} else {
			self.logger.warn("Unexpected message from app2app websocket", msg);
		}
	} catch(e) {
		self.logger.error("Error in handling app2app websocket message; ", e, msg);
	}
};

/** Stop app2app websocket connection */
DMAppComp.prototype.stopApp2App = function() {
	this.app2appActive = false;
	this._deviceIdUpdate(null);
	this._ciiSyncUrlUpdate(null);
	if (this.app2appWs) {
		this.app2appWs.close();
		delete this.app2appWs;
	}
	if (this.app2appErrorCounter) {
		this.app2appErrorCounter.flush();
		delete this.app2appErrorCounter;
	}
	this._app2appErrorFlag.clear();
	this.app2AppSyncBlockSignal.registerBlocker(app2appBlocks.notConnected);
	this.dMAppController.app2appMsgBusCtl.setEnabled(false);
	this.dMAppController.app2appMsgBusCtl.setMaster(true);
	this.dMAppController.localDevErrorSignalSummary._change(null);
};

DMAppComp.prototype._clearDeviceIdTimeout = function() {
	if (this._deviceIdUpdateTimeout) {
		this._deviceIdUpdateTimeout.cancel();
		delete this._deviceIdUpdateTimeout;
	}
	if (this._devLogFoundWaitingDeviceIdCtl) {
		this._devLogFoundWaitingDeviceIdCtl.clear();
		delete this._devLogFoundWaitingDeviceIdCtl;
	}
};

/**
 * Join a TV/master device
 * @param {!discoveredDevice} device Device to join
 * @param {Object=} options Optional options object
 * @param {boolean=} options.noApp2AppSync True if app2app sync should not be used
 */
DMAppComp.prototype.joinDevice = function(device, options) {
	const self = this;
	if (!device) {
		self.logger.throwError("No device given");
	}
	if (!options) {
		options = {};
	}

	argCheck(arguments, 2, self.logger, "DMAppComp.joinDevice (device)", device,
			["contextId", "deviceId", "instanceId", "interContextId", "sessionId", "ciiSyncUrl", "app2appUrl", "friendlyName", "extraData", "id", "additionalData", "auxData", "UDN", "applicationUrl", "state"]);
	argCheck([], 0, self.logger, "DMAppComp.joinDevice (options)", options, ["noApp2AppSync"]);

	self.logger.info("Joining device: ", device.app2appUrl + ", " + device.friendlyName);
	self.logger.debug("Joining device detail: " + JSON.stringify(device));

	self.dMAppController.layout._interCtxIdSignal.setValue(device.interContextId || null);
	self.dMAppController._sessionIdSignal.setValue(device.sessionId || self.dMAppController._defaultSessionId);
	if (device.contextId) {
		self._joinContext(device.contextId);
	}
	if (device.deviceId) {
		self._deviceIdUpdate(device.deviceId);
	} else {
		self._deviceIdUpdate(undefined);

		// joined device but no deviceId set yet
		self._deviceIdUpdateTimeout = new TimeoutHandler(function() {
			self.logger.warn("Joined device at: " + self.getLastApp2AppHost() + ", but no device ID received after 10s.");
			if (!self._haveLoggedDevLogWaitingDeviceId) {
				self._haveLoggedDevLogWaitingDeviceId = true;
				self._devLogFoundWaitingDeviceIdCtl = self.dMAppController.makeDevLoggingCtl();
				self.dMAppController.devDialogLogger.warn("Companion: Joined device at: " + self.getLastApp2AppHost() + ", but no device ID received after 10s. Check that TV emulator page is actually running on TV emulator." +
						"This message will only be shown once. Continuing to wait for device ID to be received...", self._devLogFoundWaitingDeviceIdCtl);
			}
		}, 10000);
	}
	self.app2AppSyncBlockSignal.setBlockerRegistered(app2appBlocks.deviceJoinOption, options.noApp2AppSync);
	if (device.ciiSyncUrl) {
		self._ciiSyncUrlUpdate(device.ciiSyncUrl);
	}
	if (device.app2appUrl) {
		self._setupApp2App(device.app2appUrl);
	}

	this.emit("remoteJoinStateChange");
	this.emit("join");
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 */
DMAppComp.prototype.destroy = function() {
	this._spCiiHandler.destroy();
	delete this._spCiiHandler;
	this.stopApp2App();
	this.listenerTracker.removeAllListeners();
};

DMAppComp.prototype.dumpDebugInfo = function(dumper) {
	dumper.keyValue("Version", require('__VERSION__'));
	dumper.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	dumper.keyValue("Join state", this.getJoinStateMessage());
	dumper.keyValue("Join state detail", this.getJoinStateDetail());
	dumper.keyValue("CII sync handler", (this._ciiSyncHandler && this._ciiSyncHandler.name) ? this._ciiSyncHandler.name : !!this._ciiSyncHandler);
	dumper.keyValue("App2App sync enabled", !this.app2AppSyncBlockSignal.isBlocked());
	dumper.keyValue("Auxiliary data", JSON.stringify(this.auxDataSignal.getValue(), null, 4));
	if (this.app2AppSyncBlockSignal.isBlocked()) {
		dumper.keyValue("App2App sync blocked by", Array.from(this.app2AppSyncBlockSignal.getRegisteredBlockerIterator()).map(function(val) {
			if (typeof val === "symbol") return String(val).slice(7, -1);
			return val.toString();
		}).join(", "));
	}
	if (this._serviceUrlErrorFlag.getValue()) {
		dumper.keyValue("Error", this._serviceUrlErrorFlag.msg);
		dumper.keyValue("Local service URLs", JSON.stringify(this.dMAppController._urls, null, 4));
		dumper.keyValue("Remote service URLs", JSON.stringify(this._lastRemoteServiceUrls, null, 4));
	}
	for (let instance of this._discoveryInstances) {
		instance.dumpDebugInfo(dumper);
	}
};

DMAppComp.prototype.setupDumpDebugEvents = function(listenerTracker, func) {
	listenerTracker.subscribeTo(this.app2AppSyncBlockSignal).on("change", func);
	listenerTracker.subscribeTo(this).on("remoteJoinStateChange", func);
	listenerTracker.subscribeTo(this).on("_debugInfoChange", func);
	listenerTracker.subscribeTo(this._serviceUrlErrorFlag).on("toggle", func);
	listenerTracker.subscribeTo(this.auxDataSignal).on("change", func);
};

DMAppComp.prototype._addDiscoveryInstance = function(instance) {
	this._discoveryInstances.add(instance);
	instance.setupDumpDebugEvents(this.listenerTracker, this.emit.bind(this, "_debugInfoChange"));
};

DMAppComp.prototype._removeDiscoveryInstance = function(instance) {
	this._discoveryInstances.delete(instance);
};

DMAppComp.prototype._dumpDiscoveredDeviceMap = function(deviceMap, dumper) {
	for (let [id, dev] of deviceMap) {
		const devCat = dumper.subcategory("Discovered device: " + id, false);
		for (let prop in dev) {
			const val = dev[prop];
			if (val && typeof val === "object") {
				devCat.keyValue(prop, JSON.stringify(val, null, 4));
			} else {
				devCat.keyValue(prop, val);
			}
		}
	}
};

/**
 * Setup companion platform specific discovery
 * @param {Object=} options Optional options object
 * @param {boolean=} [options.startDiscovery=true] Auto-start discovery (where applicable)
 * @param {boolean=} [options.startDeviceSync=true] Start platform-specific sync (where applicable)
 * @param {boolean=} [options.joinFirst=false] Auto-join first discovered device (where applicable)
 * @param {Object=} options.discoveryFilterConfig Optional {@link DMAppCompDiscoveryFilter} options object
 * @returns {?DiscoveryCtl} Platform-specific discovery object, or null if no suitable implementation is available
 */
DMAppComp.prototype.setupCompanionPlatformSpecificDiscovery = function(options) {
	const params = $.extend({
		startDiscovery: true,
		startDeviceSync: true,
		joinFirst: false,
	}, options || {});
	argCheck(arguments, 1, this.logger, "setupCompanionPlatformSpecificDiscovery", params, ['startDiscovery', 'startDeviceSync', 'joinFirst', 'discoveryFilterConfig']);

	let discovery = this._setupCompanionPlatformSpecificDiscoveryIntl(params);
	if (!discovery) return null;
	if (params.discoveryFilterConfig) {
		const destructor = discovery.destroy.bind(discovery);
		discovery = new DMAppCompDiscoveryFilter(discovery, params.discoveryFilterConfig);
		discovery.once("destroy", destructor);
	}
	if (params.joinFirst) discovery.joinFirst();
	return discovery;
};

DMAppComp.prototype._setupCompanionPlatformSpecificDiscoveryIntl = function(params) {
	const import_wrap = function(name) {
		try {
			const imp = require(name);
			return imp;
		} catch(e) {
			/* swallow */
			return null;
		}
	};

	const DMAppAndroid = import_wrap('DMAppAndroid');
	if (DMAppAndroid && window.cordova && window.cordova.platformId === "android") {
		if (params.startDeviceSync) {
			new DMAppAndroid.DMAppAndroidSynchroniser(this.dMAppController, this); // jshint ignore:line
		}
		const androidDiscoveryCtl = new DMAppAndroid.DMAppAndroidCompDiscovery(this.dMAppController, this);
		if (params.startDiscovery) androidDiscoveryCtl.discover();
		return androidDiscoveryCtl;
	}

	const DMAppIos = import_wrap('DMAppIos');
	if (DMAppIos && window.cordova && window.cordova.platformId === "ios") {
		const iosDiscoveryCtl = new DMAppIos.DMAppIosCompDiscovery(this.dMAppController, this);
		if (params.startDiscovery) iosDiscoveryCtl.discover();
		return iosDiscoveryCtl;
	}

	const DMAppCompEmuLib = import_wrap('DMAppCompEmuLib');
	if (DMAppCompEmuLib && !window.cordova) {
		const compemucontroller = new DMAppCompEmuLib.DMAppCompEmuDiscovery(this.dMAppController, this);
		return compemucontroller;
	}

	return null;
};

function App2AppSyncClient(dMAppController) {
	Object.defineProperties(this, {
		dMAppController:     { value: dMAppController },
		logger:              { value: dMAppController.createNamedLogger("App2AppSyncClient") },
		srcClock:            { value: dMAppController.timeline.monotonicClock },
	});
	Object.defineProperties(this, {
		clock:               { value: new DMAppClientLib.deps.dvbcssClocks.CorrelatedClock(this.srcClock) },
	});
	Object.defineProperties(this, {
		msg:                 { value: DMAppClientLib.ClockSyncUtil.makeCorrelatedClockUpdateMessageHandler(this.clock, { logger: this.logger }) },
	});
	this.clock.availabilityFlag = false;
	this.dMAppController.timeline.setDefaultClockSource(this.clock, {
		sourceName: "App2AppSyncClient",
		priorityGroup: 3,
		priority: 0,
	});
}

App2AppSyncClient.prototype.stopSync = function() {
	this.dMAppController.timeline.unsetDefaultClockSource(this.clock);
};

App2AppSyncClient.prototype.destroy = function() {
	this.stopSync();
};

try {
	Object.freeze(DMAppComp.prototype);
	Object.freeze(App2AppSyncClient.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

/**
 * Discovered device ID
 * This is an opaque unique identifier
 * @typedef discoveredDeviceId
 */

/**
 * Discovered device data
 *
 * @typedef {Object} discoveredDevice
 * @prop {?string} contextId Context ID device is member of, if already known
 * @prop {?string} deviceId Device ID, if already known
 * @prop {?string} interContextId Inter-context ID, if already known
 * @prop {?string} sessionId Session ID, if already known
 * @prop {?string} instanceId Device instance ID, if already known
 * @prop {?string} ciiSyncUrl CII sync URL, if already known
 * @prop {?string} app2appUrl app2app sync URL
 * @prop {?string} friendlyName Friendly name of device, if known
 * @prop {?Object} extraData Platform-specific additional data, if known
 * @prop {?Object} additionalData DIAL app additionalData object, if known
 * @prop {?Object} auxData Auxiliary additional data, if known
 * @prop {!discoveredDeviceId} id Unique identifier
 */

/**
 * Discovery controller interface
 *
 * @interface DiscoveryCtl
 */
 /**
 * New device event.
 *
 * @event DiscoveryCtl#newDevice
 * @type {discoveredDevice}
 */
 /**
 * Updated device event.
 *
 * @event DiscoveryCtl#updateDevice
 * @type {discoveredDevice}
 */
/**
 * Removed device ID event.
 *
 * @event DiscoveryCtl#removeDevice
 * @type {discoveredDeviceId}
 */
 /**
 * Destruction event
 *
 * @event DiscoveryCtl#destroy
 */
 /**
 * Join the first available device which is or has been discovered
 *
 * @method DiscoveryCtl#joinFirst
 */
/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This method SHOULD be called when the discovery instance is no-longer required.
 *
 * @method DiscoveryCtl#destroy
 */
 /**
 * Map of discovered device ID to discovered device
 *
 * @member DiscoveryCtl#discoveredMap
 * @type {Map.<discoveredDeviceId, discoveredDevice>}
 */

module.exports = DMAppComp;
