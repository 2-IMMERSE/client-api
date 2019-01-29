/************************************************************************/
/* FILE:                MediaElementClockSource.js                      */
/* DESCRIPTION:         Media Element Clock Source                      */
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
const dvbcssClocks = require('dvbcss-clocks');
const ClockBase = dvbcssClocks.ClockBase;
const argCheck = require('./argCheck');

const changeEvents = [ "seeked", "pause", "playing", "abort", "ended", "ratechange", "error" ];
const adjustEvents = [ "timeupdate", "stalled" ];

/**
 * @classdesc
 * Clock which uses a media element as its source
 *
 * @extends Clock
 *
 * @constructor
 * @param {!Object} params Parameters object
 * @param {!Element} params.element Source media element
 * @param {DMAppController} params.dMAppController DMAppController, this is optional iff params.logger is set
 * @param {Logger=} params.logger Optional logger to use
 * @param {number=} params.maxFreqErrorPpm Optional max frequency error value in PPM
 * @param {number=} params.offset Optional offset in s by which the clock lags the position of the media element
 * @param {number=} params.changeThreshold Optional override of threshold in s after which a change event is emitted
 * @param {Function=} params.currentTimeFunction Optional override of function used to get current time in ms, `this` pointer is undefined
 * @param {number=} params.minimumOutputTime Optional minimum value which the output clock may take, otherwise it is set to unavailable
 */
const MediaElementClockSource = function(params) {
	ClockBase.call(this);

	if (!params || typeof params !== "object") {
		throw new Error("params must be an object in MediaElementClockSource constructor");
	}

	this._element = params.element;

	if (typeof params.logger !== "undefined") {
		this.logger = params.logger;
	} else if (typeof params.dMAppController !== "undefined") {
		this.logger = params.dMAppController.createNamedLogger("MediaElementClockSource");
	} else {
		throw new Error("No logger in MediaElementClockSource constructor: neither params.logger nor params.dMAppController set");
	}

	if (typeof params.maxFreqErrorPpm !== "undefined") {
		this._maxFreqErrorPpm = params.maxFreqErrorPpm;
	} else {
		this._maxFreqErrorPpm = 50;
	}

	if (typeof params.offset !== "undefined") {
		this._offset = params.offset;
	} else {
		this._offset = 0;
	}

	if (typeof params.changeThreshold !== "undefined") {
		this._changeThreshold = params.changeThreshold;
	} else {
		this._changeThreshold = 0.025;
	}

	if (typeof params.minimumOutputTime !== "undefined") {
		this._minimumOutputTime = params.minimumOutputTime;
	} else {
		this._minimumOutputTime = -Infinity;
	}

	if (typeof params.currentTimeFunction === "function") {
		this._nowTime = params.currentTimeFunction.bind(undefined);
	} else if (typeof params.dMAppController !== "undefined") {
		this._nowTime = params.dMAppController.monotonicNow;
	} else {
		this._nowTime = Date.now.bind(Date);
	}

	argCheck(arguments, 1, this.logger, "MediaElementClockSource constructor", params,
			['element', 'dMAppController', 'logger', 'maxFreqErrorPpm', 'offset', 'changeThreshold', 'currentTimeFunction', 'minimumOutputTime']);

	const changeHandler = this._changeUpdateEvent.bind(this);
	for(let i = 0; i < changeEvents.length; i++) {
		this._element.addEventListener(changeEvents[i], changeHandler);
	}
	const adjustHandler = this._adjustUpdateEvent.bind(this);
	for(let i = 0; i < adjustEvents.length; i++) {
		this._element.addEventListener(adjustEvents[i], adjustHandler);
	}

	this.destroy = function() {
		for(let i = 0; i < changeEvents.length; i++) {
			this._element.removeEventListener(changeEvents[i], changeHandler);
		}
		for(let i = 0; i < adjustEvents.length; i++) {
			this._element.removeEventListener(adjustEvents[i], adjustHandler);
		}
		this.availabilityFlag = false;
	}.bind(this);

	if (this._setAvailability()) {
		this._estimateBase = this._makeEstimateBase();
	}
};

inherits(MediaElementClockSource, ClockBase);

MediaElementClockSource.prototype._setAvailability = function() {
	if (this._element.readyState < this._element.HAVE_CURRENT_DATA) {
		this.availabilityFlag = false;
		return false;
	}
	if (this.now() < this._minimumOutputTime) {
		this.availabilityFlag = false;
		return false;
	}
	this.availabilityFlag = true;
	return true;
};

MediaElementClockSource.prototype._adjustUpdateEvent = function() {
	if (!this._setAvailability()) return;
	if (!this._estimateBase) {
		this._changeUpdateEvent();
		return;
	}
	const now = this._nowTime();
	const estimate = this._calcEstimate(this._estimateBase, now);
	if (Math.abs(this._element.currentTime - estimate) > this._changeThreshold) {
		this._changeUpdateEvent();
	}
};

MediaElementClockSource.prototype._calcEstimate = function(base, now) {
	return base.lastCurrentTime + (base.lastSpeed * (now - base.lastDate) / 1000);
};

MediaElementClockSource.prototype._makeEstimateBase = function() {
	return {
		lastSpeed: this.getSpeed(),
		lastDate: this._nowTime(),
		lastCurrentTime: this._element.currentTime,
	};
};

MediaElementClockSource.prototype._changeUpdateEvent = function() {
	if (!this._setAvailability()) return;
	this._estimateBase = this._makeEstimateBase();
	this.emit("change", this);
};

MediaElementClockSource.prototype.toString = function() {
	let str = "MediaElementClockSource[" + this._element;
	if (this._offset) str += ", offset: " + this._offset;
	str += "]";
	return str;
};

MediaElementClockSource.prototype.now = function() {
	return this._element.currentTime - this._offset;
};

MediaElementClockSource.prototype.getSpeed = function() {
	return this._element.paused ? 0 : this._element.playbackRate;
};

MediaElementClockSource.prototype.getTickRate = function() {
	return 1;
};

MediaElementClockSource.prototype.getParent = function() {
	return null;
};

MediaElementClockSource.prototype._errorAtTime = function(t) {
	return 0;
};

MediaElementClockSource.prototype.getRootMaxFreqError = function() {
	return this._maxFreqErrorPpm;
};

/**
 * Get offset in s by which the clock lags the position of the media element
 * @returns {number} offset
 */
MediaElementClockSource.prototype.getOffset = function() {
	return this._offset || 0;
};

/**
 * Set offset in s by which the clock lags the position of the media element
 * @param {?number} offset
 */
MediaElementClockSource.prototype.setOffset = function(offset) {
	if (!offset) offset = 0;
	if (this._offset !== offset) {
		this._offset = offset;
		if (!this._setAvailability()) return;
		this.emit("change", this);
	}
};

module.exports = MediaElementClockSource;
