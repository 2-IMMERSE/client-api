/************************************************************************/
/* FILE:                CiiSyncHandlerBase.js                           */
/* DESCRIPTION:         CII sync handler base                           */
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

/**
 * @classdesc
 *
 * Generic CII synchronisation handler functionality.
 *
 * @abstract
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {!DMAppComp} dMAppComp parent companion controller
 * @param {!Clock} srcClock source clock for correlation
 * @param {!string} name synchroniser name
 */
function CiiSyncHandlerBase(dMAppController, dMAppComp, srcClock, name) {
	const self = this;
	Object.defineProperty(self, 'name',            { value: name });
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'dMAppComp',       { value: dMAppComp });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger(name) });
	Object.defineProperty(self, 'srcClock',        { value: srcClock });
	Object.defineProperty(self, 'clock',           { value: new DMAppClientLib.deps.dvbcssClocks.CorrelatedClock(self.srcClock) });
	Object.defineProperty(self, 'listenerTracker', { value: new DMAppClientLib.deps.listenerTracker.createTracker() });
	Object.defineProperty(self, 'debugInfo',       { value: {} });
	self.clock.availabilityFlag = false;
}

CiiSyncHandlerBase.prototype.toString = function() {
	return "[" + this.name + "]";
};

CiiSyncHandlerBase.prototype._doSync = function(dMAppController, url, name) {
	if (this._destroyed) return;
	if (dMAppController !== this.dMAppController) {
		this.logger.throwError("Controller mismatch in sync()");
	}
	if (this._synced) this.logger.throwError("sync() called when already synced");
	this._synced = true;
	this.logger.info("Synchronising to URL: " + url + ", as: " + name);
	this._setDefaultClockSource();
};

CiiSyncHandlerBase.prototype._setDefaultClockSource = function() {
	this.dMAppController.timeline.setDefaultClockSource(this.clock, {
		sourceName: this.name,
		priorityGroup: 3,
		priority: this.clock.availabilityFlag ? 1 : -1,
		dumpCallback: this.dump.bind(this),
	});
};

CiiSyncHandlerBase.prototype._doUnsync = function() {
	if (!this._synced) this.logger.throwError("unsync() called when not synced");
	this._synced = false;
	this.dMAppController.timeline.unsetDefaultClockSource(this.clock);
	this.logger.info("Unsynchronising");
};

CiiSyncHandlerBase.prototype._setClockAvailability = function(available) {
	if (this._destroyed) return;
	if (this.clock.availabilityFlag === available) return;
	this.clock.availabilityFlag = available;
	this._handleClockAvailabilityChange();
};

CiiSyncHandlerBase.prototype._handleClockAvailabilityChange = function() {
	this.dMAppComp.app2AppSyncBlockSignal.setBlockerRegistered(this, this.clock.availabilityFlag);
	if (this._synced) {
		this._setDefaultClockSource();
	}
};

CiiSyncHandlerBase.prototype._applyTimestamp = function(timestamp, speed) {
	if (timestamp === null) {
		this._setClockAvailability(false);
		return;
	}
	let correlation = new DMAppClientLib.deps.dvbcssClocks.Correlation(this.srcClock.now(), timestamp * this.srcClock.getTickRate());
	const change = this.clock.quantifySignedChange(correlation, speed);
	if (!this.clock.availabilityFlag) {
		this.logger.debug("Applying clock update, change: ", change * 1000, "ms, speed: ", speed, ", due to clock becoming available");
		this.clock.setCorrelationAndSpeed(correlation, speed);
	} else if (Math.abs(change) >= 0.05) {
		this.logger.debug("Applying clock update, change: ", change * 1000, "ms, speed: ", speed);
		this.clock.setCorrelationAndSpeed(correlation, speed);
	} else {
		//this.logger.debug("Not applying clock update, change: ", change * 1000, "ms, speed: ", speed);
	}
	this._setClockAvailability(true);
};

CiiSyncHandlerBase.prototype._syncTimeline = function(synchroniser, timelineId) {
	this.logger.throwError("_syncTimeline: Unimplemented");
};

CiiSyncHandlerBase.prototype.dump = function(dumper) {
	if (this.debugInfo) {
		const cat = dumper.subcategory("Debug info", false);
		for (let prop in this.debugInfo) {
			if (prop !== "timeline") cat.keyValue(prop, JSON.stringify(this.debugInfo[prop], null, 2));
		}
	}
	if (this.debugInfo && this.debugInfo.timeline) {
		const cat = dumper.subcategory("Timeline debug info", false);
		for (let prop in this.debugInfo.timeline) {
			cat.keyValue(prop, this.debugInfo.timeline[prop]);
		}
	}
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 */
CiiSyncHandlerBase.prototype.destroy = function() {
	if (this.dMAppComp.getCiiSyncHandler() === this) this.dMAppComp.setCiiSyncHandler(null);
	if (this._synced) this.unsync();
	this._setClockAvailability(false);
	Object.defineProperty(this, '_destroyed',      { value: true });
	this.listenerTracker.removeAllListeners();
};

module.exports = CiiSyncHandlerBase;
