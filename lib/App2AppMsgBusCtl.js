/************************************************************************/
/* FILE:                App2AppMsgBusCtl.js                             */
/* DESCRIPTION:         App2App message bus controller                  */
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

const Promise = require('promise');
const $ = require('jquery');
const inherits = require('inherits');
const deepEql = require('deep-eql');
const ListenerTracker = require('listener-tracker');
const SafeEventEmitter = require('./SafeEventEmitter');
const DMAppLayoutIO = require('./DMAppLayoutIO');
const DebugMiscUtil = require('./DebugMiscUtil');
const Logger = require('./Logger');
const MiscUtil = require('./MiscUtil');

function wrapErrorObject(obj) {
	return MiscUtil.setObjectToStringJson(obj, "App2AppMsgBusCtl");
}

/**
 * @classdesc
 *
 * App2App message bus controller.
 * This should not be directly constructed. Use: {@link DMAppController#app2appMsgBusCtl}.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {DMAppController} dMAppController parent controller
 */
function App2AppMsgBusCtl(dMAppController) {
	Object.defineProperties(this, {
		dMAppController:      { value: dMAppController },
		_localRecvMsgIds:     { value: new Set() },
		_deviceIdSocketMap:   { value: new Map() },
		_msgIdMap:            { value: new Map() },
		_cbIdMap:             { value: new Map() },
		_cbAllowExistingIdSet:{ value: new Set() },
		_cbListenerTrackerMap:{ value: new Map() },
		_specialComponentMap: { value: new Map() },
		_socketMetadata:      { value: new WeakMap() },
		logger:               { value: dMAppController.createNamedLogger("App2AppMsgBusCtl") },
	});
	this._setupSpecialComponents();
	this.enabled = false;
	this.messageTimeoutMs = 10000;
	this.socketTimeoutMs = 10000;
	this._nextCbId = 0;
	this.master = true;
}

inherits(App2AppMsgBusCtl, SafeEventEmitter);

/** @member {number} App2AppMsgBusCtl#messageTimeoutMs message timeout in ms */
/** @member {number} App2AppMsgBusCtl#socketTimeoutMs socket reconnection timeout in ms */

/**
 * Enabled state change event.
 *
 * @event App2AppMsgBusCtl#enabledStateChange
 */

/**
 * Set the enabled state.
 * This should be set by the same entity which sets/unsets the websocket,
 * this is so that if there is no entity which can/will set the websocket,
 * this will remain in the disabled state.
 * This defaults to disabled.
 *
 * @param {boolean} enabled Whether to enable
 */
App2AppMsgBusCtl.prototype.setEnabled = function(enabled) {
	if (this.enabled !== enabled) {
		this.enabled = enabled;
		this.emit("enabledStateChange");
	}
};

/**
 * Get the enabled state.
 *
 * @returns {boolean} Whether currently enabled
 */
App2AppMsgBusCtl.prototype.isEnabled = function() {
	return this.enabled;
};

/**
 * Set whether this is the master.
 * This defaults to true.
 *
 * @param {boolean} master Whether to set as master
 */
App2AppMsgBusCtl.prototype.setMaster = function(master) {
	this.master = master;
};

/**
 * Get whether this is the master.
 *
 * @returns {boolean} Whether this is the master
 */
App2AppMsgBusCtl.prototype.isMaster = function() {
	return this.master;
};

App2AppMsgBusCtl.prototype._makeSocketObj = function() {
	return {
		_msgInFlightMap: new Map(),
		websocket: null,
	};
};

App2AppMsgBusCtl.prototype._setSocketObjWebsocket = function(obj, socket) {
	const self = this;
	obj.websocket = socket;
	if (socket) {
		this._retransmitInFlight(obj);
		if (obj.lingerTimer != null) {
			window.clearTimeout(obj.lingerTimer);
			delete obj.lingerTimer;
		}
	} else {
		if (obj.lingerTimer == null) {
			const timeout = self.socketTimeoutMs;
			obj.lingerTimer = window.setTimeout(function() {
				self._cancelInFlight(obj, {
					deviceId: self.dMAppController.getDeviceId(),
					type: "connection_timeout",
					msg: "Websocket connection to '" + obj.name + "' timed out at: " + self.dMAppController.getDeviceId() +
							", after " + (timeout / 1000) + "s",
				});
				obj.deleteSelf();
			}, timeout);
		}
	}
};

/**
 * Device socket change event.
 *
 * @event App2AppMsgBusCtl#deviceSocketChange
 */

/**
 * Set the Websocket to use for outbound messages to a specific device ID
 *
 * @param {!string} deviceId Device ID
 * @param {?Websocket} socket Websocket to use for outbound messages, or null
 */
