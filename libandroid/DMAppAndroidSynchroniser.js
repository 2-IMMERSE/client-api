/************************************************************************/
/* FILE:                DMAppAndroidSynchroniser.js                     */
/* DESCRIPTION:         DMApp Android synchroniser lib interface        */
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
const DMAppCompLib = require('DMAppCompLib');

const Promise = DMAppClientLib.deps.promise;
const URI = DMAppClientLib.deps.URI;
const inherits = DMAppClientLib.deps.inherits;

/* globals cordova */

/**
 * @classdesc
 *
 * Synchroniser functionality for companion apps on Android devices.
 * Requires cordova plugin: [AndroidSyncKit de.irt.androidsynckit]{@link https://github.com/2-IMMERSE/cordova-synckit-android/tree/master/android}.
 * May be constructed before cordova and cordova plugins are initialised.
 *
 * @implements CiiSyncHandler
 * @extends CiiSyncHandlerBase
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {!DMAppComp} dMAppComp parent companion controller
 */
function DMAppAndroidSynchroniser(dMAppController, dMAppComp) {
	const self = this;
	DMAppCompLib.CiiSyncHandlerBase.call(this, dMAppController, dMAppComp, dMAppController.timeline.monotonicClock, "DMAppAndroidSynchroniser");

	this.logger.info("DMAppAndroidSynchroniser version: " + require('__VERSION__'));

	const syncKitPromise = new Promise(function(resolve, reject) {
		document.addEventListener('deviceready', function() {
			resolve(cordova.require("de.irt.androidsynckit.AndroidSyncKit"));
		}, false);
	});

	Object.defineProperty(self, 'syncKitPromise',  { value: syncKitPromise });
	Object.defineProperty(self, 'syncInfoMap',     { value: new WeakMap() });
	self.dMAppComp.setCiiSyncHandler(this);
	self._nextSyncLogId = 0;
	self._nextSyncTimelineId = 0;
}
inherits(DMAppAndroidSynchroniser, DMAppCompLib.CiiSyncHandlerBase);

DMAppAndroidSynchroniser.prototype.sync = function(dMAppController, url, name) {
	const self = this;
	self._doSync(dMAppController, url, name);
	self.syncKitPromise.then(function(SyncKit) {
		self._initSync(SyncKit, url, name);
	});
};

DMAppAndroidSynchroniser.prototype._initSync = function(SyncKit, url, name) {
	const self = this;
	if (!self._synced) return;
	if (self._destroyed) return;
	if (self._synchroniser) self.logger.throwError("_initSync() called when this._synchroniser already exists");

	self._reinit = Function.prototype.bind.apply(this._initSync, [this].concat([].slice.call(arguments)));
	if (self._syncReinitTimer != null) {
		window.clearTimeout(self._syncReinitTimer);
		delete self._syncReinitTimer;
	}

	const logId = "S" + self._nextSyncLogId++;
	const logger = self.logger.makeChildLogger(logId);
	logger.debug("Constructing Synchroniser for URL: " + url + ", name: " + name);
	const synchroniser = new SyncKit.Synchroniser({
		url: url,
		name: name,
		initCallback: function() {
			if (synchroniser._destroyed) {
				logger.error("Synchroniser destroyed before call to initCallback, aborting");
				return;
			}
			logger.debug("Synchroniser constructed");
			self._obtainInfo(synchroniser);
		},
		errorCallback: function(msg) {
			logger.error("Synchroniser error (constructor): '" + msg + (synchroniser._destroyed ? "', after destruction" : "'"));
		},
		wallclockUpdatePeriodMillis: 5000,
	});
	self._synchroniser = synchroniser;
	self.syncInfoMap.set(synchroniser, {
		logId: logId,
		logger: logger,
		url: new URI(url),
	});
	self.debugInfo.syncLogId = logId;
	self.clock.emit("debuginfochange");
};

