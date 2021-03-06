/************************************************************************/
/* FILE:                DMAppLayoutIO.js                                */
/* DESCRIPTION:         DMApp layout and related services network IO    */
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
const MiscUtil = require('./MiscUtil');
const ListenerTracker = require('listener-tracker');
const TimeoutHandler = require('./TimeoutHandler');
const RetryUtil = require('./RetryUtil');
const DebugMiscUtil = require('./DebugMiscUtil');
const Signal = require('./Signal');
const waitable = require('./waitable');

/**
 * @classdesc
 *
 * Handles layout and related services network IO functionality.
 * An existing instance is available at {@link DMAppLayout#io}.
 *
 * @constructor
 * @param {!DMAppLayout} parentLayout parent Layout
 * @param {!Logger} logger Logger instance
 * @param {Object=} options Optional options object
 * @param {boolean=} options.autoRetry Optional enable auto retry
 * @param {ajaxPromiseResultReceiverCallback=} options.retryHandler Optional failed request retry handler
 * @param {boolean=} options.noConnCheck Optional disable layout service connectivity checks
 * @param {string=} options.deviceIdOverride Optional device ID override for outgoing requests
 */
function DMAppLayoutIO(parentLayout, logger, options) {
	Object.defineProperties(this, {
		parentLayout:         { value: parentLayout },
		dMAppController:      { value: parentLayout.dMAppController },
		logger:               { value: logger },
		_wsState:             { value: parentLayout._wsState },
		options:              { value: {} },
		statusUpdateBatches:  { value: new Map() },
	});
	if (options) $.extend(this.options, options);
	Object.defineProperties(this, {
		deviceId:             { value: this.options.deviceIdOverride || this.dMAppController.getDeviceId() },
	});
	try {
		Object.freeze(this);
		Object.freeze(this.options);
	} catch (e) {
		/* swallow: doesn't matter too much if this fails */
	}
	if (this.dMAppController.advDebugMode) return DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(this, this.logger, "DMAppLayoutIO");
}

DMAppLayoutIO.prototype._ajaxResultHandler = function(ap, cfg, result) {
	let ok = true;
	if (result.status === 0) ok = false;
	if (result.status >= 500 && result.status <= 599) ok = false;
	if (cfg && cfg.statusToServiceErrorStateOverride) {
		ok = cfg.statusToServiceErrorStateOverride(ok, ap, result);
	}
	this.dMAppController.errorSignals.networkServices.setState(!ok);
};

DMAppLayoutIO.prototype.makeAjaxPromiseNX = function() {
	return this.setupAjaxPromiseNXCommon(this.dMAppController.ajaxPromiseNX.apply(this.dMAppController, arguments), null);
};

DMAppLayoutIO.prototype.makeAjaxPromiseNXCfg = function(cfg) {
	return this.setupAjaxPromiseNXCommon(this.dMAppController.ajaxPromiseNX.apply(this.dMAppController, [].slice.call(arguments, 1)), cfg);
};

DMAppLayoutIO.prototype.setupAjaxPromiseNXCommon = function(ap, cfg) {
	ap.setTimeout(30000);
	if (this.options.autoRetry) ap.enableAutoRetry(true);
	if (this.options.retryHandler) ap.on("retry", this.options.retryHandler);
	if (!this.options.noConnCheck) ap.on("fail", this._connFailCheck.bind(this));
	if (this.dMAppController.serviceAjaxCredentials) ap.setCredentials(this.dMAppController.serviceAjaxCredentials);
	const resultHandler = this._ajaxResultHandler.bind(this, ap, cfg);
	ap.on("success", resultHandler);
	ap.on("fail", resultHandler);
	return ap;
};

DMAppLayoutIO.prototype.WS_FALLBACK_TIMEOUT = {
	DEFAULT: 5000,
	SHORT: 2000,
	IMMEDIATE: 25,
};

DMAppLayoutIO.prototype._websocketRestFallbackCtl = function(interval) {
	const self = this;
	const _wsState = this._wsState;
	const parentLayout = this.parentLayout;

	if (_wsState._connectedWsContext) {
		if (_wsState._wsFallbackTimer) {
			window.clearTimeout(_wsState._wsFallbackTimer);
			delete _wsState._wsFallbackTimer;
		}
		return;
	}

	if (!interval) interval = self.WS_FALLBACK_TIMEOUT.DEFAULT;
	const timeoutTime = self.dMAppController.monotonicNow() + interval;

	if (_wsState._wsFallbackTimer) {
		// if the new time is before the timer is currently scheduled to fire, reschedule it
		if (timeoutTime >= _wsState._wsFallbackTimeoutTime) {
			return;
		} else {
			window.clearTimeout(_wsState._wsFallbackTimer);
		}
	}

	_wsState._wsFallbackTimeoutTime = timeoutTime;
	_wsState._wsFallbackTimer = window.setTimeout(function() {
		if (parentLayout.contextId != null && parentLayout.dmAppId != null) {
			self.refreshDmApp().catch(function(info) {
				self.logger.error("DMApp refresh failed in websocket REST fallback", info);
			}).finally(function() {
				delete _wsState._wsFallbackTimer;
				self._websocketRestFallbackCtl();
			});
		} else {
			delete _wsState._wsFallbackTimer;
			self._websocketRestFallbackCtl();
		}
	}, interval);
};

DMAppLayoutIO.prototype._getWebsocketUrl = function() {
	let url = this.dMAppController._getUrl('websocketService');
	if (!url) return null;
	if (url.slice(-1) != '/') url += '/';
	url += "layout";
	return url;
};

DMAppLayoutIO.prototype._websocketSetDebugStatus = function(msg) {
	this._wsState.debugStatus = msg;
	this.parentLayout.emit("_websocketDebugStatusChange");
};