App2AppMsgBusCtl.prototype.setDeviceIdWebsocket = function(deviceId, socket) {
	if (!deviceId) this.logger.throwError("setDeviceIdWebsocket: no deviceId given");
	let obj = this._deviceIdSocketMap.get(deviceId);
	if (!obj) {
		obj = this._makeSocketObj();
		obj.deleteSelf = function() {
			this._deviceIdSocketMap.delete(deviceId);
			this.emit("deviceSocketChange");
		}.bind(this);
		obj.name = deviceId;
		this._deviceIdSocketMap.set(deviceId, obj);
	}
	this._setSocketObjWebsocket(obj, socket);
	this.emit("deviceSocketChange");
};

App2AppMsgBusCtl.prototype._getSocketMetadata = function(socket, createNew) {
	let info = this._socketMetadata.get(socket);
	if (!info && createNew) {
		info = {};
		this._socketMetadata.set(socket, info);
	}
	return info;
};

App2AppMsgBusCtl.prototype._getDeviceIdList = function() {
	const out = [];
	for (let id of this._deviceIdSocketMap.keys()) {
		out.push(id);
	}
	return out;
};

App2AppMsgBusCtl.prototype._getDeviceIdListWithInfo = function() {
	const out = [];
	for (let [id, socket] of this._deviceIdSocketMap) {
		out.push({
			deviceId: id,
			socketInfo: socket.websocket ? this._socketMetadata.get(socket.websocket) : undefined,
		});
	}
	return out;
};

/**
 * Upstream socket change event.
 *
 * @event App2AppMsgBusCtl#upstreamChange
 */

/**
 * Set the Websocket to use for outbound messages, where a device-specific socket is not defined.
 *
 * @param {?Websocket} socket Websocket to use for outbound messages, or null
 */
App2AppMsgBusCtl.prototype.setUpstreamWebsocket = function(socket) {
	if (!this._upstream) {
		this._upstream = this._makeSocketObj();
		this._upstream.deleteSelf = function() {
			delete this._upstream;
			this.emit("upstreamChange");
		}.bind(this);
		this._upstream.name = "upstream";
	}
	this._setSocketObjWebsocket(this._upstream, socket);
	this.emit("upstreamChange");
};

/**
 * Return whether upstream is connected
 *
 * @returns {boolean} Whether an upstream is present and connected
 */
App2AppMsgBusCtl.prototype.isUpstreamConnected = function() {
	return this._upstream && this._upstream.websocket;
};

App2AppMsgBusCtl.prototype._retransmitInFlight = function(obj) {
	for (let msgInfo of obj._msgInFlightMap.values()) {
		obj.websocket.send(JSON.stringify(msgInfo.msg));
	}
};

App2AppMsgBusCtl.prototype._cancelInFlight = function(obj, errorObj) {
	for (let msgInfo of obj._msgInFlightMap.values()) {
		if (msgInfo.reject) msgInfo.reject(wrapErrorObject(errorObj));
	}
};

App2AppMsgBusCtl.prototype._getSocket = function(deviceId, not_upstream) {
	const obj = this._deviceIdSocketMap.get(deviceId);
	if (obj) return obj;
	if (!not_upstream && this._upstream) return this._upstream;
	return null;
};

App2AppMsgBusCtl.prototype._generateMsgId = function() {
	let msgId = "AMID-";
	for (let i = 0; i < 8; i++) {
		const randval = (Math.random() * 0x10000) & 0xFFFF;
		msgId += (randval | 0x10000).toString(16).slice(1);
	}
	return msgId;
};

/**
 * Is a device ID a reference to this device?
 *
 * @param {string} deviceId Device ID to test
 * @return {boolean} True if the deviceId refers to this device
 */
App2AppMsgBusCtl.prototype.isDeviceIdSelf = function(deviceId) {
	if (deviceId === this.dMAppController.getDeviceId()) return true;
	if (deviceId === '@self') return true;
	if (deviceId === '@master' && this.master) return true;
	return false;
};

/**
 * Send a message to another device/component.
 *
 * @param msgBody The message body, this is of an arbitrary type
 * @param {?string} toDeviceId The device ID to send the message to. '@self' and '@master' are special values to address the current device and the master device respectively.
 *                             This may be null/empty, in which case the device ID for the component is looked up using the layout service if the component is not present locally.
 * @param {!string} toComponentId The component ID to send the message to
 * @param {string} fromComponentId The component ID to label the message as being from
 * @return {Promise} Reply sent back by the receiver, or an error/negative acknowledgement
 */
