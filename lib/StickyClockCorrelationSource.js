/************************************************************************/
/* FILE:                StickyClockCorrelationSource.js                 */
/* DESCRIPTION:         Sticky Clock Correlation Source                 */
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

const inherits = require('inherits');
const dvbcssClocks = require('dvbcss-clocks/src/main');
const ListenerTracker = require('listener-tracker');

/**
 * @classdesc
 * Clock which uses a another clock as a sticky source
 *
 * @extends Clock
 *
 * @constructor
 * @param {!DMAppController} dMAppController DMAppController
 * @param {!Clock} srcClock Clock source to use
 * @param {?number} initialValue Initial clock value to use, or null/undef to default to unavailable
 * @param {?number} initialSpeed Initial clock speed to use, or null/undef to default to 0
 */
function StickyClockCorrelationSource(dMAppController, srcClock, initialValue, initialSpeed) {
	dvbcssClocks.ClockBase.call(this);
	const self = this;
	Object.defineProperties(self, {
		dMAppController:      { value: dMAppController },
		srcClock:             { value: srcClock },
		corrClock:            { value: new dvbcssClocks.CorrelatedClock(dMAppController.timeline.monotonicClock, { tickRate: 1 }) },
		listenerTracker:      { value: ListenerTracker.createTracker() },
	});
	self.corrClock.availabilityFlag = false;
	const tracker = self.listenerTracker.subscribeTo(srcClock);
	tracker.on('change', function() {
		self._rebase();
	});
	tracker.on('available', function() {
		self._rebase();
	});
	tracker.on('unavailable', function() {
		self._freeze();
	});
	self._clockSpeed = initialSpeed || 0;
	if (initialValue != null) {
		self.corrClock.setCorrelationAndSpeed(new dvbcssClocks.Correlation(dMAppController.timeline.monotonicClock.now(), initialValue), self._clockSpeed);
		self.corrClock.availabilityFlag = true;
		self.availabilityFlag = true;
	}
	self._rebase();
}

inherits(StickyClockCorrelationSource, dvbcssClocks.ClockBase);

StickyClockCorrelationSource.prototype._rebase = function() {
	if (this.srcClock.isAvailable()) {
		const monoclock = this.dMAppController.timeline.monotonicClock;
		const corr = new dvbcssClocks.Correlation(monoclock.now(), this.srcClock.now() / this.srcClock.getTickRate());
		this.corrClock.setCorrelationAndSpeed(corr, this.srcClock.getEffectiveSpeed());
		this.corrClock.availabilityFlag = true;
		this.availabilityFlag = true;
	} else {
		this._freeze();
	}
};

StickyClockCorrelationSource.prototype._freeze = function() {
	if (this.corrClock.isAvailable()) {
		const monoclock = this.dMAppController.timeline.monotonicClock;
		this.corrClock.setCorrelationAndSpeed(new dvbcssClocks.Correlation(monoclock.now(), this.corrClock.now()), this._clockSpeed);
	}
};

StickyClockCorrelationSource.prototype.destroy = function() {
	this.listenerTracker.removeAllListeners();
	this.availabilityFlag = false;
};

StickyClockCorrelationSource.prototype.toString = function() {
	return "StickyClockCorrelationSource";
};

StickyClockCorrelationSource.prototype.now = function() {
	return this.corrClock.now();
};

StickyClockCorrelationSource.prototype.getSpeed = function() {
	return this._clockSpeed;
};

StickyClockCorrelationSource.prototype.setSpeed = function(newSpeed) {
	this._clockSpeed = newSpeed || 0;
	this._rebase();
	this.emit("change");
};

StickyClockCorrelationSource.prototype.getTickRate = function() {
	return 1;
};

StickyClockCorrelationSource.prototype.getParent = function() {
	return null;
};

StickyClockCorrelationSource.prototype._errorAtTime = function(t) {
	return 0;
};

StickyClockCorrelationSource.prototype.getRootMaxFreqError = function() {
	return 0;
};

module.exports = StickyClockCorrelationSource;