DMAppLayoutIO.prototype._websocketCtl = function(previousContextId, contextId) /* -> Promise<> */ {
	const self = this;
	const _wsState = this._wsState;
	const parentLayout = this.parentLayout;

	self._websocketRestFallbackCtl(self.WS_FALLBACK_TIMEOUT.SHORT);
	if (_wsState._websocket && previousContextId != null && _wsState._connectedWsContext === previousContextId) {
		const room = previousContextId + '.' + self.deviceId;
		self.logger.debug("Leaving websocket room: ", room, ", as context ID changed");
		_wsState._websocket.emit('LEAVE', JSON.stringify({
			room: room,
			name: 'layout_' + room,
		}));
		_wsState._connectedWsContext = null;
		self._websocketSetDebugStatus("Connected: not in room (left room)");
	}

	const idle_check = new TimeoutHandler();
	const wsListenerTracker = ListenerTracker.createTracker();

	if (contextId != null) {
		/* If the socket does not connect, join and receive a room join acknowledgement
		 * within 2s, switch to REST polling mode with a 5s interval
		 */
		if (!_wsState._websocket) {
			const url = self._getWebsocketUrl();
			if (!url) return Promise.resolve();
			_wsState._websocket = MiscUtil.makeSocketIOClient(url, {'force new connection' : true, 'multiplex': false });
			self._websocketSetDebugStatus("Created: not connected, not in room");
		}
		const ws = _wsState._websocket;
		const connect = function() {
			const room = contextId + '.' + self.deviceId;
			self.logger.debug("Websocket is connected");
			self._websocketSetDebugStatus("Connected: not in room");
			ws.emit('JOIN', JSON.stringify({
				room: room,
				name: 'device[' + self.deviceId + ']',
			}), function() {
				self.logger.debug("Joined websocket room: ", room);
				self._websocketSetDebugStatus("Connected: in room: " + room);
				_wsState._connectedWsContext = contextId;
				self._websocketRestFallbackCtl();
				parentLayout._activeDMAppJoins.awaitLow(function() {
					if (parentLayout.dmAppId != null) {
						self.refreshDmApp().catch(function(info) {
							self.logger.error("DMApp refresh failed following websocket connection", info);
						});
					}
				}, wsListenerTracker);
				idle_check.addTimeout(function() {
					self._checkWebsocketServerWorking(ws);
				}, 3000);
				if (_wsState.devLogCtl) _wsState.devLogCtl.clear();
			});
		};
		if (ws.connected) {
			connect();
		} else {
			ws.on('connect', connect);
		}
		ws.on('disconnect', function() {
			wsListenerTracker.removeAllListeners();
			self.logger.debug("Websocket is disconnected");
			self._websocketSetDebugStatus("Disconnected");
			_wsState._connectedWsContext = null;
			self._websocketRestFallbackCtl();
			idle_check.cancel();
		});
		ws.on('EVENT', function(data) {
			idle_check.cancel();
			parentLayout._handleLayoutMsg(data.message);
		});
		ws.on('connect_error', function(info) {
			self.logger.error("Websocket received a connect_error event: " + info);
			self._devLogWebsocketError("connect_error", info);
		});
		ws.on('reconnect_error', function(info) {
			self.logger.error("Websocket received a reconnect_error event: " + info);
			self._devLogWebsocketError("reconnect_error", info);
		});
	}
	if (_wsState._websocket && contextId == null) {
		if (_wsState.devLogCtl) _wsState.devLogCtl.clear();
		_wsState._websocket.close();
		delete _wsState._websocket;
	}

	/* Ok to always resolve immediately, as a layout refresh will be triggered if necessary,
	 * and blocked when a full layout is received over the WS */
	return Promise.resolve();
};

DMAppLayoutIO.prototype._devLogWebsocketError = function(eventType, info) {
	if (!this._wsState.devLogCtl) this._wsState.devLogCtl = this.dMAppController.makeDevLoggingCtl({ single: true });
	this.dMAppController.devDialogLogger.warn("Failed to connect to the Websockets server: '" + this._getWebsocketUrl() + "' (" + eventType + ": " + info + "). Falling back to REST polling is iminent.", this._wsState.devLogCtl);
};

DMAppLayoutIO.prototype._checkWebsocketServerWorking = function(ws) {
	const self = this;
	self.logger.info("Checking if websockets server is working");
	const timer = new TimeoutHandler();
	const sock = MiscUtil.makeSocketIOClient(self._getWebsocketUrl());
	sock.on('connect', function() {
		sock.emit('JOIN', JSON.stringify({
				room: 'all.contexts',
				name: 'WS check for device[' + self.deviceId + ']',
			}), function() {
			const firstConn = self.makeAjaxPromiseNX({
				method: "POST",
				url: self.dMAppController._getUrl('layoutService') + "/context?reqDeviceId=" + self.deviceId + "_wscheck",
				dataType: "json",
			}).setTitle("WS check: create context").exec();
			firstConn.then(function(info) {
				return info.data.contextId;
			}).then(function(contextId) {
				return self.makeAjaxPromiseNX({
					method: "DELETE",
					url: self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "?reqDeviceId=" + self.deviceId + "_wscheck",
				}).setTitle("WS check: delete context").exec();
			}).then(function() {
				timer.addTimeout(function() {
					self.logger.error("Websockets server is not working, disconnecting");
					self.dMAppController.devDialogLogger.warn("The Websockets server you are using: '" + self._getWebsocketUrl() + "' is contactable " +
							"but it and/or the layout server you are using: '" + self.dMAppController._getUrl('layoutService') + "' are not configured correctly. " +
							"Check service configuration. Falling back to REST polling.");
					sock.close();
					ws.close();
					if (self.parentLayout.dmAppId != null) {
						self.refreshDmApp().catch(function(info) {
							self.logger.error("DMApp refresh failed in websocket server not working REST fallback", info);
						});
					}
				}, 2000);
			}).catch(function() {
				sock.close();
			});
		});
	});
	sock.on('EVENT', function(data) {
		timer.cancel();
		self.logger.info("Websockets server is working");
		sock.close();
	});
	sock.on('disconnect', function() {
		timer.cancel();
	});
};