App2AppMsgBusCtl.prototype.send = function(msgBody, toDeviceId, toComponentId, fromComponentId) {
	const self = this;
	if (toDeviceId == null || toDeviceId === "") {
		if (self.dMAppController.layout.getDMAppComponentById(toComponentId) != null) {
			// component is present locally, send to self
			toDeviceId = '@self';
		} else {
			// look up via layout service
			return self.dMAppController.layout.io.getDMAppComponentInfoById(toComponentId).then(function(componentInfo) {
				if (componentInfo && componentInfo.layout && componentInfo.layout.deviceId) {
					return self.send(msgBody, componentInfo.layout.deviceId, toComponentId, fromComponentId);
				} else {
					return Promise.reject(wrapErrorObject({
						deviceId: self.dMAppController.getDeviceId(),
						type: "component_not_found",
						msg: "No such component: " + toComponentId + " in DMApp",
					}));
				}
			}, function(err) {
				if (typeof err === "object" && err.status === 404) {
					return Promise.reject(wrapErrorObject({
						deviceId: self.dMAppController.getDeviceId(),
						type: "component_not_found",
						msg: "No such component: " + toComponentId + " in DMApp",
					}));
				} else {
					return Promise.reject(wrapErrorObject({
						deviceId: self.dMAppController.getDeviceId(),
						type: "exception",
						msg: "Exception whilst determining device for component: " + err,
					}));
				}
			});
		}
	}
	if (self.isDeviceIdSelf(toDeviceId)) {
		// local send
		return this._localRouteMsg(msgBody, toComponentId, self.dMAppController.getDeviceId(), fromComponentId);
	}
	if (!self.enabled) {
		return Promise.reject(wrapErrorObject({
			deviceId: self.dMAppController.getDeviceId(),
			type: "config_error",
			msg: "App2AppMsgBusCtl is not enabled",
		}));
	}
	const msgId = self._generateMsgId();
	const msg = {
		toDeviceId: toDeviceId,
		toComponentId: toComponentId,
		fromDeviceId: self.dMAppController.getDeviceId(),
		fromComponentId: fromComponentId,
		body: msgBody,
		type: "app2appMsgBus",
		subtype: "msg",
		msgId: msgId,
	};
	const msgInfo = {
		msgId: msgId,
		msg: msg,
	};
	return self._sendIntl(msgInfo);
};

/**
 * Send a message to a App2App message receive handler
 *
 * @param msgBody The message body, this is of an arbitrary type
 * @param {!App2AppMsgBusCtl.App2AppMsgBusRecvHandler} handler Message receive handler to use
 * @param {!string} toComponentId The component ID to send the message to (relative to the handler)
 * @param {string} fromComponentId The component ID to label the message as being from
 * @return {Promise} Reply sent back by the receiver, or an error/negative acknowledgement
 */
App2AppMsgBusCtl.prototype.sendToHandler = function(msgBody, handler, toComponentId, fromComponentId) {
	return this._resultHandler("[sendToHandler]/" + toComponentId, this._dispatchRequest(handler, null, msgBody, "[sendToHandler]", toComponentId.split('/'), this.dMAppController.getDeviceId(), fromComponentId));
};

App2AppMsgBusCtl.prototype._sendIntl = function(msgInfo, not_upstream, no_reply_expected) {
	const self = this;
	return new Promise(function(resolve, reject) {
		const obj = self._getSocket(msgInfo.msg.toDeviceId, not_upstream);
		if (obj) {
			if (!no_reply_expected) {
				msgInfo.resolve = resolve;
				msgInfo.reject = reject;
			}
			msgInfo.obj = obj;
			const timeout = self.messageTimeoutMs;
			msgInfo.timeoutTimer = window.setTimeout(function() {
				if (!no_reply_expected) {
					reject(wrapErrorObject({
						deviceId: self.dMAppController.getDeviceId(),
						type: "send_timeout",
						msg: "Send to device: " + msgInfo.msg.toDeviceId + ", timed out after " + (timeout / 1000) + "s",
					}));
				}
				obj._msgInFlightMap.delete(msgInfo.msgId);
				self._msgIdMap.delete(msgInfo.msgId);
			}, timeout);
			obj._msgInFlightMap.set(msgInfo.msgId, msgInfo);
			self._msgIdMap.set(msgInfo.msgId, msgInfo);
			if (obj.websocket) {
				obj.websocket.send(JSON.stringify(msgInfo.msg));
			}
			if (no_reply_expected) resolve();
		} else {
			reject(wrapErrorObject({
				deviceId: self.dMAppController.getDeviceId(),
				type: "no_route_to_device",
				msg: "No route to device: " + msgInfo.msg.toDeviceId + ", at " + self.dMAppController.getDeviceId(),
			}));
		}
	});
};

/**
 * Receive a message.
 *
 * @param {Object} msg The message which was received
 */
