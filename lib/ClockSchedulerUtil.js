/************************************************************************/
/* FILE:                ClockSchedulerUtil.js                           */
/* DESCRIPTION:         Clock scheduler util                            */
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
const ListenerTracker = require('listener-tracker');

const SafeEventEmitter = require('./SafeEventEmitter');
const argCheck = require('./argCheck');

/**
 * Interval information.
 *
 * @typedef {object} ClockArrayIntervalScheduler#interval
 * @property {?number} interval Current interval of the clock position within the schedule array. If the clock is unavailable, null. If before the first schedule value, -1. Otherwise the 0-index of the lower bound of the interval.
 * @property {!boolean} clockAvailable Is clock available
 * @property {?number} clockNow Current clock position in s
 */
/**
 * Interval change event.
 *
 * @event ClockArrayIntervalScheduler#change
 * @type {ClockArrayIntervalScheduler#interval}
 */

/**
 * @classdesc
 * Emit an event whenever the position of a clock changes between different intervals formed by the values
 * of the provided schedule array.
 *
 * @constructor
 * @param {!Array<?number>} schedule Array of times in ascending order, null values are ignored, all values in s
 * @param {?Object} options Optional options object
 * @param {number=} options.multiplier Optional value to multiply all schedule times with
 * @param {number=} options.offset Optional offset to add to all schedule times after multiplying
 * @param {number=} options.roundTo Optional value to round all schedule times to, after adding any offset
 * @param {Logger=} options.logger Optional logger instance
 */
function ClockArrayIntervalScheduler(schedule, options) {
	let multiplier = 1;
	let offset = 0;
	let roundTo = 0;
	if (options) {
		if (options.multiplier != null) multiplier = options.multiplier;
		if (options.offset != null) offset = options.offset;
		if (options.roundTo != null) roundTo = options.roundTo;
	}
	/* globals console */
	let logger = options && options.logger ? options.logger : console;
	if (options) {
		argCheck(arguments, 2, logger, "ClockArrayIntervalScheduler constructor", options, ['multiplier', 'offset', 'roundTo', 'logger']);
	}

	let prev = null;
	const s = schedule.map(function(val) {
		if (val == null) return null;
		val = offset + (val * multiplier);
		if (roundTo !== 0 && roundTo !== 1) {
			val = roundTo * Math.round(val / roundTo);
		}
		if (prev != null && val < prev) {
			logger.warn("ClockArrayIntervalScheduler: input is not in ascending order, dropping item");
			return null;
		}
		prev = val;
		return val;
	});
	Object.defineProperties(this, {
		schedule:             { value: s },
		clock:                { value: null, configurable: true },
		listenerTracker:      { value: ListenerTracker.createTracker() },
	});
	this._bucket = null;
}

inherits(ClockArrayIntervalScheduler, SafeEventEmitter);

/**
 * Get the clock used
 * @returns {?Clock} clock
 */
ClockArrayIntervalScheduler.prototype.getClock = function() {
	return this.clock;
};

/**
 * Set the clock used
 * @param {?Clock} clock
 */
ClockArrayIntervalScheduler.prototype.setClock = function(clock) {
	if (this.clock === clock) return;

	this._setEventTick(null);
	this.listenerTracker.removeAllListeners();
	Object.defineProperties(this, {
		clock:                { value: clock, configurable: true },
	});
	if (clock) {
		const tracker = this.listenerTracker.subscribeTo(clock);
		const handler = this._checkClock.bind(this);
		tracker.on("change", handler);
		tracker.on("available", handler);
		tracker.on("unavailable", handler);
		handler();
	}
};

/**
 * Get current interval
 *
 * @returns {!ClockArrayIntervalScheduler#interval}
 */
ClockArrayIntervalScheduler.prototype.getCurrentInterval = function() {
	const clock = this.clock;
	const schedule = this.schedule;
	let bucket = null;
	let now = null;
	if (clock && clock.isAvailable()) {
		now = clock.now() / clock.getTickRate();
		bucket = -1;
		if (schedule.length !== 0) {
			for (let i = 0; i < schedule.length; i++) {
				if (schedule[i] != null && now >= schedule[i]) {
					bucket = i;
				}
			}
		}
	}
	return {
		interval: bucket,
		clockAvailable: clock && clock.isAvailable(),
		clockNow: now,
	};
};

ClockArrayIntervalScheduler.prototype._checkClock = function() {
	const info = this.getCurrentInterval();
	if (info.interval !== this._bucket) {
		this._bucket = info.interval;
		this.emit('change', Object.freeze(info));
	}
	this._setEvent();
};

ClockArrayIntervalScheduler.prototype._setEvent = function() {
	const clock = this.clock;
	let targetTick = null;
	if (clock && clock.isAvailable() && clock.getEffectiveSpeed() !== 0) {
		let targetBucket = this._bucket;
		if (clock.getEffectiveSpeed() > 0) {
			targetBucket++;
			for (; targetBucket < this.schedule.length; targetBucket++) {
				// find next non-null bucket
				if (this.schedule[targetBucket] != null) break;
			}
		}
		if (targetBucket < this.schedule.length && targetBucket >= 0 && this.schedule[targetBucket] != null) {
			targetTick = (this.schedule[targetBucket] * this.clock.getTickRate()) + (clock.getEffectiveSpeed() > 0 ? 0 : -1);
		}
	}
	if (this._eventTick !== targetTick) this._setEventTick(targetTick);
};

ClockArrayIntervalScheduler.prototype._setEventTick = function(targetTick) {
	if (this._eventTick != null) {
		this.clock.clearTimeout(this._eventTickHandle);
		delete this._eventTickHandle;
	}
	if (targetTick != null) {
		this._eventTickHandle = this.clock.setAtTime(function() {
			delete this._eventTickHandle;
			delete this._eventTick;
			this._checkClock();
		}.bind(this), targetTick);
	}
	this._eventTick = targetTick;
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This SHOULD be called when the instance is no longer required.
 */
ClockArrayIntervalScheduler.prototype.destroy = function() {
	this._setEventTick(null);
	this.listenerTracker.removeAllListeners();
};


module.exports = {
	ClockArrayIntervalScheduler: ClockArrayIntervalScheduler,
};