DMAppLayoutIO.prototype._changeContext = function(context, title, expectedId) /* -> Promise<> */ {
	const self = this;
	const parentLayout = this.parentLayout;

	if (expectedId != null) {
		const logFault = function(current) {
			const msg = "Unexpected context ID returned in result of operation: '" + (title || "_changeContext") + "', got '" + current + "' instead of '" + expectedId + "'";
			self.logger.warn(msg);
			self.dMAppController.devDialogLogger.warn(msg + ". This may result in undefined behaviour.");
		};
		if (context) {
			if (context.contextId !== expectedId) {
				logFault(context.contextId);
			}
		} else {
			logFault ("[no context]");
		}
	}

	if (parentLayout.contextObj === context) return Promise.resolve();

	const previousContextId = parentLayout.contextId;
	const previousContext = parentLayout.contextObj;
	if (parentLayout.dmAppId != null) {
		parentLayout._handleDmApp(null);
	}
	if (context) {
		parentLayout._contextIdSignal.setValue(context.contextId);
		parentLayout.contextObj = context;
	} else {
		parentLayout._contextIdSignal.setValue(undefined);
		parentLayout.contextObj = undefined;
	}
	// Run websocket on "main" LayoutIO
	const retval = parentLayout.io._websocketCtl(previousContextId, parentLayout.contextId);
	if (previousContextId !== parentLayout.contextId) {
		parentLayout.emit('contextChange', Object.freeze({
			previousContextId: previousContextId,
			previousContext: previousContext,
			newContextId: parentLayout.contextId,
			newContext: parentLayout.contextObj,
		}));
	}
	return retval;
};

DMAppLayoutIO.prototype._contextJoinCommon = function(url, caps, title, expectedId) /* -> Promise<Context obj> */ {
	const self = this;
	const parentLayout = this.parentLayout;

	const ap = self.makeAjaxPromiseNX({
		method: "POST",
		url: url,
		data: JSON.stringify({
			capabilities: caps,
			regionList: parentLayout.layoutRegionCtl._getRegionList(true),
			group: self.dMAppController.getDeviceId(),
		}),
		contentType: "application/json; charset=utf-8",
		dataType: "json",
	});
	ap.addBlockObject(parentLayout._statusUpdateValve);
	ap.addBlockObject(parentLayout.layoutRegionCtl._blockSignal);
	ap.setTitle(title);
	return ap.exec().then(function(info) {
		return self._changeContext(info.data, title, expectedId).then(function() {
			return info.data;
		});
	});
};

DMAppLayoutIO.prototype._devIdQString2 = function(deviceId) {
	return "reqDeviceId=" + deviceId + "&deviceId=" + deviceId;
};

/**
 * Utility function for context/DMApp creation/setup with auto-retry
 *
 * @param {?string} timelineUrl timeline URL
 * @param {?string} layoutUrl layout URL
 * @param {string=} contextRejoinMode context (re)join mode: 'rejoin', 'nocheck', or 'destroy', the default is 'nocheck'
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.setupContextAndDmapp = function(timelineUrl, layoutUrl, contextRejoinMode) /* -> Promise<> */ {
	const self = this;
	const controller = this.dMAppController;
	const devLogCtl = controller.makeDevLoggingCtl({ single: true });
	const makeIo = function(failureLogger) {
		return new DMAppLayoutIO(self.parentLayout, self.logger, $.extend({}, self.options, {
			retryHandler: failureLogger,
		}));
	};

	if (!contextRejoinMode) contextRejoinMode = "nocheck";

	const makeGenericFailureLogger = function(whatFailed, retryState) {
		return function(info) {
			let msg = whatFailed + " at layout service: '" + controller._urls.layoutService + "' due to: '" + info + "'. " +
					"Check that services are running and reachable, and that service inputs are valid. Check service and client logs for info and take corrective action. " +
					"(Attempt: " + retryState.attemptNum + ")";
			if (info.retryNum) msg += " (Retry: " + info.retryNum + ")";
			self.logger.error(whatFailed + ": " + info);
			controller.devDialogLogger.error(msg, devLogCtl);
		};
	};

	const setupContext = function(retryState) {
		const failLogger = makeGenericFailureLogger("Failed to create new context", retryState);
		const io = makeIo(failLogger);
		const result = io.createAndJoinContext().then(function(context) {
			self.logger.debug("Created context: " + context.contextId);

			return io.loadDmApp(timelineUrl, layoutUrl).then(function(dmApp) {
				self.logger.debug("Launched DMApp list: ", dmApp);
			}).catch(function(info) {
				self.logger.error("Launching DMApp failed: ", info);
				return Promise.reject(info);
			});
		});
		result.catch(failLogger);
		return result;
	};
	return RetryUtil.retryPromise(function(retryState) {
		if (contextRejoinMode === "rejoin") {
			const failLogger = makeGenericFailureLogger("Failed to reattach to existing context", retryState);
			const io = makeIo(failLogger);
			const result = io.tryReattachContext().then(function(context) {
				if (context) {
					return self.logger.debug("Reattached to context: " + context.contextId);
				} else {
					return setupContext(retryState);
				}
			});
			result.catch(failLogger);
			return result;
		} else if (contextRejoinMode === "nocheck") {
			return setupContext(retryState);
		} else if (contextRejoinMode === "destroy") {
			return self.tryLeaveAndDestroyContext().then(function() {
				return setupContext(retryState);
			});
		} else {
			self.logger.warn("setupContextAndDmapp: Unexpected context rejoin mode: " + contextRejoinMode);
			setupContext(retryState);
		}
	}, self.logger, {
		name: "Test component: Initial context setup",
		baseDelay: 4096,
	}).then(function() {
		devLogCtl.clear();
	});
};

/**
 * Create new Layout Context using: POST /context
 *
 * In most circumstances {@link DMAppLayoutIO#setupContextAndDmapp} should be used instead.
 *
 * @returns {Promise<Context>}
 */