App2AppMsgBusCtl.prototype.recv = function(msg) {
	for (let prop of['msgId', 'toDeviceId', 'subtype']) {
		if (!msg[prop] || typeof msg[prop] !== 'string') {
			this.logger.warn("Received invalid message (" + prop + "), dropping");
			return;
		}
	}

	if (msg.subtype === "ack" || msg.subtype === "nack") {
		const msgInfo = this._msgIdMap.get(msg.msgId);
		if (msgInfo) {
			window.clearTimeout(msgInfo.timeoutTimer);
			msgInfo.obj._msgInFlightMap.delete(msgInfo.msgId);
			this._msgIdMap.delete(msgInfo.msgId);
			if (msg.subtype === "ack") {
				if (msgInfo.resolve) msgInfo.resolve(msg.body);
			} else {
				if (msgInfo.reject) msgInfo.reject(wrapErrorObject(msg.error));
			}
		} else {
			this.logger.warn("Unexpectedly received message reply with ID: " + msg.msgId + ", dropping");
			return;
		}
	} else if (msg.subtype === "msg") {
		if (this.isDeviceIdSelf(msg.toDeviceId)) {
			// message is for us
			if (this._localRecvMsgIds.has(msg.msgId)) return;
			this._localRecvMsgIds.add(msg.msgId);
			window.setTimeout(this._localRecvMsgIds.delete.bind(this._localRecvMsgIds, msg.msgId), 90000);

			this._sendReplyFromPromise(msg.msgId, msg.fromDeviceId, this._localRouteMsg(msg.body, msg.toComponentId, msg.fromDeviceId, msg.fromComponentId));
		} else {
			// forward message somewhere else
			const msgInfo = {
				msgId: msg.msgId,
				msg: msg,
			};
			this._sendReplyFromPromise(msg.msgId, msg.fromDeviceId, this._sendIntl(msgInfo, true));
		}
	} else {
		this.logger.warn("Received invalid message subtype: " + msg.subtype + ", dropping");
	}
};

App2AppMsgBusCtl.prototype._sendReplyFromPromise = function(msgId, toDeviceId, promise) {
	promise.then(this._sendReplyIntl.bind(this, msgId, toDeviceId, "ack", "body"), this._sendReplyIntl.bind(this, msgId, toDeviceId, "nack", "error"));
};

App2AppMsgBusCtl.prototype._sendReplyIntl = function(msgId, toDeviceId, subtype, field, value) {
	const msgInfo = {
		msgId: msgId,
		msg: {
			toDeviceId: toDeviceId,
			type: "app2appMsgBus",
			subtype: subtype,
			msgId: msgId,
		},
	};
	msgInfo.msg[field] = value;
	this._sendIntl(msgInfo, false, true);
};

App2AppMsgBusCtl.prototype._noSuchComponentHandler = function(idBase, idSubParts) {
	return Promise.reject(wrapErrorObject({
		deviceId: this.dMAppController.getDeviceId(),
		type: "component_not_found",
		msg: "No such component: " + idBase + (idSubParts.length ? ", (sub-parts: " + idSubParts.join('/') + ")" : "") + ", on receiving device: " + this.dMAppController.getDeviceId(),
	}));
};