DMAppAndroidSynchroniser.prototype._obtainInfo = function(synchroniser) {
	const self = this;
	if (!self._synced) return;
	if (self._destroyed) return;
	if (self._timeoutHandle != null) window.clearTimeout(self._timeoutHandle);
	const info = self.syncInfoMap.get(synchroniser);
	const logger = info.logger;
	self._timeoutHandle = window.setTimeout(function() {
		const msg = "Timed out waiting for timelines to become available, trying again";
		logger.warn(msg);
		self.debugInfo.lastObtainResult = msg;
		self._setClockAvailability(false);
		self._destroySynchroniser();
		self._reinit();
		self.clock.emit("debuginfochange");
	}, 10000);
	let haveInitedTimeline = false;
	logger.info("About to execute synchroniser obtain");
	synchroniser.obtainSynchronisationInformation(self._protectCallbackObject(synchroniser, logger, "_obtainInfo", {
		obtainStartedCallback: function() {
			logger.debug("Synchroniser obtain started");
			self.debugInfo.lastObtainResult = "Started";
			self.clock.emit("debuginfochange");
		},
		contentCallback: function(contentId) {
			logger.debug("Synchroniser content ID change: " + contentId);
			self.debugInfo.lastContentId = contentId;
			self.clock.emit("debuginfochange");
		},
		timelinesAvailableCallback: function(timelines) {
			logger.debug("Synchroniser timelines available: " + JSON.stringify(timelines));
			if (self._timeoutHandle != null) {
				window.clearTimeout(self._timeoutHandle);
				delete self._timeoutHandle;
			}
			if (synchroniser._timelineId) {
				const current = timelines.find(function(item) {
					return item.id === synchroniser._timelineId;
				});
				if (current) {
					logger.debug("Currently joined timeline (" + synchroniser._timelineId + ") is still present, no change");
					return;
				} else {
					logger.debug("Currently joined timeline (" + synchroniser._timelineId + ") is no longer present, stopping synchroniser");
					delete synchroniser._timelineId;
					synchroniser.stop(function(err) {
						if (err) {
							logger.error("Error in synchroniser stop: ", err);
						}
					});
				}
			}
			if (timelines.length > 0) {
				haveInitedTimeline = true;
				self._syncTimeline(synchroniser, timelines[0].id);
				self.debugInfo.lastObtainResult = "Using timeline id: " + timelines[0].id + ", of " + timelines.length + " timelines";
			} else {
				const msg = "Synchroniser found 0 timelines, waiting for further updates";
				logger.warn(msg);
				self.debugInfo.lastObtainResult = msg;
			}
			self.clock.emit("debuginfochange");
		},
		syncMessageCallback: function(msg) {
			logger.debug("Synchroniser message received: ", msg);
			self.debugInfo.lastSyncMessage = JSON.stringify(msg);

			const expected_hostname = info.url.hostname();
			const fixup = function(prop, name, method) {
				if (msg[prop]) {
					const uri = new URI(msg[prop]);
					const current_hostname = uri.hostname();
					if (current_hostname !== expected_hostname) {
						uri.hostname(expected_hostname);
						logger.warn("Hostname mismatch in " + name + " URL: " + msg[prop] + ", expected: " + expected_hostname + ", got: " + current_hostname + ", adjusting to: " + uri);
						synchroniser[method](uri.toString(), function() {
							logger.debug("Synchroniser " + name + " URL fixup done");
						}, function(err) {
							logger.error("Synchroniser " + name + " URL fixup error: " + msg);
						});
						self.debugInfo[method] = uri;
					}
				}
			};
			fixup('tsUrl', 'Timeline Sync', 'overrideTimelineSyncUrl');
			fixup('wcUrl', 'Wallclock', 'overrideWallclockUrl');

			self.clock.emit("debuginfochange");
		},
		errorCallback: function(msg) {
			logger.error("Synchroniser error (obtain info): " + msg);
			self.debugInfo.lastError = msg;
			self.clock.emit("debuginfochange");
		},
	}));
};

DMAppAndroidSynchroniser.prototype._scheduleReinit = function() {
	const self = this;
	self._destroySynchroniser();
	self._syncReinitTimer = window.setTimeout(function() {
		delete self._syncReinitTimer;
		self._reinit();
	}, 5000);
};