DMAppLayoutIO.prototype.createContext = function() /* -> Promise<Context obj> */ {
	const self = this;
	const ap = self.makeAjaxPromiseNX({
		method: "POST",
		url: self.dMAppController._getUrl('layoutService') + "/context?reqDeviceId=" + self.deviceId,
		dataType: "json",
	}).setTitle("Create new context").exec().then(function(info) {
		return info.data;
	});
	if (self.parentLayout.newContextPercentCoords) {
		return ap.then(function(ctx) {
			return self.makeAjaxPromiseNX({
				method: "PUT",
				url: self.dMAppController._getUrl('layoutService') + "/context/" + ctx.contextId + "/config?reqDeviceId=" + self.deviceId +
						"&percentCoords=" + !!self.parentLayout.newContextPercentCoords,
			}).setTitle("Configure new context").exec().then(function(info) {
				return ctx;
			});
		});
	} else {
		return ap;
	}
};

/**
 * If the client is already part of a Layout Context at the server, re-join it, otherwise return null
 *
 * @returns {Promise<?Context>}
 */
DMAppLayoutIO.prototype.tryReattachContext = function() /* -> Promise<Context obj> */ {
	const self = this;
	return self.getCurrentContext().then(function(context) {
		if (context) {
			return self.getDmAppList().then(function(dmAppList) {
				// check if we're attached to a DMApp at the server, if so, re-join
				if (dmAppList.length > 0) {
					self.logger.debug("tryReattachContext: Joining DMApp: " + dmAppList[0]);
					return self.joinDmApp(dmAppList[0]).then(function(dmApp) {
						return context;
					});
				} else {
					return context;
				}
			});
		} else {
			return null;
		}
	});
};

/**
 * If the client is already part of a Layout Context at the server, leave and destroy it
 *
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.tryLeaveAndDestroyContext = function() /* -> Promise<> */ {
	const self = this;
	return self.getCurrentContext().then(function(context) {
		if (context) {
			self.logger.info("Device was in a context: " + context.contextId + ", leaving/destroying it");
			return self.leaveAndDestroyContext();
		} else {
			self.logger.info("Device was not in a context");
		}
	});
};

/**
 * Create new Layout Context and then join it using: POST /context and POST /context/{contextId}/devices
 *
 * In most circumstances {@link DMAppLayoutIO#setupContextAndDmapp} should be used instead.
 *
 * @returns {Promise<Context>}
 */
DMAppLayoutIO.prototype.createAndJoinContext = function() /* -> Promise<Context obj> */ {
	const self = this;
	return self.createContext().then(function(context) {
		return self.joinContext(context.contextId);
	});
};

/**
 * Join Layout Context using: POST /context/{contextId}/devices
 *
 * In most circumstances {@link DMAppLayoutIO#setupContextAndDmapp} should be used instead.
 *
 * @param {string} contextId Context to join
 * @returns {Promise<Context>}
 */
DMAppLayoutIO.prototype.joinContext = function(contextId) /* -> Promise<Context obj> */ {
	const self = this;
	return self.parentLayout._getProps().then(function(props) {
		return self._contextJoinCommon(self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "/devices?" +
				self._devIdQString2(props.deviceId) + "&orientation=" + props.orientation, props.caps, "Join context: " + contextId, contextId);
	});
};

/**
 * Get current Layout Context using: GET /context/{contextId}
 * @returns {Promise<Context>}
 */
DMAppLayoutIO.prototype.getCurrentContext = function() /* -> Promise<Context obj> */ {
	const self = this;
	const deviceId = self.deviceId;
	const result = self.makeAjaxPromiseNX({
		method: "GET",
		url: self.dMAppController._getUrl('layoutService') + "/context?" + self._devIdQString2(deviceId),
		dataType: "json",
	}).addBlockObject(self.parentLayout._statusUpdateValve).setTitle("Get current context of device").exec().then(function(info) {
		if (info.status === 200) {
			return self._changeContext(info.data).then(function() {
				return info.data;
			});
		} else {
			self.logger.error("getCurrentContext: wrong status: " + info.status, info);
			throw info;
		}
	}, function(info) {
		if (info.status === 404) {
			if (self.parentLayout.contextId != null) {
				self.logger.error("getCurrentContext: attempted to get current context of device but unexpectedly got a 404, this device is no longer in a context, leaving context");
				self.dMAppController.errorSignals.contextEjection.raise();
			}
			self._changeContext(null);
			return null;
		} else {
			self.logger.error("getCurrentContext: failed: " + info.status, info);
			throw info;
		}
	});
	return result;
};

DMAppLayoutIO.prototype._contextLeaveCommon = function(urlSuffix) /* -> Promise<> */ {
	const self = this;
	if (self.parentLayout.contextId == null) {
		return Promise.reject("Cannot leave context, no current context");
	}
	return self.makeAjaxPromiseNX({
		method: "DELETE",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + self.parentLayout.contextId + urlSuffix,
	}).setTitle("Leave context: " + self.parentLayout.contextId).exec().then(function() {
		self._changeContext(null);
		return;
	});
};

/**
 * Leave current Layout Context using: DELETE /context/{contextId}/devices/{deviceId}
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.leaveContext = function() /* -> Promise<> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self._contextLeaveCommon("/devices/" + deviceId + "?reqDeviceId=" + deviceId);
};

/**
 * Leave and destroy current Layout Context using: DELETE /context/{contextId}
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.leaveAndDestroyContext = function() /* -> Promise<> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self._contextLeaveCommon("?reqDeviceId=" + deviceId);
};

/**
 * Get Context information by context ID using: GET /context/{contextId}
 * @param {string} contextId Context ID to query
 * @returns {Promise<Context>}
 */
DMAppLayoutIO.prototype.getContextInformation = function(contextId) /* -> Promise<> */ {
	const self = this;
	return self.makeAjaxPromiseNX({
		method: "GET",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "?reqDeviceId=" + self.deviceId,
		dataType: "json",
	}).setTitle("Get context information: " + contextId).exec().then(function(info) {
		return info.data;
	});
};