App2AppMsgBusCtl.prototype._setupSpecialComponents = function() {
	const self = this;
	this._specialComponentMap.set("*echo", function(msgBody) {
		return Promise.resolve(msgBody);
	});
	this._specialComponentMap.set("**device_list", function(msgBody) {
		return Promise.resolve([self.dMAppController.getDeviceId()].concat(self._getDeviceIdList()));
	});
	this._specialComponentMap.set("**device_list_info", function(msgBody) {
		return Promise.resolve([{ "deviceId" : self.dMAppController.getDeviceId() }].concat(self._getDeviceIdListWithInfo()));
	});
	this._specialComponentMap.set("**device_list_sub", function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
		const handler = function() {
			self.send([self.dMAppController.getDeviceId()].concat(self._getDeviceIdList()), fromDeviceId, msgBody.cb, toComponentId).catch(function() {
				// unsubscribe if send fails
				self.removeListener("deviceSocketChange", handler);
			});
		};
		self.on("deviceSocketChange", handler);
		handler();
		return Promise.resolve('OK');
	});
	this._specialComponentMap.set("**component_list", function(msgBody) {
		return Promise.resolve(self.dMAppController.layout.getDMAppComponentShortIdList());
	});
	this._specialComponentMap.set("**component_list_sub", function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
		const handler = function() {
			const components = self.dMAppController.layout.getDMAppComponentShortIdList();
			self.send(components, fromDeviceId, msgBody.cb, toComponentId).catch(function() {
				// unsubscribe if send fails
				self.dMAppController.layout.removeListener("createdComponent", handler);
				self.dMAppController.layout.removeListener("destroyedComponent", handler);
			});
		};
		self.dMAppController.layout.on("createdComponent", handler);
		self.dMAppController.layout.on("destroyedComponent", handler);
		handler();
		return Promise.resolve('OK');
	});
	this._specialComponentMap.set("**special_component_list", function(msgBody) {
		return Promise.resolve(Array.from(self._specialComponentMap.keys()));
	});
	this._specialComponentMap.set("**callback_id_list", function(msgBody) {
		return Promise.resolve(Array.from(self._cbIdMap.keys()));
	});
	this._specialComponentMap.set("**destroy_component", function(msgBody) {
		return Promise.resolve({ result: self.dMAppController.layout.requestRemoveDMAppComponentById(msgBody.id) });
	});
	this._specialComponentMap.set("**destroy_component_immediate", function(msgBody) {
		return Promise.resolve({ result: self.dMAppController.layout.removeDMAppComponentById(msgBody.id) });
	});
	this._specialComponentMap.set("**extend_component_info", function(msgBody) {
		const component = self.dMAppController.layout.getDMAppComponentById(msgBody.id);
		if (component) {
			component.setComponentInfo($.extend(true, {}, component.dMAppComponentInfo, msgBody.info));
			return Promise.resolve(component.dMAppComponentInfo);
		} else {
			return self._noSuchComponentHandler(msgBody.id);
		}
	});
	this._specialComponentMap.set("**create_debug_component", function(msgBody) {
		const debugElement = self.dMAppController.layout.createDMAppComponent("debug", "DMAppDebugDisplayComponent");
		debugElement.layoutIndependent = true;
		debugElement.noElementDomAttachmentCtl = true;
		document.body.appendChild(debugElement.getComponentElement());
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**layout_rest_refresh", function(msgBody) {
		return Promise.resolve(self.dMAppController.layout.io.refreshDmApp());
	});
	this._specialComponentMap.set("**check_region_changes", function(msgBody) {
		return Promise.resolve(self.dMAppController.layout.layoutRegionCtl.checkRegionChanges());
	});
	this._specialComponentMap.set("**reload_page", function(msgBody) {
		window.location.reload();
		return Promise.resolve({});
	});
	this._specialComponentMap.set("**navigate_page", function(msgBody) {
		window.location.href = msgBody.url;
		return Promise.resolve({});
	});
	this._specialComponentMap.set("**get_page_url", function(msgBody) {
		return Promise.resolve({ url: window.location.href });
	});
	this._specialComponentMap.set("**diag_layout_service", function(msgBody) {
		const msgs = [];
		const p = DMAppLayoutIO._diagnoseLayoutService(self.dMAppController.layout, function() {
			msgs.push(Logger.flattenMessageOutputLongForm.apply(null, arguments));
		});
		return p.then(function(v) {
			return Promise.resolve({
				data: v,
				logs: msgs,
			});
		}, function(v) {
			return Promise.reject(wrapErrorObject({
				data: v,
				logs: msgs,
			}));
		});
	});
	this._specialComponentMap.set("**emit_default_clock_change", function(msgBody) {
		const clock = self.dMAppController.timeline.defaultClock;
		if (clock.isAvailable()) clock.emit("change");
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**reset_layout", function(msgBody) {
		self.dMAppController.layout.testResetLayoutComponents(msgBody);
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**set_mode", function(msgBody) {
		self.dMAppController._modeSignal.setValue(msgBody);
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**set_shared_signal", function(msgBody) {
		self.dMAppController._sharedSignalStorage.getSignal(msgBody.key).setValue(msgBody.value);
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**set_shared_signal_cas", function(msgBody) {
		const signal = self.dMAppController._sharedSignalStorage.getSignal(msgBody.key);
		if (deepEql(signal.getValue(), msgBody.previous)) {
			signal.setValue(msgBody.value);
			return Promise.resolve({ done: true });
		} else {
			return Promise.resolve({ done: false, current: signal.getValue() });
		}
	});
	this._specialComponentMap.set("**set_shared_signal_at_path", function(msgBody) {
		const signal = self.dMAppController._sharedSignalStorage.getSignal(msgBody.key);
		signal.setValue(MiscUtil.cloneWithWriteAtPath(signal.getValue(), msgBody.path, msgBody.value));
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**get_shared_signal_instantaneous", function(msgBody) {
		const signal = self.dMAppController._sharedSignalStorage.getExistingSignal(msgBody.key);
		return Promise.resolve(signal ? signal.getValue() : undefined);
	});
	this._specialComponentMap.set("**post_timeline_event", function(msgBody) {
		return self.dMAppController.layout.io.postTimelineEvent(msgBody.toString());
	});
	this._specialComponentMap.set("**show_notification", function(msgBody) {
		self.dMAppController.showNotification(msgBody);
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**setup_shared_state_app2app_debug_recv", function(msgBody) {
		new DebugMiscUtil.App2AppMsgBusSharedStateReceiverCtl(self.dMAppController, msgBody.group, msgBody.key);
		return Promise.resolve("OK");
	});
	this._specialComponentMap.set("**send_shared_state_app2app_debug_cmd", function(msgBody) {
		return DebugMiscUtil.sendApp2AppMsgBusSharedStateCmd(self.dMAppController, msgBody.group, msgBody.key, msgBody.msg, msgBody.toDeviceId, msgBody.toComponentId, msgBody.fromComponentId);
	});
	this._specialComponentMap.set("**get_debug_summary", function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
		let tokenPrefix = "gds-";
		if (msgBody && typeof msgBody === "object" && msgBody.cbToken && typeof msgBody.cbToken === "string") {
			tokenPrefix = "gdst-" + msgBody.cbToken.length + "-" + msgBody.cbToken + "-";
		}
		for (let cbId of self._cbIdMap.keys()) {
			if (cbId.startsWith('%' + tokenPrefix)) self._cbIdMap.delete(cbId);
		}
		let lt = self._cbListenerTrackerMap.get(tokenPrefix);
		if (lt) {
			lt.removeAllListeners();
		} else {
			lt = ListenerTracker.createTracker();
			self._cbListenerTrackerMap.set(tokenPrefix, lt);
		}

		let signalUpdateCallback;
		if (msgBody && typeof msgBody === "object" && msgBody.signalUpdateCb && typeof msgBody.signalUpdateCb === "string") {
			signalUpdateCallback = function(id, value) {
				if (!signalUpdateCallback) return;
				self.send({ id: id, value: value }, fromDeviceId, msgBody.signalUpdateCb, toComponentId).catch(function() {
					// unsubscribe if send fails
					signalUpdateCallback = null;
					lt.removeAllListeners();
				});
			};
		}

		const data = [];
		const dumper = new DebugMiscUtil.SerialisationDumper(data, DebugMiscUtil.MakeApp2AppCallbackSerialisationDumperDynHandler(function(name, callback) {
			return self.createNamedCallback(tokenPrefix + name, callback);
		}, signalUpdateCallback, lt));
		return self.dMAppController.dumpDebugSummaryPromise(dumper).then(function() {
			return data;
		});
	});
	this._specialComponentMap.set("**setup_timeline_master_override", function(msgBody) {
		return Promise.resolve(DebugMiscUtil.setupTimelineMasterOverrideDebugUtil(self.dMAppController, msgBody));
	});
	this._specialComponentMap.set("**dump_timeline_debug", function(msgBody) {
		const contextId = self.dMAppController.layout.contextId;
		if (!contextId) return Promise.reject("Not currently in a context");
		return self.dMAppController.ajaxPromiseNX({
			method: "GET",
			dataType: "json",
			url: self.dMAppController._getUrl('timelineService') + "/context/" + contextId + "/dump",
		}).setTitle("Get timeline debug info for context: " + contextId).exec().then(function(info) {
			if (msgBody && typeof msgBody === "object" && msgBody.raw) return info.data;
			const doc = info.data.document;
			info.data.document = "<see below>";
			let msg = "Response:\n" + JSON.stringify(info.data, null, 4);
			msg += "\n\nXML:\n" + doc;
			return msg;
		});
	});
	this._specialComponentMap.set("**resend_context_join", function(msgBody) {
		const contextId = self.dMAppController.layout.contextId;
		const dmAppId = self.dMAppController.layout.dmAppId;
		if (!contextId) return Promise.reject("Not currently in a context");
		if (!dmAppId) return Promise.reject("No DMApp loaded");
		return self.dMAppController.layout.io.joinContext(contextId).then(function(ctxInfo) {
			return self.dMAppController.layout.io.joinDmApp(dmAppId).then(function(dmappInfo) {
				return {
					ctx: ctxInfo,
					dmapp: dmappInfo,
				};
			});
		});
	});
	this._specialComponentMap.set("**leave_rejoin_context", function(msgBody) {
		const contextId = self.dMAppController.layout.contextId;
		const dmAppId = self.dMAppController.layout.dmAppId;
		if (!contextId) return Promise.reject("Not currently in a context");
		if (!dmAppId) return Promise.reject("No DMApp loaded");
		return self.dMAppController.layout.io.leaveContext().then(function(leaveInfo) {
			return self.dMAppController.layout.io.joinContext(contextId).then(function(ctxInfo) {
				return self.dMAppController.layout.io.joinDmApp(dmAppId).then(function(dmappInfo) {
					return {
						leave: leaveInfo,
						ctx: ctxInfo,
						dmapp: dmappInfo,
					};
				});
			});
		});
	});
	this._specialComponentMap.set("**get_context_info", function(msgBody) {
		const contextId = self.dMAppController.layout.contextId;
		if (!contextId) return Promise.reject("Not currently in a context");
		return self.dMAppController.layout.io.getContextInformation(contextId);
	});
	this._specialComponentMap.set("**get_context_info_full", function(msgBody) {
		const contextId = self.dMAppController.layout.contextId;
		if (!contextId) return Promise.reject("Not currently in a context");
		const io = new DMAppLayoutIO(self.dMAppController.layout, self.dMAppController.layout.logger, { autoRetry: true, deviceIdOverride: "layoutRenderer" });
		return io.getContextInformation(contextId);
	});
};

