/************************************************************************/
/* FILE:                DMAppTvEmuSync.js                               */
/* DESCRIPTION:         DMApp TV emulator sync                          */
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

const SyncMaster = require('dvbcsstv-lib/src/js/SyncMaster');
const Events = require('dvbcsstv-lib/src/js/event');
const TimelineState = require('dvbcsstv-lib/src/js/TimelineState');

const defaultServerUrl = "ws://127.0.0.1:7681/server";

const DMAppClientLib = require('DMAppClientLib');

/**
 * @classdesc
 *
 * TV emulator DVB-CSS sync master functionality.
 * Sync defaults to enabled on construction.
 *
 * @implements ExternalSync
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {?Object} options optional options object
 * @param {Clock} [options.clock={@link DMAppTimeline#defaultClock}] override clock to use as sync source
 * @param {string} [options.serverUrl=ws://127.0.0.1:7681/server] override tvemu DVB-CSS sync server URL
 */
function DMAppTvEmuSync(dMAppController, options) {
	const self = this;
	if (!options) options = {};
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DMAppTvEmuSync") });
	Object.defineProperty(self, 'serverUrl',       { value: options.serverUrl || defaultServerUrl });

	Object.defineProperty(self, '_errorFlag',      { value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, null, DMAppClientLib.ErrorUtil.ErrorMode.DEV | DMAppClientLib.ErrorUtil.ErrorMode.WARN,
			"Error connecting/using TV emulator DVB-CSS sync master websocket: " + self.serverUrl + ". Check that TV emulator services are operational, and that only one TV emulator page is running.") });

	this._isSynced = false;

	this.logger.info("DMAppTvEmuSync version: " + require('__VERSION__'));

	if (DMAppTvEmuSync._debugConstructorHooks.length) {
		/* global console */
		console.warn("Executing " + DMAppTvEmuSync._debugConstructorHooks.length + " DMAppTvEmuSync debug constructor hooks");
		if (!options) options = {};
		for (let i = 0; i < DMAppTvEmuSync._debugConstructorHooks.length; i++) {
			DMAppTvEmuSync._debugConstructorHooks[i](this, options);
		}
	}

	Object.defineProperty(self, 'clock',           { value: options.clock || dMAppController.timeline.defaultClock });
	Object.defineProperty(self, 'timeline',        { value: dMAppController.timeline });
	Object.defineProperty(self, 'clockObserver',   { value: new DMAppTvEmuSyncClockObserver(dMAppController, self.clock) });

	DMAppClientLib.argCheck(arguments, 2, self.logger, "DMAppTvEmuSync constructor", options, ['clock', 'serverUrl', 'disabled']);

	Object.defineProperty(self, 'disabled',        { value: !!options.disabled });
	if (options.disabled) {
		this.logger.warn("Disabled by constructor option");
		return;
	}

	self._syncMaster = new SyncMaster({
		cssProxyUrl: this.serverUrl,
		autoReconnect: true,
	});
	self._syncMaster.addEventListener("CiiChange", function() {
		self.lastCiiInfo = self._syncMaster.getCii();
		self.logger.debug("CII change:", JSON.stringify(self.lastCiiInfo));
		self.clock.emit("debuginfochange");
	});
	self.slaveCount = 0;
	self._syncMaster.addEventListener("NrOfSlavesChanged", function(evt) {
		self.slaveCount = evt.nrOfSlaves;
		self.logger.debug("Slave count change:", evt.nrOfSlaves);
		self.clock.emit("debuginfochange");
		if (self._isSynced) {
			// someone has joined or left, send an immediate update to make sure they can get started propmptly
			// the DVB-CSS server does not seem to a property update on join
			self.clockObserver._sendUpdateEvent();
		}
	});
	const ws = self._syncMaster._connector.ws;
	const errorCounter = self.logger.makeFlushableLogEventCounter('warn', { autoFlushTimeout: 120000 }, "TV sync master websocket error(s)");
	self.errorCounter = errorCounter;
	self._errorFlag.on("fall", errorCounter.flush.bind(errorCounter));
	ws.addEventListener("error", function() {
		self._errorFlag.raise();
		errorCounter.event();
	});
	ws.addEventListener("open", function() {
		self.logger.info("TV sync master websocket open");
		errorCounter.flush();
		self._errorFlag.clear();
	});
	ws.addEventListener("close", function() {
		self.logger.warn("TV sync master websocket close");
		self._errorFlag.raise();
	});

	self.enableSync();

	self._pageBeforeUnloadHandler = function() {
		errorCounter.flush();
	};
	window.addEventListener("beforeunload", self._pageBeforeUnloadHandler);

	self._pageUnloadHandler = function() {
		if (self._syncMaster && self._syncMaster.getMediaObserver()) {
			self._syncMaster.setMediaObserver(null);
		}
	};
	window.addEventListener("unload", self._pageUnloadHandler);
}

/** Enable sync if not already enabled */
DMAppTvEmuSync.prototype.enableSync = function() {
	if (this.disabled) return;
	if (this._isSynced) return;
	this._isSynced = true;

	this.timeline.synchroniseExternalToClock(this.clock, this);
};

/** Disable sync if not already disabled */
DMAppTvEmuSync.prototype.disableSync = function() {
	if (!this._isSynced) return;
	this._isSynced = false;

	this.timeline.unsynchroniseFromClock(this.clock, this);
};

DMAppTvEmuSync.prototype.sync = function(info) {
	this.logger.info("Syncing dvbcsstv-lib from clock: " + this.timeline.getClockInfo(this.clock));
	this._syncMaster.setMediaObserver(this.clockObserver);
};