/**
 * Load component from URL
 * @param {string} url
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.loadComponentFromUrl = function(url) /* -> Promise<> */ {
	const self = this;
	const orig_url = url;
	const info = {};
	const filters = this.parentLayout._componentUrlTransforms;
	for (let i = 0; i < filters.length; i++) {
		url = filters[i](url);
	}
	if (url !== orig_url) {
		self.logger.info("loadComponentFromUrl: filter transform: " + orig_url + " --> " + url);
		info.orig_url = orig_url;
	}
	info.url = url;
	let p = this.parentLayout._componentUrlMap.get(url);
	if (!p) {
		self.logger.info("loadComponentFromUrl about to load: URL: " + url);
		p = new Promise(function(resolve, reject) {
			Polymer.Base.importHref(url, function(val) {
				self.logger.info("loadComponentFromUrl success: URL: " + url);
				self.parentLayout.emit("_postLoadComponentFromUrl", {
					url: url,
					link: val,
				});
				resolve(val);
			}, function(e) {
				const msg = "loadComponentFromUrl failed: URL: " + url;
				self.logger.error(msg);
				reject(msg);
			}, false);
		});
		this.parentLayout._componentUrlMap.set(url, p);
	}
	return p.then(function(result) {
		info.result = result;
		return info;
	});
};


/**
 * Load DMApp from URLs.
 * This will fail when called when not part of a Context.
 *
 * In most circumstances {@link DMAppLayoutIO#setupContextAndDmapp} should be used instead.
 *
 * @param {string} timelineUrl
 * @param {string} layoutReqsUrl
 * @returns {Promise<DMApp>}
 */
DMAppLayoutIO.prototype.loadDmApp = function(timelineUrl, layoutReqsUrl) /* -> Promise<DMApp> */ {
	const self = this;
	if (self.parentLayout.contextId == null) {
		return Promise.reject("Cannot load DMApp, not part of a context");
	}

	const activeLatch = self.parentLayout._activeDMAppJoins.latch();
	const deviceId = self.deviceId;
	const contextId = self.parentLayout.contextId;
	const res = self.makeAjaxPromiseNX({
		method: "POST",
		data: JSON.stringify({
			timelineDocUrl: timelineUrl,
			layoutReqsUrl: layoutReqsUrl,
			timelineServiceUrl: self.dMAppController._getUrl('timelineService'),
			extLayoutServiceUrl: self.dMAppController._getUrl('layoutServiceFromTimelineService') || self.dMAppController._getUrl('layoutService'),
		}),
		contentType: "application/json; charset=utf-8",
		dataType: "json",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "/dmapp?reqDeviceId=" + deviceId,
	}).setTitle("Load DMApp: timeline: " + timelineUrl + ", layout: " + layoutReqsUrl).exec().then(function(dmApp) {
		self.parentLayout._handleDmApp(dmApp.data, contextId);
		return dmApp.data;
	});
	res.finally(activeLatch);
	return res;
};

DMAppLayoutIO.prototype._getDmAppById = function(dmAppId, title) /* -> Promise<DMApp> */ {
	const self = this;
	if (self.parentLayout.contextId == null) {
		return Promise.reject("Cannot get DMApp, not part of a context");
	}

	const deviceId = self.deviceId;
	const contextId = self.parentLayout.contextId;
	return self.makeAjaxPromiseNX({
		method: "GET",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "/dmapp/" + dmAppId + "?reqDeviceId=" + deviceId,
		dataType: "json",
	}).setTitle(title).exec().then(function(dmApp) {
		self.parentLayout._handleDmApp(dmApp.data, contextId);
		return dmApp.data;
	});
};

/**
 * Join DMApp by ID.
 * This will fail when called when not part of a Context.
 *
 * In most circumstances {@link DMAppLayoutIO#setupContextAndDmapp} should be used instead.
 *
 * @param {string} dmAppId
 * @returns {Promise<DMApp>}
 */
DMAppLayoutIO.prototype.joinDmApp = function(dmAppId) /* -> Promise<DMApp> */ {
	const activeLatch = this.parentLayout._activeDMAppJoins.latch();
	const res = this._getDmAppById(dmAppId, "Join DMApp: " + dmAppId);
	res.finally(activeLatch);
	return res;
};

/**
 * Refresh DMApp if necessary.
 * This will fail when called when not part of a Context and DMApp.
 * This should not be called by the user under normal circumstances.
 *
 * @returns {Promise<DMApp>}
 */
DMAppLayoutIO.prototype.refreshDmApp = function() /* -> Promise<DMApp> */ {
	const self = this;
	if (self.parentLayout.dmAppId == null) {
		return Promise.reject("Cannot refresh DMApp, no DMApp loaded");
	}
	if (!self.parentLayout._shouldApplyRestLayout()) {
		self.logger.info("_shouldApplyRestLayout() returned false, ignoring call to refreshDmApp()");
		return Promise.resolve(null);
	}
	return self._getDmAppById(self.parentLayout.dmAppId, "Refresh DMApp: " + self.parentLayout.dmAppId).catch(function(info) {
		if (info.status === 404) {
			self.logger.error("refreshDmApp: attempted to get currently joined DMApp but unexpectedly got a 404, the DMApp is gone, leaving DMApp");
			self.dMAppController.errorSignals.contextEjection.raise();
			self.parentLayout._handleDmApp(null);
			return self.getCurrentContext().then(function() { return null; });
		} else {
			self.logger.error("refreshDmApp: failed: " + info.status, info);
			throw info;
		}
	});
};

/**
 * Leave current DMApp.
 *
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.leaveDmApp = function() /* -> Promise<> */ {
	return Promise.resolve(this.parentLayout._handleDmApp(null));
};

/**
 * Unload current DMApp.
 * This will fail when called when not part of a Context and DMApp.
 *
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.unloadDmApp = function() /* -> Promise<> */ {
	const self = this;
	if (self.parentLayout.contextId == null) {
		return Promise.reject("Cannot unload DMApp, not part of a context");
	}
	if (self.parentLayout.dmAppId == null) {
		return Promise.reject("Cannot unload DMApp, no DMApp loaded");
	}

	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "DELETE",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + self.contextId + "/dmapp/" + self.dmAppId + "?reqDeviceId=" + deviceId,
	}).setTitle("Unload DMApp").exec().then(function(dmApp) {
		self.parentLayout._handleDmApp(null);
		return;
	});
};