App2AppMsgBusCtl.prototype._resultHandler = function(toComponentId, result) {
	const self = this;
	return Promise.resolve(result).then(function(ack) {
		return Promise.resolve(ack);
	}, function(nack) {
		return Promise.reject(wrapErrorObject({
			deviceId: self.dMAppController.getDeviceId(),
			componentId: toComponentId,
			type: "component_nack",
			body: nack,
		}));
	});
};

App2AppMsgBusCtl.prototype._localRouteMsg = function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
	const self = this;

	try {
		const toComponentIdParts = toComponentId.split('/');
		const toComponentIdBase = toComponentIdParts.shift();
		const special_handler = self._specialComponentMap.get(toComponentIdBase);
		if (special_handler) {
			return self._dispatchRequest(special_handler, null, msgBody, toComponentIdBase, toComponentIdParts, fromDeviceId, fromComponentId);
		}

		const result_handler = this._resultHandler.bind(this, toComponentId);

		const component = self.dMAppController.layout.getDMAppComponentById(toComponentIdBase);
		if (component) {
			const handler = component.getApp2AppRecvHandler();
			return result_handler(self._dispatchRequest(handler, null, msgBody, toComponentIdBase, toComponentIdParts, fromDeviceId, fromComponentId));
		} else if (this._cbIdMap.has(toComponentIdBase)) {
			return result_handler(self._dispatchRequest(this._cbIdMap.get(toComponentIdBase), null, msgBody, toComponentIdBase, toComponentIdParts, fromDeviceId, fromComponentId));
		} else {
			return self._noSuchComponentHandler(toComponentIdBase, toComponentIdParts);
		}
	} catch(e) {
		return Promise.reject(wrapErrorObject({
			deviceId: self.dMAppController.getDeviceId(),
			type: "exception",
			msg: "Target device threw exception whilst receiving message: " + e,
		}));
	}
};