DMAppAndroidSynchroniser.prototype._syncTimeline = function(synchroniser, timelineId) {
	const self = this;
	if (!self._synced) return;
	if (self._destroyed) return;
	const logId = "T" + self._nextSyncTimelineId++;
	const logger = self.logger.makeChildLogger(logId);
	logger.debug("Synchronising with timeline: " + timelineId);
	const dbgInfo = {
		id: timelineId,
		started: false,
		wallclockSynced: false,
		haveProperties: false,
		logId: logId,
	};
	self.debugInfo.timeline = dbgInfo;
	self._clockSpeed = null;
	synchroniser._timelineId = timelineId;
	logger.info("About to start synchroniser");
	synchroniser.start(self._protectCallbackObject(synchroniser, logger, "_syncTimeline", {
		timelineId: timelineId,
		startedCallback: function() {
			logger.debug("Synchroniser started");
			dbgInfo.started = true;
			self.clock.emit("debuginfochange");
		},
		wallclockSyncedCallback: function() {
			logger.debug("Synchroniser wallclock synced");
			dbgInfo.wallclockSynced = true;
			self.clock.emit("debuginfochange");
		},
		wallclockUpdatedCallback: function(timestamp) {
			logger.debug("Synchroniser wallclock updated: " + timestamp);
			self._applyTimestamp(timestamp, self._clockSpeed);
			if (self._timelineWallclockTimer != null) window.clearTimeout(self._timelineWallclockTimer);
			self._timelineWallclockTimer = window.setTimeout(function() {
				delete self._timelineWallclockTimer;
				const msg = "Timed out waiting for further wallclock updates";
				logger.warn(msg);
				self._setClockAvailability(false);
				self._scheduleReinit();
				dbgInfo.availability = msg;
				dbgInfo.haveProperties = false;
				self.clock.emit("debuginfochange");
			}, 10000);
		},
		availableCallback: function() {
			logger.debug("Synchroniser available");
			dbgInfo.availability = "Available";
			self.clock.emit("debuginfochange");
		},
		unavailableCallback: function() {
			logger.warn("Synchroniser unavailable, trying again in 5s");
			self._setClockAvailability(false);
			self._scheduleReinit();
			dbgInfo.availability = "Unavailable, trying again in 5s";
			dbgInfo.haveProperties = false;
			self.clock.emit("debuginfochange");
		},
		propertiesChangedCallback: function(timestamp, properties) {
			logger.debug("Synchroniser properties changed: " + timestamp + ", properties: " + JSON.stringify(properties));
			if (properties.availability === false) {
				self._clockSpeed = null;
				self._setClockAvailability(false);
			} else {
				self._clockSpeed = properties.speedMultiplier;
				self._applyTimestamp(timestamp, properties.speedMultiplier);
			}
			dbgInfo.haveProperties = true;
			self.clock.emit("debuginfochange");
		},
		errorCallback: function(msg) {
			logger.error("Synchroniser error (sync timeline): " + msg + ", scheduling reinit in 5s");
			dbgInfo.lastError = msg;
			self._scheduleReinit();
			self.clock.emit("debuginfochange");
		},
	}));
};

DMAppAndroidSynchroniser.prototype._destroySynchroniser = function() {
	this._setClockAvailability(false);
	if (this._synchroniser) {
		this.logger.info("Destroying synchroniser instance");
		Object.defineProperty(this._synchroniser, '_destroyed', { value: true });
		this._synchroniser.destroy();
		delete this._synchroniser;
	}
	if (this._timelineWallclockTimer != null) {
		window.clearTimeout(this._timelineWallclockTimer);
		delete this._timelineWallclockTimer;
	}
	if (this._syncReinitTimer != null) {
		window.clearTimeout(this._syncReinitTimer);
		delete this._syncReinitTimer;
	}
	if (this._timeoutHandle != null) {
		window.clearTimeout(this._timeoutHandle);
		delete this._timeoutHandle;
	}
};

DMAppAndroidSynchroniser.prototype.unsync = function() {
	this._doUnsync();
	this._destroySynchroniser();
};

DMAppAndroidSynchroniser.prototype._protectCallbackObject = function(synchroniser, logger, name, callbacks) {
	const out = {};
	for (let prop in callbacks) {
		const val = callbacks[prop];
		if (typeof val === 'function') {
			const propc = prop;
			out[prop] = function() {
				if (synchroniser._destroyed) {
					logger.warn("Callback on destroyed synchroniser was unexpectedly called: " + name + ", " + propc);
					return;
				}
				return val.apply(this, arguments);
			};
		} else {
			out[prop] = val;
		}
	}
	return out;
};

DMAppAndroidSynchroniser.prototype.dump = function(dumper) {
	dumper.keyValue("Active", !!this._synchroniser);
	DMAppCompLib.CiiSyncHandlerBase.prototype.dump.call(this, dumper);
};

try {
	Object.freeze(DMAppAndroidSynchroniser.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppAndroidSynchroniser;