/**
 * Get DMApp list for current Context.
 * This will fail when called when not part of a Context.
 *
 * @returns {Promise<DMAppId>}
 */
DMAppLayoutIO.prototype.getDmAppList = function() /* -> Promise<DMAppId array> */ {
	const self = this;
	if (self.contextId == null) {
		return Promise.reject("Cannot get DMApp list, not part of a context");
	}

	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "GET",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + self.parentLayout.contextId + "/dmapp/?reqDeviceId=" + deviceId,
		dataType: "json",
	}).setTitle("Get DMApp list").exec().then(function(dmApp) {
		return dmApp.data;
	});
};

DMAppLayoutIO.prototype._getDmAppComponentUrl = function(dmAppComponent) /* -> URL string */ {
	const info = this.parentLayout._getDmAppComponentInfo(dmAppComponent);

	if (info.contextId == null) {
		this.logger.throwError("Cannot perform action on DMApp component, not part of a context");
	}
	if (info.dmAppId == null) {
		this.logger.throwError("Cannot perform action on DMApp component, no DMApp loaded");
	}
	if (info.shortId == null) {
		this.logger.throwError("Cannot perform action on DMApp component, no DMAppComponent given");
	}
	if (info.nonRoot) {
		this.logger.throwError("Cannot perform action on DMApp component, not a top-level component");
	}
	if (info.layoutIndependent) {
		this.logger.warn("Returning layout service URL of layout-independent DMApp component, using the URL may fail");
	}

	return this.dMAppController._getUrl('layoutService') + "/context/" + info.contextId + "/dmapp/" + info.dmAppId +
			"/component/" + info.shortId;
};

/**
 * Refresh DMApp component info
 * This should not be called by the user under normal circumstances.
 *
 * @param {DMAppComponent} dmAppComponent DMApp component
 * @returns {Promise<DMAppComponentInfo>} DMApp component info
 */
DMAppLayoutIO.prototype.updateDMAppComponent = function(dmAppComponent) /* -> Promise<DM App Component Info> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "GET",
		url: self._getDmAppComponentUrl(dmAppComponent) + "?reqDeviceId=" + deviceId,
		dataType: "json",
	}).setTitle("Get and update DMApp component: " + this.parentLayout._getDmAppComponentShortId(dmAppComponent)).exec().then(function(info) {
		dmAppComponent.setComponentInfo(info.data);
		return info.data;
	});
};

/**
 * Get DMApp component info by ID
 * This does not set/refresh any internal or component state.
 *
 * @param {string} dmAppComponentId DMApp component ID
 * @returns {Promise<DMAppComponentInfo>} DMApp component info
 */
DMAppLayoutIO.prototype.getDMAppComponentInfoById = function(dmAppComponentId) /* -> Promise<DM App Component Info> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "GET",
		url: self._getDmAppComponentUrl(dmAppComponentId) + "?reqDeviceId=" + deviceId,
		dataType: "json",
	}).setTitle("Get DMApp component info: " + this.parentLayout._getDmAppComponentShortId(dmAppComponentId)).exec().then(function(info) {
		return info.data;
	});
};

/**
 * Set DMApp component priority state using: POST /context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/setPriority.
 * This will fail when called when not part of a Context and DMApp.
 *
 * Priority values of 0 disable the component.
 * Priority values > 0 enabled the component, subject to prioritised resource availablity.
 *
 * @param {string} dmAppComponentId DMApp component ID
 * @param {!object} priority DMAppComponent priority object
 * @param {!number} priority.personalPriority Personal priority value
 * @param {!number} priority.communalPriority Communal priority value
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.setDMAppComponentPriority = function(dmAppComponentId, priority) /* -> Promise<DM App Component Info> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "POST",
		url: self._getDmAppComponentUrl(dmAppComponentId) + "/actions/setPriority?reqDeviceId=" + deviceId,
		data: JSON.stringify(priority),
		contentType: "application/json; charset=utf-8",
		dataType: "json",
	}).setTitle("Set DMApp component priority: " + this.parentLayout._getDmAppComponentShortId(dmAppComponentId) + " -> " + JSON.stringify(priority)).exec().then(function(info) {
		return info.data;
	});
};

DMAppLayoutIO.prototype._statusUpdateApCfg = function(statusArray) {
	const cfg = {};
	for (let i = 0; i < statusArray.length; i++) {
		if (statusArray[i].status === "idle") {
			cfg.statusToServiceErrorStateOverride = function(ok, ap, result) {
				if (result.status >= 500 && result.status <= 599 && result.jqXHR && result.jqXHR.responseText) {
					const res = /no such component|components .+? not found/i.exec(result.jqXHR.responseText);
					if (res) {
						if (ap.getActiveLogger()) ap.getActiveLogger().info("Ignoring 5XX error (wrt service error state) when posting idle status as layout service reports '" + res[0] + "'");
						return true;
					}
				}
				return ok;
			};
			break;
		}
	}
	return cfg;
};

/**
 * Set DMApp component status object
 * This should not be called by the user under normal circumstances.
 *
 * @param {DMAppComponent} dmAppComponent DMApp component
 * @param {Object} statusObj
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.postDMAppComponentStatus = function(dmAppComponent, statusObj) /* -> Promise<> */ {
	const self = this;
	const parentLayout = this.parentLayout;
	const info = parentLayout._getDmAppComponentInfo(dmAppComponent);
	const cr = parentLayout.componentContainer.getComponentRefById(info.fullId);
	const statusStr = JSON.stringify(statusObj);
	if (!cr) {
		const msg = "Attempted to POST component status update to '" + statusStr + "' for component without ComponentRef: " + info.shortId;
		self.logger.warn(msg);
		return Promise.reject(msg);
	}
	parentLayout._pendingCrInits.delete(cr);
	if (!parentLayout.postComponentStatuses) return Promise.resolve();

	const postSingle = function() {
		const deviceId = self.deviceId;
		const ap = self.makeAjaxPromiseNXCfg(self._statusUpdateApCfg([statusObj]), {
			method: "POST",
			data: statusStr,
			contentType: "application/json; charset=utf-8",
			url: self._getDmAppComponentUrl(dmAppComponent) + "/actions/status?reqDeviceId=" + deviceId,
		});
		ap.setTitle("component status: " + info.shortId + " -> " + statusStr);
		const result = ap.exec();
		result.then(function() {
			// Posting a status update is likely to result in a layout change soon.
			// Trigger an "immediate" refresh if in REST polling mode
			self._websocketRestFallbackCtl(self.WS_FALLBACK_TIMEOUT.IMMEDIATE);
		});
		return result;
	};

	return cr.statusUpdateQueue.enqueue(function() {
		if (parentLayout.contextId && parentLayout.dmAppId && !cr.isLayoutIndependent()) {
			if (parentLayout.batchComponentStatuses) {
				const batchStatus = {
					componentId: info.shortId,
					status: statusObj.status,
					duration: statusObj.duration,
					revision: statusObj.revision,
				};
				return self._batchPostDMAppComponentStatus(info.contextId, info.dmAppId, batchStatus).catch(function() {
					return postSingle();
				});
			} else {
				return postSingle();
			}
		}
	}, "POSTing status change to: " + statusStr);
};