App2AppMsgBusCtl.prototype._dispatchRequest = function(handler, thisValue, msgBody, toComponentIdBase, toComponentIdSubParts, fromDeviceId, fromComponentId) {
	if (typeof handler === "function") {
		if (toComponentIdSubParts.length > 0) {
			return Promise.reject(wrapErrorObject({
				deviceId: this.dMAppController.getDeviceId(),
				type: "component_not_found",
				msg: "No such sub-component: " + toComponentIdSubParts.join('/') + ", in component: " + toComponentIdBase + ", on receiving device: " + this.dMAppController.getDeviceId(),
			}));
		}
		return handler.call(thisValue, msgBody, toComponentIdBase, fromDeviceId, fromComponentId);
	} else if (handler instanceof App2AppMsgBusRecvHandler) {
		if (toComponentIdSubParts.length === 0) {
			const sub_handler = handler.getRootHandler();
			if (!sub_handler) {
				return Promise.reject(wrapErrorObject({
					deviceId: this.dMAppController.getDeviceId(),
					type: "component_not_found",
					msg: "No root handler in component: " + toComponentIdBase + ", on receiving device: " + this.dMAppController.getDeviceId(),
				}));
			} else if (typeof sub_handler === "function") {
				return sub_handler.call(thisValue, msgBody, toComponentIdBase, fromDeviceId, fromComponentId);
			} else {
				throw new Error("_dispatchRequest: sub-handler is of wrong type: " + String(handler));
			}
		} else {
			const sub_handler = handler.getSubHandler(toComponentIdSubParts[0]);
			if (sub_handler) {
				toComponentIdBase += '/' + toComponentIdSubParts.shift();
				return this._dispatchRequest(sub_handler, thisValue, msgBody, toComponentIdBase, toComponentIdSubParts, fromDeviceId, fromComponentId);
			} else {
				return Promise.reject(wrapErrorObject({
					deviceId: this.dMAppController.getDeviceId(),
					type: "component_not_found",
					msg: "No such sub-component: " + toComponentIdSubParts.join('/') + ", in component: " + toComponentIdBase + ", on receiving device: " + this.dMAppController.getDeviceId(),
				}));
			}
		}
	} else {
		throw new Error("_dispatchRequest: handler is of wrong type: " + String(handler));
	}
};