DMAppTvEmuSync.prototype.unsync = function(info) {
	this.logger.info("Unsyncing dvbcsstv-lib from clock: " + this.timeline.getClockInfo(this.clock));
	this._syncMaster.setMediaObserver(null);
};

DMAppTvEmuSync.prototype.syncWhenUnavailable = function() {
	return true;
};

DMAppTvEmuSync.prototype.dump = function(info, dumper) {
	const cat = dumper.subcategory("DMAppTvEmuSync: using dvbcsstv-lib");
	cat.keyValue("Version", require('__VERSION__'));
	cat.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	if (this._syncMaster.getMediaObserver()) {
		cat.keyValue("Sync", "yes");
	} else {
		cat.keyValue("Sync", "no");
	}
	cat.keyValue("Server", this.serverUrl);
	cat.keyValue("CII info", JSON.stringify(this.lastCiiInfo));
	cat.keyValue("Slave count", this.slaveCount);
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 */
DMAppTvEmuSync.prototype.destroy = function() {
	this.errorCounter.flush();
	window.removeEventListener("unload", this._pageUnloadHandler);
	window.removeEventListener("beforeunload", this._pageBeforeUnloadHandler);
	this.disableSync();
	this._syncMaster.setMediaObserver(null);
	this._syncMaster.terminate();
	delete this._syncMaster;
};

DMAppTvEmuSync._debugConstructorHooks = [];

function DMAppTvEmuSyncClockObserver(dMAppController, clock) {
	let self = this;

	Object.defineProperties(self, {
		clock:                 { value: clock },
		dMAppController:       { value: dMAppController },
		updateEvtListener:     { value: self._sendUpdateEvent.bind(self) },
	});

	self.running = false;

	if (dMAppController.advDebugMode) {
		self = DMAppClientLib.DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(this, this.logger, "DMAppTvEmuSyncClockObserver");
	}
}
Events.EventTarget_Mixin(DMAppTvEmuSyncClockObserver.prototype);

/**
 * @returns the object being observed
 **/
DMAppTvEmuSyncClockObserver.prototype.getSubject = function() {
	return this.clock;
};

DMAppTvEmuSyncClockObserver.prototype.start = function() {
	if (!this.running) {
		this.running = true;
		this.clock.on("change", this.updateEvtListener);
		this.clock.on("available", this.updateEvtListener);
		this.clock.on("unavailable", this.updateEvtListener);
		this.updateTimer = window.setInterval(this.updateEvtListener, 10000);
	}

	return this;
};

DMAppTvEmuSyncClockObserver.prototype.stop = function() {
	if (this.running) {
		this.running = false;
		this.clock.removeListener("change", this.updateEvtListener);
		this.clock.removeListener("available", this.updateEvtListener);
		this.clock.removeListener("unavailable", this.updateEvtListener);
		window.clearInterval(this.updateTimer);
		delete this.updateTimer;
	}
	return this;
};

DMAppTvEmuSyncClockObserver.prototype._sendUpdateEvent = function() {
	if (!this.running) return;
	if (this._pendingUpdateEventTimer) {
		window.clearTimeout(this._pendingUpdateEventTimer);
		delete this._pendingUpdateEventTimer;
	}
	if (this.clock.isAvailable()) {
		this._sendUpdateEventNow();
	} else {
		this._pendingUpdateEventTimer = window.setTimeout(function() {
			delete this._pendingUpdateEventTimer;
			this._sendUpdateEventNow();
		}.bind(this), 0);
	}
};

DMAppTvEmuSyncClockObserver.prototype._sendUpdateEventNow = function() {
	if (!this.running) return;
	const evt = new Events.Event("MediaStateUpdate");
	evt.observer = this;
	this.dispatchEvent(evt);
};

DMAppTvEmuSyncClockObserver.prototype._sendErrorEvent = function() {
	const evt = new Events.Event("Error");
	evt.observer = this;
	this.dispatchEvent(evt);
};

DMAppTvEmuSyncClockObserver.prototype.isCiiBlocked = function() {
	return false;
};

DMAppTvEmuSyncClockObserver.prototype.getCii = function() {
	const timelines = [{
		timelineSelector: "tag:rd.bbc.co.uk,2015-12-08:dvb:css:timeline:simple-elapsed-time:1000",
		timelineProperties: {
			unitsPerTick: 1,
			unitsPerSecond: 1000
		}
	}];

	return {
		contentId: "clock",
		contentIdStatus: "final",
		presentationStatus: "okay",
		timelines: timelines
	};
};

DMAppTvEmuSyncClockObserver.prototype.getTimelineState = function(selector) {
	let tickRate = null;
	const match = selector.match(/^tag:rd.bbc.co.uk,2015-12-08:dvb:css:timeline:simple-elapsed-time:([1-9][0-9]*)$/);

	if (match) {
		tickRate = Number.parseInt(match[1]);
	}

	if (tickRate !== null && this.clock.isAvailable()) {
		const contentTime = this.clock.now() * tickRate / this.clock.getTickRate(0);
		const wallClockPos = this.dMAppController.timeline.wallClock.now(); // in milliseconds
		return new TimelineState(tickRate, contentTime, wallClockPos, this.clock.getEffectiveSpeed());
	} else {
		return new TimelineState(null, null);
	}
};

try {
	Object.freeze(DMAppTvEmuSync.prototype);
	Object.freeze(DMAppTvEmuSyncClockObserver.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppTvEmuSync;