DMAppLayoutIO.prototype._batchPostDMAppComponentStatus = function(contextId, dmAppId, statusObj) /* -> Promise<> */ {
	const self = this;
	const key = contextId + "|" + dmAppId;
	let info = self.statusUpdateBatches.get(key);
	if (!info) {
		info = {
			contextId: contextId,
			dmAppId: dmAppId,
			statuses: new Map(),
			completion: waitable(),
		};
		info.exec = function() {
			self.statusUpdateBatches.delete(key);
			const statusArray = Array.from(info.statuses.values());
			const ap = self.makeAjaxPromiseNXCfg(self._statusUpdateApCfg(statusArray), {
				method: "POST",
				data: JSON.stringify(statusArray),
				contentType: "application/json; charset=utf-8",
				url: self.dMAppController._getUrl('layoutService') + "/context/" + info.contextId + "/dmapp/" + info.dmAppId + "/components/status?reqDeviceId=" + self.deviceId,
			});
			ap.setTitle("Bulk component status: " + statusArray.map(function(item) {
				return item.componentId + " -> " + JSON.stringify({
					status: item.status,
					duration: item.duration,
					revision: item.revision,
				});
			}).join(", "));
			const result = ap.exec();
			result.then(function() {
				// Posting a status update is likely to result in a layout change soon.
				// Trigger an "immediate" refresh if in REST polling mode
				self._websocketRestFallbackCtl(self.WS_FALLBACK_TIMEOUT.IMMEDIATE);
			});
			info.completion.signal(result);
		};
		self.statusUpdateBatches.set(key, info);
	} else {
		window.clearTimeout(info.timeoutHandle);
	}
	let delay = 50;
	for (let cr of self.parentLayout._pendingCrInits) {
		// Extended delay when 1 or more components are not inited yet
		if (!cr.isLayoutIndependent()) delay = 200;
	}
	info.timeoutHandle = window.setTimeout(info.exec, delay);
	info.statuses.set(statusObj.componentId, statusObj);
	return info.completion;
};

/**
 * Post DMApp component timeline event string
 *
 * @param {DMAppComponent} dmAppComponent DMApp component
 * @param {string} eventId event ID
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.postDMAppComponentTimelineEvent = function(dmAppComponent, eventId) /* -> Promise<> */ {
	const self = this;
	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "POST",
		url: self._getDmAppComponentUrl(dmAppComponent) + "/actions/timelineEvent?reqDeviceId=" + deviceId + "&eventId=" + eventId,
	}).setTitle("Post component timeline event: " + self.parentLayout._getDmAppComponentShortId(dmAppComponent) + " -> " + eventId).exec();
};

/**
 * Post timeline event string
 *
 * @param {string} eventId event ID
 * @param {DMAppComponent=} dmAppComponent optional DMApp component to use as reference for the context ID
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.postTimelineEvent = function(eventId, dmAppComponent) /* -> Promise<> */ {
	const self = this;
	let contextId = this.parentLayout.contextId;
	if (dmAppComponent) {
		const info = this.parentLayout._getDmAppComponentInfo(dmAppComponent);
		if (info.contextId) contextId = info.contextId;
	}
	if (contextId == null) {
		this.logger.throwError("Cannot post timeline event, not part of a context");
	}
	return self.makeAjaxPromiseNX({
		method: "PUT",
		url: self.dMAppController._getUrl('timelineService') + "/context/" + contextId + "/timelineEvent?eventId=" + eventId,
	}).setTitle("Post timeline event: " + eventId).exec();
};

/**
 * Orientation change event.
 *
 * @event DMAppLayout#orientationChange
 * @type {object}
 * @property {string} newOrientation
 */

/**
 * Call to notify this instance that the orientation has changed
 * @fires DMAppLayout#orientationChange
 *
 * @param {string} orientation new current orientation
 */
DMAppLayoutIO.prototype.notifyOrientationChanged = function(orientation) /* -> void */ {
	const self = this;
	self.parentLayout.emit('orientationChange', Object.freeze({
		newOrientation: orientation,
	}));
	self.logger.info("Orientation change: " + orientation);

	if (this.parentLayout.contextId == null) return;

	const deviceId = self.deviceId;
	return self.makeAjaxPromiseNX({
		method: "PUT",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + self.parentLayout.contextId + "/devices/" + deviceId +
				"/orientation?reqDeviceId=" + deviceId + "&orientation=" + orientation,
	}).setTitle("Notify orientation change: " + orientation).exec().catch(function (e) {
		self.logger.error("Failed to notify layout of orientation change: ", e);
	});
};

/**
 * Call to notify the layout service that the clock has changed
 * using: POST /context/{contextId}/dmapp/{dmappId}/actions/clockChanged
 * This will fail when called when not part of a Context and DMApp.
 *
 * This should not be called by the user under normal circumstances.
 *
 * @param {Object} infoJson
 * @param {number} infoJson.wallClock Wall clock time in s
 * @param {number} infoJson.contextClock Context clock time in s
 * @param {number=} infoJson.contextClockRate Relative Context clock rate
 * @returns {Promise}
 */