/**
 * Receive app2app message
 *
 * @callback App2AppRecvMsgCallback
 *
 * @param msgBody The message body, this is of an arbitrary type
 * @param {string} toComponentId The component ID the message was sent to
 * @param {string} fromDeviceId The device ID which sent the message
 * @param {?string} fromComponentId The component ID which sent the message
 * @return {Promise|value} Reply to be sent back to sender, return a rejection to reply with a negative acknowledgement
 */

/**
 * Create a message receiver callback.
 * This callback ID can be directly addressed as if it were a component ID on the current device.
 *
 * Callbacks SHOULD be removed by calling {@link App2AppMsgBusCtl#removeCallback} when no longer required.
 *
 * Temporary callbacks created for use by components should instead be created by using {@link DMAppComponent#createApp2AppCallback}.
 *
 * @param {App2AppRecvMsgCallback} func Message receiver callback
 * @return {string} callback ID
 */
App2AppMsgBusCtl.prototype.createCallback = function(func) {
	const id = '#' + (this._nextCbId++) + "-" + this.dMAppController.generateRandomIdString(6);
	this._cbIdMap.set(id, func);
	return id;
};

/**
 * Create a named message receiver callback.
 * This callback ID can be directly addressed as if it were a component ID on the current device.
 *
 * This is prefixed with the '%' character
 *
 * Callbacks SHOULD be removed by calling {@link App2AppMsgBusCtl#removeCallback} when no longer required.
 *
 * @param {string} name Callback name
 * @param {App2AppRecvMsgCallback} func Message receiver callback
 * @param {boolean} allowExisting Allow overwriting a named callback which already exists, if that callback was also created using allowExisting
 * @return {string} callback name, prefixed with the '%' character
 */
App2AppMsgBusCtl.prototype.createNamedCallback = function(name, func, allowExisting) {
	const id = '%' + name;
	if (this._cbIdMap.has(id)) {
		if (!allowExisting || !this._cbAllowExistingIdSet.has(id)) this.logger.throwError("createNamedCallback: Callback name: '" + id + "' already exists in createNamedCallback, and it may not be overwritten");
	}
	this._cbIdMap.set(id, func);
	if (allowExisting) this._cbAllowExistingIdSet.add(id);
	return id;
};

/**
 * Remove a message receiver callback.
 *
 * @param {string} id callback ID
 */
App2AppMsgBusCtl.prototype.removeCallback = function(id) {
	this._cbIdMap.delete(id);
	this._cbAllowExistingIdSet.delete(id);
};

/**
 * Receive app2app message
 *
 * @callback App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvCallback
 * @param msgBody The message body, this is of an arbitrary type
 * @param {string} fromDeviceId The device ID which sent the message
 * @param {?string} fromComponentId The component ID which sent the message
 * @return {Promise|value} Reply to be sent back to sender, return a rejection to reply with a negative acknowledgement
 */

/**
 * Generic app2app receiver handler type
 * @typedef {App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvCallback|App2AppMsgBusCtl.App2AppMsgBusRecvHandler} App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler
 */

/**
 * @classdesc
 *
 * App2app message receiver router class
 *
 * @memberof App2AppMsgBusCtl
 *
 * @constructor
 * @param {App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler=} rootHandler Optional root handler
 */
function App2AppMsgBusRecvHandler(rootHandler) {
	this._rootHandler = rootHandler || null;
	Object.defineProperties(this, {
		_handlerMap:              { value: new Map() },
	});
	this.setSubHandler('*list', function() {
		return this.getList();
	}.bind(this));
}

/**
 * Get root handler
 *
 * @returns {?App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler}
 */
App2AppMsgBusRecvHandler.prototype.getRootHandler = function() {
	return this._rootHandler;
};

/**
 * Set root handler
 *
 * @param {?App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler}
 */
App2AppMsgBusRecvHandler.prototype.setRootHandler = function(rootHandler) {
	this._rootHandler = rootHandler || null;
};

/**
 * Get sub handler
 *
 * @param {!string} key
 * @returns {?App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler}
 */
App2AppMsgBusRecvHandler.prototype.getSubHandler = function(key) {
	return this._handlerMap.get(key) || null;
};

/**
 * Set sub handler
 *
 * @param {!string} key
 * @param {?App2AppMsgBusCtl.App2AppMsgBusRecvHandler~recvHandler}
 */
App2AppMsgBusRecvHandler.prototype.setSubHandler = function(key, handler) {
	this._handlerMap.set(key, handler);
};

/**
 * Get sub handler list
 *
 * @returns {!Array.<!string>}
 */
App2AppMsgBusRecvHandler.prototype.getList = function() {
	return Array.from(this._handlerMap.keys());
};

App2AppMsgBusCtl.App2AppMsgBusRecvHandler = App2AppMsgBusRecvHandler;

try {
	Object.freeze(App2AppMsgBusCtl.prototype);
	Object.freeze(App2AppMsgBusRecvHandler.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = App2AppMsgBusCtl;