DMAppLayoutIO.prototype.notifyClockChange = function(infoJson) /* -> Promise<> */ {
	const self = this;
	if (this.parentLayout.contextId == null) {
		this.logger.throwError("Cannot notify clock change, not part of a context");
	}
	if (this.parentLayout.dmAppId == null) {
		this.logger.throwError("Cannot notify clock change, no DMApp loaded");
	}

	const deviceId = self.deviceId;
	const ap = self.makeAjaxPromiseNX({
		method: "POST",
		data: JSON.stringify(infoJson),
		contentType: "application/json; charset=utf-8",
		url: self.dMAppController._getUrl('layoutService') + "/context/" + self.parentLayout.contextId + "/dmapp/" + self.parentLayout.dmAppId +
				"/actions/clockChanged?reqDeviceId=" + deviceId,
	});
	ap.setTitle("Notify clock change: " + JSON.stringify(infoJson));
	const p = ap.exec();
	p.catch(function (e) {
		self.logger.error("Failed to notify layout of clock change: ", e);
	});
	return p;
};

DMAppLayoutIO._mkConnDbg = function(parentLayout) {
	let failDbg = parentLayout._connFailDbg;
	if (!failDbg) {
		failDbg = {};
		failDbg.activeRefCount = new Signal.RefCountSignal();
		failDbg.lastCheck = null;
		failDbg.foundFailure = false;
		if (parentLayout.dMAppController.advDebugMode) failDbg = DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(failDbg, parentLayout.logger, "DMAppLayout._connFailDbg");
		Object.defineProperty(parentLayout, '_connFailDbg', { value: failDbg });
	}
	return failDbg;
};

DMAppLayoutIO.prototype._connFailCheck = function(info) {
	if (info.errorThrown === "timeout") {
		const failDbg = DMAppLayoutIO._mkConnDbg(this.parentLayout);
		if (failDbg.activeRefCount.getValue() || failDbg.foundFailure) return;
		if (failDbg.lastCheck && this.dMAppController.monotonicNow() - failDbg.lastCheck < 120000) return;
		DMAppLayoutIO._diagnoseLayoutService(this.parentLayout);
	}
};

DMAppLayoutIO._diagnoseLayoutService = function(parentLayout, logOutputFunc) {
	const failDbg = DMAppLayoutIO._mkConnDbg(parentLayout);
	const activeLatch = failDbg.activeRefCount.latch();
	const logger = parentLayout.logger.makeChildLogger("ServiceDiag");
	if (logOutputFunc) {
		logger.addMessageOutput(logOutputFunc);
	}
	const io = new DMAppLayoutIO(parentLayout, logger, { noConnCheck: true });
	const p = io._layoutServiceConnectivityCheck().then(function() {
		io.logger.info("Service up: Initiating diagnostics");
		return io._diagnoseLayoutServiceCheckLocks(failDbg);
	}).catch(function(info) {
		io.logger.info("Layout service failed connectivity check, aborting diagnostics: ", info);
	});
	p.finally(function() {
		failDbg.lastCheck = parentLayout.dMAppController.monotonicNow();
		activeLatch();
	});
	return p;
};

DMAppLayoutIO.prototype._layoutServiceConnectivityCheck = function() {
	const deviceId = this.deviceId;
	const upCheck = this.makeAjaxPromiseNX({
		method: "OPTIONS",
		url: this.dMAppController._getUrl('layoutService') + "/context/non-existant?reqDeviceId=" + deviceId + "_connectivity_check",
		timeout: 3000,
	}).setTitle("Connectivity check").exec();
	return upCheck;
};

DMAppLayoutIO.prototype._diagnoseLayoutServiceCheckLocks = function(failDbg) {
	const self = this;
	const deviceId = self.deviceId;

	const promises = [];
	const wrap = function(p) {
		return p.then(function() {
			return false;
		}, function(info) {
			return info.errorThrown === "timeout";
		});
	};

	const handleFailure = function(msg) {
		self._layoutServiceConnectivityCheck().then(function() {
			failDbg.foundFailure = true;
			self.logger.error(msg);
			self.dMAppController.devDialogLogger.error(msg + " Check service logs and retry once service has been restarted.");
			self.dMAppController.errorSignals.services.registerReference({}); // permanently set signal raised
		});
	};

	const allContextLockCheck = self.makeAjaxPromiseNX({
		method: "HEAD",
		url: self.dMAppController._getUrl('layoutService') + "/context?reqDeviceId=" + deviceId + "_check&deviceId=" + deviceId + "_check",
	}).setTitle("All context read lock check").exec();
	const contextWriteLockCheck = self.makeAjaxPromiseNX({
		method: "POST",
		url: self.dMAppController._getUrl('layoutService') + "/context?reqDeviceId=" + deviceId + "_check",
		dataType: "json",
	}).setTitle("Context table write lock check").exec();
	promises.push(Promise.all([wrap(allContextLockCheck), wrap(contextWriteLockCheck)]).then(function(stuckList) {
		if (stuckList[0] || stuckList[1]) {
			handleFailure("Layout service appears to be stuck: possible inference: a lock has been acquired and left locked.");
		}
	}));

	if (self.parentLayout.contextId != null) {
		// check current context
		const contextId = self.parentLayout.contextId;
		promises.push(wrap(self.makeAjaxPromiseNX({
			method: "DELETE",
			url: self.dMAppController._getUrl('layoutService') + "/context/" + contextId + "/devices/non-existant?reqDeviceId=" + deviceId + "_check",
			dataType: "text",
		}).setTitle("Current context write lock check").exec()).then(function(stuck) {
			if (stuck) {
				handleFailure("Layout service appears to be stuck: possible inference: context ID: '" + contextId + "' lock has been acquired and left locked.");
			}
		}));
	}

	return Promise.all(promises);
};

try {
	Object.freeze(DMAppLayoutIO.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppLayoutIO;
