/************************************************************************/
/* FILE:                DMAppTimeline.js                                */
/* DESCRIPTION:         DMApp timeline                                  */
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

const dvbcssClocks = require('dvbcss-clocks/src/main');
const $ = require("jquery");
const nanoEqual = require('nano-equal');
const SyncProtocols = require('dvbcss-protocols/src/main_browser');
const ListenerTracker = require('listener-tracker');
const inherits = require('inherits');

const SafeEventEmitter = require('./SafeEventEmitter');
const MediaSynchroniser = require('./MediaSynchroniser');
const argCheck = require('./argCheck');
const StickyClockCorrelationSource = require('./StickyClockCorrelationSource');
const Signal = require('./Signal');
const PromiseExecQueue = require('./PromiseExecQueue');
const DebugMiscUtil = require('./DebugMiscUtil');
const UpdateUtil = require('./UpdateUtil');
const ErrorUtil = require('./ErrorUtil');
const MiscUtil = require('./MiscUtil');
const sprintf = require("sprintf-js").sprintf;

const layoutServiceNotifyClockChangeThreshold = 0.4;
const sharedStateNotifyClockChangeThreshold = 0.2;
const clockMap = new WeakMap();

/**
 * @classdesc
 *
 * Handles Timeline functionality.
 * This should not be directly constructed. Use: {@link DMAppController#timeline}.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {DMAppController} dMAppController parent controller
 */
function DMAppTimeline(dMAppController) {
	let self = this;

	// begin monkey-patching
	SafeEventEmitter.monkeyPatch(dvbcssClocks.ClockBase.prototype);
	// end monkey-patching

	Object.defineProperties(this, {
		dMAppController:      { value: dMAppController },
		logger:               { value: dMAppController.createNamedLogger("DMAppTimeline") },
		dateNowClock:         { value: new dvbcssClocks.DateNowClock() },
		monotonicClock:       { value: new dvbcssClocks.DateNowClock() },
	});
	if (dMAppController.advDebugMode) {
		self = DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(this, this.logger, "DMAppTimeline", [
			'_defaultClockStickySource', '_stickyDefaultClock', '_interContextSyncId', '_interContextSyncCtl', '_lastLayoutClockChange', '_lastForceInitialClockUpdateDMAppId', '_wallclockServiceWs',
		]);
	}
	this.monotonicClock.now = dMAppController.monotonicNow;
	Object.defineProperties(this, {
		timelineStartClock:   { value: new dvbcssClocks.CorrelatedClock(this.monotonicClock) },
		defaultClock:         { value: new dvbcssClocks.CorrelatedClock() },
		wallClock:            { value: new dvbcssClocks.CorrelatedClock(this.dateNowClock) },
		wallclockServiceRemoteClockSyncEnableRefCount: { value: new Signal.RefCountSignal() },
		_registeredClocks:    { value: new Map() },
		_clockNetUpdateQueue: { value: new PromiseExecQueue(this.logger.makeChildLogger("(clock net update queue)")) },
	});
	this.timelineStartClock.correlation = new dvbcssClocks.Correlation(this.monotonicClock.now(), 0);
	this.defaultClock.availabilityFlag = false;

	clockMap.set(this.dateNowClock, {
		name: "date now",
		nonReassignable: true,
		source: {},
	});
	clockMap.set(this.monotonicClock, {
		name: "monotonic clock",
		nonReassignable: true,
		source: {},
	});
	clockMap.set(this.timelineStartClock, {
		name: "timeline start",
		nonReassignable: true,
		source: {},
	});
	clockMap.set(this.defaultClock, {
		name:  "default",
		nonOffsettable: true,
		source: {},
	});
	clockMap.set(this.wallClock, {
		name:  "wall clock",
		nonReassignable: true,
		source: {},
	});

	this._setupClockEventLogging(this.defaultClock);

	this.dMAppController.initedWaitable.done(function() {
		self.getStickyDefaultClock(); // create sticky clock
		self.defaultClock.on('change', self._checkLayoutClockChange.bind(self));
		self.defaultClock.on('available', self._checkLayoutClockChange.bind(self));
		self.dMAppController.layout.on('dmAppChange', self._checkLayoutClockChange.bind(self));
	});
	this.wallclockServiceRemoteClockSyncEnableRefCount.on('toggle', self._wallclockServiceRemoteClockSyncCtl.bind(self));
	return self;
}

inherits(DMAppTimeline, SafeEventEmitter);

/** @member {DMAppController} DMAppTimeline#dMAppController parent controller */
/** @member {Clock} DMAppTimeline#dateNowClock Date based clock */
/** @member {Clock} DMAppTimeline#monotonicClock Monotonic clock */
/** @member {Clock} DMAppTimeline#timelineStartClock Timeline start time based clock */
/** @member {Clock} DMAppTimeline#defaultClock Default component clock */
/** @member {Clock} DMAppTimeline#wallClock Wall clock (adjusted from wall clock service) */
/** @member {Logger} DMAppTimeline#logger logger for this instance */
/** @member {Signal.RefCountSignal} DMAppTimeline#wallclockServiceRemoteClockSyncEnableRefCount reference count signal to control whether wall clock service remote clock sync is enabled */

/**
 * Get string describing a clock
 * @param {Clock}
 * @param {Object=} options optional options object
 * @param {boolean=} [options.source=false] optional boolean whether to include source info
 * @returns {string}
 */
DMAppTimeline.prototype.getClockInfo = function(clock, options) {
	return this._getClockInfoIntl(clock, clock ? clockMap.get(clock) : null, options);
};

DMAppTimeline.prototype._getClockInfoIntl = function(clock, info, options) {
	if (clock) {
		let name = this._getClockNameIntl(info);
		let extra = '';
		const sInfo = info && info.source ? info.source : {};
		if (sInfo.masterOverride) extra += ", (master override mode)";
		if (options && options.source) extra += ", source: " + (sInfo.sourceName || "[no source]");
		if (clock.isAvailable()) {
			let str = "[" + name + ": " + (clock.now() / clock.getTickRate()) + " s";
			const speed = clock.getEffectiveSpeed();
			if (speed !== 1) {
				str += ", rate: " + speed;
			}
			return str + extra + "]";
		} else {
			return "[" + name + ": unavailable" + extra + "]";
		}
	} else {
		return "[No clock]";
	}
};

/**
 * Get object describing a clock
 * @param {Clock}
 * @returns {?object} information object, or null
 */
DMAppTimeline.prototype.getClockInfoObject = function(clock) {
	if (clock) {
		const info = clockMap.get(clock);
		if (info) return MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper(info);
	}
	return null;
};

DMAppTimeline.prototype._getClockNameIntl = function(info) {
	if (info == null) return "Unknown Clock";
	let name = info.name || "Unnamed Clock";
	return info.parent ? this._getClockNameIntl(info.parent) + "/" + name : name;
};

/**
 * Get name of a clock
 * @param {Clock}
 * @returns {string}
 */
DMAppTimeline.prototype.getClockName = function(clock) {
	if (clock) {
		return this._getClockNameIntl(clockMap.get(clock));
	} else {
		return "No clock";
	}
};

/**
 * Get registered clock by name
 * Registered clocks are created on first use
 *
 * @param {!string} name Registration name to use
 * @return {!CorrelatedClock} Registered clock (created on first use)
 */
DMAppTimeline.prototype.getRegisteredClock = function(name) {
	if (!name)  this.logger.throwError("registerClock: Name missing");
	let clock = this._registeredClocks.get(name);
	if (!clock) {
		clock = new dvbcssClocks.CorrelatedClock();
		clockMap.set(clock, {
			name: "RegisteredClock(" + name + ")",
			namePrefix: "RegisteredClock(" + name + "):",
			source: {},
		});
		this._registeredClocks.set(name, clock);
	}
	return clock;
};

/**
 * Get clock by name:
 *
 * The name is comprised of a type prefix, followed by /, followed by the type-specific key
 *
 * | Short prefix | Long prefix       | Class                                                            |
 * | ------------ | ----------------- | ---------------------------------------------------------------- |
 * | m            | member            | Member clocks (see below)                                        |
 * | r            | registered        | Registered clocks (see {@link DMAppTimeline#getRegisteredClock}) |
 *
 * | Member clocks           | Member                                        |
 * | ----------------------- | --------------------------------------------- |
 * | dateNowClock            | {@link DMAppTimeline#dateNowClock}            |
 * | monotonicClock          | {@link DMAppTimeline#monotonicClock}          |
 * | timelineStartClock      | {@link DMAppTimeline#timelineStartClock}      |
 * | defaultClock            | {@link DMAppTimeline#defaultClock}            |
 * | wallClock               | {@link DMAppTimeline#wallClock}               |
 *
 *
 * @param {!string} name Prefix followed by string key
 * @returns {!Clock} Clock
 */
DMAppTimeline.prototype.getClockByName = function(name) {
	const result = /^([^/]+)\/(.+)$/.exec(name);
	if (!result) this.logger.throwError("getClockByName: Cannot parse clock name: '" + name + "'");

	switch (result[1]) {
		case "m":
		case "member":
			if (result[2] === "dateNowClock") return this.dateNowClock;
			if (result[2] === "monotonicClock") return this.monotonicClock;
			if (result[2] === "timelineStartClock") return this.timelineStartClock;
			if (result[2] === "defaultClock") return this.defaultClock;
			if (result[2] === "wallClock") return this.wallClock;
			this.logger.throwError("getClockByName: Unknown member clock name: '" + result[2] + "'");
			break;

		case "r":
		case "registered":
			return this.getRegisteredClock(result[2]);

		default:
			this.logger.throwError("getClockByName: Unknown clock name class: '" + result[1] + "' for name: '" + name + "'");
	}
};

/**
 * Get whether a clock is in master override mode
 * @param {Clock}
 * @returns {boolean} true if in master override mode
 */
DMAppTimeline.prototype.isClockMasterOverride = function(clock) {
	if (clock) {
		const info = clockMap.get(clock);
		return !!info.source.masterOverride;
	} else {
		return false;
	}
};

DMAppTimeline.prototype._setupClockEventLogging = function(clock) {
	const self = this;
	clock.on('change', function() {
		self.logger.debug("Clock change: ", self.getClockInfo(clock));
	});
	clock.on('available', function() {
		self.logger.debug("Clock available: ", self.getClockInfo(clock));
	});
	clock.on('unavailable', function() {
		self.logger.debug("Clock unavailable: ", self.getClockInfo(clock));
	});
};

DMAppTimeline.prototype._addRemoveClockSource = function(clock, clockSource, options) {
	if (options && options.priority == null) options.priority = -Infinity;
	if (options && options.priorityGroup == null) options.priorityGroup = 0;

	const result = {};
	const info = clockMap.get(clock);
	const source = info.source;
	if (source.sources) {
		if (source.sources.length > 0) result.old_source = source.sources[source.sources.length - 1];
	} else {
		source.sources = [];
	}

	for (let i = 0; i < source.sources.length; i++) {
		if (source.sources[i].clockSource === clockSource) {
			source.sources.splice(i, 1); // clock source was already in source list, remove it
			i--;
			continue;
		}
	}

	let insert_before = source.sources.length;
	for (let i = 0; i < source.sources.length; i++) {
		if (options && ((options.priorityGroup < source.sources[i].options.priorityGroup) ||
				(options.priorityGroup === source.sources[i].options.priorityGroup && options.priority < source.sources[i].options.priority))) {
			insert_before = i;
			break;
		}
	}
	if (clockSource && options) {
		source.sources.splice(insert_before, 0, {
			clockSource: clockSource,
			options: options,
		});
	}
	if (source.sources.length > 0) result.new_source = source.sources[source.sources.length - 1];
	return result;
};

DMAppTimeline.prototype._setCurrentClockSource = function(clock, newSource) {
	const info = clockMap.get(clock);
	const infoSource = info.source;
	const old_clock_info = this.getClockInfo(clock, { source: true });
	const props = ['isMaster', 'synchroniserElement', 'getSynchroniserElementOffset', 'player', 'sourceName', 'masterOverride', 'dumpCallback', 'zeroUpdateThreshold'];
	if (newSource) {
		const newClockSource = newSource.clockSource;
		const options = newSource.options;
		clock.availabilityFlag = false;
		clock.setParent(newClockSource);
		for (let i = 0; i < props.length; i++) {
			const prop = props[i];
			delete infoSource[prop];
			if (options && options[prop]) infoSource[prop] = options[prop];
		}
		if (!infoSource.sourceName) {
			const newSourceInfo = clockMap.get(newClockSource);
			if (newSourceInfo) infoSource.sourceName = newSourceInfo.name;
		}
		clock.availabilityFlag = true;
	} else {
		for (let i = 0; i < props.length; i++) {
			delete infoSource[props[i]];
		}
		if (clock === this.defaultClock) {
			this._setDefaultClockSourceDefaultSource();
		} else {
			clock.availabilityFlag = false;
			clock.setParent(null);
		}
	}
	this.logger.info("Clock source change: " + old_clock_info + " --> " + this.getClockInfo(clock, { source: true }) + " in _setCurrentClockSource");
};

/**
 * Set the source clock for the {@link DMAppTimeline#defaultClock} member
 *
 * Calls {@link DMAppTimeline#setClockSource}
 *
 * @param {Clock} clockSource clock source to use
 * @param {Object=} options optional options object
 * @param {boolean=} options.isMaster optional boolean is the clock source now the master
 * @param {Element=} options.synchroniserElement optional master media element
 * @param {Function=} options.getSynchroniserElementOffset optional get master media element offset in s relative to clock callback
 * @param {MediaPlayer=} options.player optional master media player
 * @param {string=} options.sourceName optional name for the source
 * @param {number=} options.priority optional priority, this is used for ordering when more than one clock source is defined
 * @param {boolean=} options.masterOverride optional whether other clock sources which are or would be attempting to drive this clock should set themselves to slave mode, when this clock source is the highest priority source
 */
DMAppTimeline.prototype.setDefaultClockSource = function(clockSource, options) {
	return this.setClockSource(this.defaultClock, clockSource, options);
};

/**
 * Set the source clock for a re-assignable clock
 *
 * @param {Clock} clock clock to change source of
 * @param {Clock} clockSource clock source to use
 * @param {Object=} options optional options object
 * @param {boolean=} options.isMaster optional boolean is the clock source now the master
 * @param {Element=} options.synchroniserElement optional master media element
 * @param {Function=} options.getSynchroniserElementOffset optional get master media element offset in s relative to clock callback
 * @param {MediaPlayer=} options.player optional master media player
 * @param {string=} options.sourceName optional name for the source
 * @param {number=} options.priority optional priority, this is used for ordering when more than one clock source is defined
 * @param {boolean=} options.masterOverride optional whether other clock sources which are or would be attempting to drive this clock should set themselves to slave mode, when this clock source is the highest priority source
 */
DMAppTimeline.prototype.setClockSource = function(clock, clockSource, options) {
	const info = clockMap.get(clock);
	if (!info) this.logger.throwError("setClockSource: Clock is unknown");
	if (info.nonReassignable) this.logger.throwError("setClockSource: Clock is non-reassignable: " + this._getClockNameIntl(info));

	if (clock === clockSource) this.logger.throwError("Cannot set clock as its own parent: " + this.getClockInfo(clock));
	try {
		argCheck(arguments, 3, this.logger, "setDefaultClockSource", options,
				['isMaster', 'synchroniserElement', 'getSynchroniserElementOffset', 'player', 'sourceName', 'priority', 'priorityGroup', 'masterOverride', 'dumpCallback', 'zeroUpdateThreshold']);

		const res = this._addRemoveClockSource(clock, clockSource, $.extend({}, options));
		if (nanoEqual(res.old_source, res.new_source)) {
			return; // no change
		}

		this._setCurrentClockSource(clock, res.new_source);
	} catch (e) {
		this.logger.error("Failed to set clock " + this.getClockInfo(clock) + " parent in setDefaultClockSource", e);
	}
};

/**
 * Unset the source clock for the {@link DMAppTimeline#defaultClock} member
 *
 * Calls {@link DMAppTimeline#unsetClockSource}
 *
 * @param {Clock} clockSource clock source to unset, which was previously passed to {@link DMAppTimeline#setDefaultClockSource}
 */
DMAppTimeline.prototype.unsetDefaultClockSource = function(clockSource) {
	return this.unsetClockSource(this.defaultClock, clockSource);
};

/**
 * Unset the source clock for a re-assignable clock
 *
 * @param {Clock} clock clock to change source of
 * @param {Clock} clockSource clock source to unset, which was previously passed to {@link DMAppTimeline#setClockSource} with the same clock to change the source of
 */
DMAppTimeline.prototype.unsetClockSource = function(clock, clockSource) {
	const info = clockMap.get(clock);
	if (!info) this.logger.throwError("unsetClockSource: Clock is unknown");
	if (info.nonReassignable) this.logger.throwError("unsetClockSource: Clock is non-reassignable: " + this._getClockNameIntl(info));

	try {
		const res = this._addRemoveClockSource(clock, clockSource, null);
		if (nanoEqual(res.old_source, res.new_source)) {
			return; // no change
		}

		this._setCurrentClockSource(clock, res.new_source);
	} catch(e) {
		this.logger.error("Failed to unset clock " + this.getClockInfo(clock) + " parent in unsetDefaultClockSource", e);
	}
};

DMAppTimeline.prototype._setDefaultClockSourceDefaultSource = function() {
	const clock = this.defaultClock;
	try {
		clock.availabilityFlag = false;
		const info = clockMap.get(clock);
		if (this._defaultClockStickySource) {
			info.source.isMaster = true;
			info.source.sourceName = this._defaultClockStickySource.toString();
			clock.setParent(this._defaultClockStickySource);
			clock.availabilityFlag = true;
		} else {
			clock.availabilityFlag = false;
			clock.setParent(null);
		}
	} catch (e) {
		this.logger.error("Failed to set clock " + this.getClockInfo(clock) + " parent in _setDefaultClockSourceDefaultSource", e);
	}
};

const setOffsetClockInfo = function(self, parent, child, name) {
	const oldInfo = clockMap.get(child);
	if (oldInfo && oldInfo.nonReassignable) self.logger.throwError("Clock is non-reassignable: " + self._getClockNameIntl(oldInfo));
	if (oldInfo && oldInfo.nonOffsettable) self.logger.throwError("Clock is non-offsettable: " + self._getClockNameIntl(oldInfo));
	const pInfo = clockMap.get(parent);
	if (pInfo) {
		const info = {
			parent: pInfo,
			name: (oldInfo && oldInfo.namePrefix) ? oldInfo.namePrefix + name : name,
			namePrefix: (oldInfo && oldInfo.namePrefix) ? oldInfo.namePrefix : null,
			mediaSyncSourceMap: (oldInfo && oldInfo.mediaSyncSourceMap) ? oldInfo.mediaSyncSourceMap : null,
			children: (oldInfo && oldInfo.children) ? oldInfo.children : null,
		};
		Object.defineProperty(info, 'source', { get: function() { return pInfo.source; } });
		clockMap.set(child, info);
	}
};

/**
 * Create a CorrelatedClock offsetted from the input clock
 *
 * @param {Clock} input clock
 * @param {number} offset in s
 * @param {string=} optional descriptive name
 * @returns {CorrelatedClock}
 */
DMAppTimeline.prototype.createOffsettedClock = function(clock, offset, name) {
	const offsetClock = new dvbcssClocks.CorrelatedClock(clock);
	offsetClock.correlation = new dvbcssClocks.Correlation(0, offset * offsetClock.getTickRate());
	setOffsetClockInfo(this, clock, offsetClock, (name || '') + "(" + offset + "s)");
	return offsetClock;
};

/**
 * Create a CorrelatedClock offsetted from the input clock
 *
 * @param {Clock} input clock
 * @param {number} parentOffset in s
 * @param {number} childOffset in s
 * @param {string=} optional descriptive name
 * @param {number=} optional speed
 * @returns {CorrelatedClock}
 */
DMAppTimeline.prototype.createCorrelatedClock = function(clock, parentOffset, childOffset, name, speed) {
	const offsetClock = new dvbcssClocks.CorrelatedClock(clock);
	offsetClock.correlation = new dvbcssClocks.Correlation(parentOffset * clock.getTickRate(), childOffset * offsetClock.getTickRate());
	if (speed != null) offsetClock.setSpeed(speed);
	setOffsetClockInfo(this, clock, offsetClock, (name || '') + "(" + parentOffset + "s," + parentOffset + "s)");
	return offsetClock;
};

/**
 * Reparent/re-offset a child CorrelatedClock to be offsetted from a parent input clock
 *
 * @param {Clock} parentClock input parent clock
 * @param {CorrelatedClock} childClock CorrelatedClock to re-parent and offset onto parentClock
 * @param {number} parentOffset in s
 * @param {number} childOffset in s
 * @param {number} speed
 * @param {string=} name optional descriptive name
 */
DMAppTimeline.prototype.setCorrelatedClockParent = function(parentClock, childClock, parentOffset, childOffset, speed, name) {
	const avail = childClock.availabilityFlag;
	if (childClock.getParent() !== parentClock) {
		childClock.availabilityFlag = false;
		childClock.setParent(parentClock);
	}
	childClock.setCorrelationAndSpeed(new dvbcssClocks.Correlation(parentOffset * parentClock.getTickRate(), childOffset * childClock.getTickRate()), speed);
	setOffsetClockInfo(this, parentClock, childClock, (name || '') + "(" + parentOffset + "s," + parentOffset + "s," + speed + ")");
	childClock.availabilityFlag = avail;
};

/**
 * Synchronise a media element to a clock
 *
 * @param {Clock} clock MUST be a member clock or a clock from {@link DMAppTimeline#getRegisteredClock}, or a clock derived from a member/registered clock using {@link DMAppTimeline#createOffsettedClock}/{@link DMAppTimeline#createCorrelatedClock}/{@link DMAppTimeline#setCorrelatedClockParent}
 * @param {Element} element media element
 * @param {string=} name optional name
 * @param {Object=} options optional options object
 * @param {boolean=} options.pauseOnSyncStop optional whether to pause the media element when sync is stopped due to the clock being unavailable
 */
DMAppTimeline.prototype.synchroniseMediaElementToClock = function(clock, element, /* optional */ name, options) {
	const mss = new MediaSyncState(clock, element, this, this.logger.makeChildLogger("MediaSyncState:" + name), "MediaSyncState:" + name, options && options.pauseOnSyncStop);
	this._synchroniseToClock(clock, element, mss);
};

/**
 * Synchronise an external sync interface to a clock
 *
 * @param {Clock} clock MUST be a member clock or a clock from {@link DMAppTimeline#getRegisteredClock}, or a clock derived from a member/registered clock using {@link DMAppTimeline#createOffsettedClock}/{@link DMAppTimeline#createCorrelatedClock}/{@link DMAppTimeline#setCorrelatedClockParent}
 * @param {ExternalSync} ext external sync interface
 */
DMAppTimeline.prototype.synchroniseExternalToClock = function(clock, ext) {
	const mss = new ExtSyncState(clock, ext);
	this._synchroniseToClock(clock, ext, mss);
};

DMAppTimeline.prototype._synchroniseToClock = function(clock, element, mss) {
	let info = clockMap.get(clock);
	if (!info) {
		info = {
			source: {},
		};
		clockMap.set(clock, info);
	}
	const source = info.source;
	if (!source.mediaSyncStateSet) {
		source.mediaSyncStateSet = new Map();
	} else if (source.mediaSyncStateSet.has(element)) {
		this.logger.throwError("_synchroniseToClock: element is already synchronised, clock: " + this._getClockNameIntl(info));
	}
	if (!info.mediaSyncSourceMap) {
		info.mediaSyncSourceMap = new Map();
	} else if (info.mediaSyncSourceMap.has(element)) {
		this.logger.throwError("_synchroniseToClock: element is already synchronised, clock: " + this._getClockNameIntl(info));
	}
	source.mediaSyncStateSet.set(element, mss);
	info.mediaSyncSourceMap.set(element, source);
	if (clock.isAvailable() || mss.syncWhenUnavailable()) mss.sync();
	if (!source.availableHandler) {
		source.availableHandler = function() {
			for (let mss of source.mediaSyncStateSet.values()) {
				mss.sync();
			}
		};
		source.unavailableHandler = function() {
			for (let mss of source.mediaSyncStateSet.values()) {
				if (mss.syncWhenUnavailable()) continue;
				mss.unsync();
			}
		};
	}
	if (!source.appliedEventHandlers) {
		clock.on("available", source.availableHandler);
		clock.on("unavailable", source.unavailableHandler);
		source.appliedEventHandlers = true;
	}
};

/**
 * Unsynchronise an external sync interface to a clock
 *
 * @param {Clock} clock MUST be a member clock or a clock from {@link DMAppTimeline#getRegisteredClock}, or a clock derived from a member/registered clock using {@link DMAppTimeline#createOffsettedClock}/{@link DMAppTimeline#createCorrelatedClock}/{@link DMAppTimeline#setCorrelatedClockParent}
 * @param {Element|ExternalSync} element element or external sync interface previously passed to {@link DMAppTimeline#synchroniseMediaElementToClock} or {@link DMAppTimeline#synchroniseExternalToClock} for the given clock
 */
DMAppTimeline.prototype.unsynchroniseFromClock = function(clock, element) {
	const info = clockMap.get(clock);
	if (!info) this.logger.throwError("unsynchroniseFromClock: clock not in clockMap");
	const notSynced = function() {
		this.logger.warn("unsynchroniseFromClock: element not previously synced to clock: " + this._getClockNameIntl(info));
		return null;
	}.bind(this);
	if (!info.mediaSyncSourceMap) return notSynced();
	const source = info.mediaSyncSourceMap.get(element);
	if (!source) return notSynced();
	if (!source.mediaSyncStateSet) this.logger.throwError("unsynchroniseFromClock: clock mediaSyncStateSet not in clockMap: " + this._getClockNameIntl(info));
	const mss = source.mediaSyncStateSet.get(element);
	if (mss) {
		mss.unsync();
		source.mediaSyncStateSet.delete(element);
		info.mediaSyncSourceMap.delete(element);
		if (source.mediaSyncStateSet.size === 0) {
			// no synced items, remove event handlers
			clock.removeListener("available", source.availableHandler);
			clock.removeListener("unavailable", source.unavailableHandler);
			source.appliedEventHandlers = false;
		}
	}
};

DMAppTimeline.prototype._checkLayoutClockChangeValid = function() {
	if (!this.dMAppController.layout.dmAppId) {
		delete this._lastLayoutClockChange;
		return false;
	}
	const clock = this.defaultClock;
	if (!clock) return false;
	const info = clockMap.get(clock);
	if (!info.source.isMaster) return false;
	return true;
};

DMAppTimeline.prototype._checkLayoutClockChange = function() /* -> void */ {
	if (!this._checkLayoutClockChangeValid()) return;

	if (this._clockNetUpdateQueue.getQueueLength() === 0) {
		this._clockNetUpdateQueue.enqueue(this._checkLayoutClockChangeNow.bind(this));
	}
};

DMAppTimeline.prototype._checkLayoutClockChangeNow = function() /* -> void */ {
	const self = this;
	if (!self._checkLayoutClockChangeValid()) return;

	if (self.dMAppController.forceInitialClockUpdateValue != null && self._lastForceInitialClockUpdateDMAppId !== self.dMAppController.layout.dmAppId) {
		const num = Number(self.dMAppController.forceInitialClockUpdateValue);
		if (Number.isFinite(num)) {
			self._lastForceInitialClockUpdateDMAppId = self.dMAppController.layout.dmAppId;
			const clockInfo = {
				wallClock: Date.now() / 1000,
				contextClock: num,
				contextClockRate: 0,
			};
			self.logger.debug("Sending forced clock change notification to layout service: W: " + clockInfo.wallClock +
					", C: " + clockInfo.contextClock + ", rate: " + clockInfo.contextClockRate);
			return self.dMAppController.layout.io.notifyClockChange(clockInfo).then(function() {
				return self.dMAppController.layout._startedWaitable.then(function() {
					return self._checkLayoutClockChangeNow();
				});
			});
		}
	}

	const clock = self.defaultClock;
	if (!clock.isAvailable()) return;
	const info = clockMap.get(clock);
	let clockInfo = {
		wallClock: Date.now() / 1000,
		contextClock: clock.now() / clock.getTickRate(),
		contextClockRate: clock.getEffectiveSpeed(),
	};
	if (self._lastLayoutClockChange) {
		if (clockInfo.contextClockRate !== self._lastLayoutClockChange.contextClockRate) {
			self.logger.debug("Sending clock change notification to layout service: W:" + clockInfo.wallClock +
					", C: " + clockInfo.contextClock + ", due to rate change: " +
					self._lastLayoutClockChange.contextClockRate + " -> " + clockInfo.contextClockRate);
		} else {
			const delta = ((clockInfo.wallClock - self._lastLayoutClockChange.wallClock) * clockInfo.contextClockRate) -
					(clockInfo.contextClock - self._lastLayoutClockChange.contextClock);
			if (Math.abs(delta) >= layoutServiceNotifyClockChangeThreshold || (delta !== 0 && (clockInfo.contextClockRate === 0 || info.source.zeroUpdateThreshold))) {
				self.logger.debug("Sending clock change notification to layout service: W: " + clockInfo.wallClock +
						", C: " + clockInfo.contextClock + ", delta: " + delta + ", rate: " + clockInfo.contextClockRate);
			} else {
				return;
			}
		}
	} else {
		self.logger.debug("Sending initial clock change notification to layout service: W: " + clockInfo.wallClock +
				", C: " + clockInfo.contextClock + ", rate: " + clockInfo.contextClockRate);
	}
	const res = self.dMAppController.layout.io.notifyClockChange(clockInfo);
	self._lastLayoutClockChange = clockInfo;
	return res;
};

/**
 * @typedef {Object} enumerateClocksReturnType
 * @property {string} name Clock name
 * @property {Clock} clock Clock
 */

/**
 * Enumerate member clocks
 *
 * @returns {Array<enumerateClocksReturnType>}
 */
DMAppTimeline.prototype.enumerateClocks = function() /* Array<{ name, clock }> */{
	return [
		this.defaultClock,
		this.timelineStartClock,
		this.dateNowClock,
		this.monotonicClock,
		this.wallClock,
	].map(function(clock) {
		return {
			clock: clock,
			name: clockMap.get(clock).name,
		};
	});
};

/**
 * Format a time value in seconds as an H:M:S string
 *
 * @param {number} time Time in seconds
 * @returns {string} H:M:S string
 */
DMAppTimeline.prototype.formatHMS = function(time) {
	let out = '';
	if (time < 0) {
		out += '-';
		time = -time;
	}
	const s = time % 60;
	const m = ((time / 60) % 60) | 0;
	const h = (time / 3600) | 0;
	time = (time / 1000) | 0;
	return sprintf("%s%d:%02d:%s%f", out, h, m, (s < 10) ? '0' : '', s);
};

DMAppTimeline.prototype.dumpClockInfo = function(clock, dumper, include_time, include_detail) {
	dumper.keyValue("available", clock.isAvailable());
	if (clock.isAvailable()) {
		dumper.keyValue("speed", clock.getEffectiveSpeed());
		if (include_time) {
			const now = clock.now() / clock.getTickRate();
			dumper.keyValue("now", now + " s");
			dumper.keyValue("now (HMS)", this.formatHMS(now));
		}
	}
	const info = clockMap.get(clock);
	if (info && include_detail) {
		const source = info.source;
		dumper.keyValue("is master", !!source.isMaster);
		if (source.sourceName) dumper.keyValue("source", source.sourceName);
		if (source.masterOverride) dumper.keyValue("master override mode", source.masterOverride);
		if (source.zeroUpdateThreshold) dumper.keyValue("zero update threshold", source.zeroUpdateThreshold);
		if (source.mediaSyncStateSet && source.mediaSyncStateSet.size > 0) {
			const syncCat = dumper.subcategory("Synced items");
			for (let mss of source.mediaSyncStateSet.values()) {
				mss.dump(syncCat);
			}
		}
		if (source.sources && source.sources.length > 0) {
			const sourcesCat = dumper.subcategory("Set sources: " + source.sources.length);
			for (let i = 0; i < source.sources.length; i++) {
				const options = source.sources[i].options;
				let sourceName = options.sourceName;
				if (!sourceName) {
					const sourceInfo = clockMap.get(source.sources[i].clockSource);
					if (sourceInfo) sourceName = sourceInfo.name;
				}
				const name = i + ": " + sourceName + " (" + (options.priorityGroup !== 0 ? (options.priorityGroup + ',') : '') + options.priority + ")";
				if (options.dumpCallback) {
					const cat = sourcesCat.subcategory(name);
					options.dumpCallback(cat);
				} else {
					sourcesCat.value(name);
				}
			}
		}
		if (clock === this.wallClock) {
			const refCount = this.wallclockServiceRemoteClockSyncEnableRefCount.getValue();
			dumper.keyValue("wallclock service sync", refCount ? "enabled + (" + refCount + ")" : "disabled");
		}
	}
};

DMAppTimeline.prototype._getStickyDefaultClockInitialValue = function() {
	return this.wallClock.now() / this.wallClock.getTickRate() + Number(this.dMAppController.initStickyDefaultClockWallclockRelative);
};

/**
 * Get the sticky clock which shadows the default clock
 * Do not modify the returned sticky clock
 * @returns {Clock}
 */
DMAppTimeline.prototype.getStickyDefaultClock = function() {
	if (!this._stickyDefaultClock) {
		if (this.dMAppController.initStickyDefaultClockWallclockRelative != null) {
			this._stickyDefaultClock = new StickyClockCorrelationSource(this.dMAppController, this.defaultClock, this._getStickyDefaultClockInitialValue(), 1);
		} else {
			this._stickyDefaultClock = new StickyClockCorrelationSource(this.dMAppController, this.defaultClock, 0);
			this.dMAppController.layout._startedWaitable.then(function() {
				this._stickyDefaultClock.setSpeed(1);
			}.bind(this));
		}
	}
	return this._stickyDefaultClock;
};

/**
 * Setup the default clock source as a sticky clock
 */
DMAppTimeline.prototype.setupStickyDefaultClock = function() {
	if (this._defaultClockStickySource) return;
	this._defaultClockStickySource = this.getStickyDefaultClock();
	if (this.defaultClock.getParent() == null) {
		const old_info = this.getClockInfo(this.defaultClock, { source: true });
		this._setDefaultClockSourceDefaultSource();
		this.logger.info("Clock source change: " + old_info + " --> " + this.getClockInfo(this.defaultClock, { source: true }) + ", in setupStickyDefaultClock");
	}
};

DMAppTimeline.prototype._wallclockServiceRemoteClockSyncCtl = function() {
	const self = this;
	if (self.wallclockServiceRemoteClockSyncEnableRefCount.getValue() && !self._wallclockServiceWs) {
		self.logger.info("Starting wallclock service remote clock sync");
		const wallclockService = self.dMAppController.getUrl('wallclockService');
		const ws = new WebSocket(wallclockService, "WallClockSync");
		ws.binaryType = 'arraybuffer';
		ws.addEventListener("open", function() {
			SyncProtocols.WallClock.createBinaryWebSocketClient(ws, self.wallClock, {
					dest: { address: wallclockService, port: 80 },
					logFunction: self.logger.deferredConcat('debug', 'Wallclock service client: '),
			});
		});
		self._wallclockServiceWs = ws;
	} else if (!self.wallclockServiceRemoteClockSyncEnableRefCount.getValue() && self._wallclockServiceWs) {
		self.logger.info("Stopping wallclock service remote clock sync");
		self._wallclockServiceWs.close();
		delete self._wallclockServiceWs;
	}
};

/**
 * Local direct shared state sync inter-context ID change
 *
 * @event DMAppTimeline#interContextSyncIdChange
 */

/**
 * Set the current local direct shared-state sync inter-context ID
 *
 * Set to a truthy value to enable direct inter-context sync between the current instance and the shared-state service
 * Set to null/undefined to disable direct inter-context sync between the current instance and the shared-state service
 *
 * @param {?string} id Inter-context sync ID
 */
DMAppTimeline.prototype.setInterContextSyncId = function(id) {
	if ((this._interContextSyncId || null) !== (id || null)) {
		this._interContextSyncId = (id || null);
		if (this._interContextSyncCtl) {
			this._interContextSyncCtl.destroy();
			delete this._interContextSyncCtl;
		}
		if (this._interContextSyncId) {
			this._interContextSyncCtl = new InterContextSyncCtl(this, this._interContextSyncId);
		}
	}
	this.dMAppController.layout._interCtxIdSignal.setValue(this._interContextSyncId);
	this.emit("interContextSyncIdChange");
};

/**
 * Get the current local direct shared-state sync inter-context ID, or null
 *
 * This is set if direct inter-context sync between the current instance and the shared-state service is currently enabled
 *
 * @returns {?string} id Inter-context sync ID, or null
 */
DMAppTimeline.prototype.getInterContextSyncId = function() {
	return this._interContextSyncId || null;
};

function MediaSyncState(clock, elem, timeline, logger, name, pauseOnSyncStop) {
	this.clock = clock;
	this.elem = elem;
	this.timeline = timeline;
	this.logger = logger;
	this.name = name;
	this.pauseOnSyncStop = !!pauseOnSyncStop;
}

MediaSyncState.prototype._checkClockSpeed = function(clock, info) {
	while (clock) {
		const parent = clock.getParent();
		if (parent) {
			// check speed of non-root clocks only
			if (clock.getSpeed() !== 1.0 && clock.getSpeed() !== 0) this.logger.throwError("Clock has wrong speed: ", clock.getSpeed(), ", clock: " + this.timeline.getClockInfo(clock));
		}
		clock = parent;
	}
};

MediaSyncState.prototype.sync = function() {
	if (this.synchroniser || this.synchroniserCM) return;
	const info = clockMap.get(this.clock);
	this.syncedClockInfo = info;
	if (info.synchroniserElement && info.synchroniserElement === this.elem) this.logger.throwError("Cannot sync element to itself: ", this.elem);
	this._checkClockSpeed(this.clock);
	this.synchroniserCM = new MediaSynchroniser({
		master: this.clock,
		slave: this.elem,
		notifyThrashing: this.thrashHandler.bind(this),
		logger: this.logger.makeChildLogger("MediaSynchroniser"),
		pauseOnSyncStop: this.pauseOnSyncStop,
	});
	this.logger.info("Syncing element to clock: " + this.timeline.getClockInfo(this.clock) + " using MediaSynchroniser (clock mode)");
};

MediaSyncState.prototype.unsync = function() {
	if (this.synchroniserCM) {
		this.logger.info("Unsyncing element from clock: " + this.timeline._getClockInfoIntl(this.clock, this.syncedClockInfo) + " using MediaSynchroniser (clock mode)");
		this.synchroniserCM.stopSync();
		delete this.synchroniserCM;
	}
	delete this.syncedClockInfo;
};

MediaSyncState.prototype.syncWhenUnavailable = function() {
	return false;
};

MediaSyncState.prototype.thrashHandler = function() {
	// TODO: take corrective action
};

MediaSyncState.prototype.dump = function(dumper) {
	const cat = dumper.subcategory(this.name);
	if (this.synchroniser) {
		cat.keyValue("sync", "using MediaSynchroniser (element mode)");
	} else if (this.synchroniserCM) {
		cat.keyValue("sync", "using MediaSynchroniser (clock mode)");
	} else {
		cat.keyValue("sync", "no");
	}
};

/**
 * @callback ExternalSyncInfoFunc
 * @param {Object} info
 * @param {boolean=} info.isMaster optional boolean is the clock source the master
 * @param {Element=} info.synchroniserElement optional master media element
 * @param {MediaPlayer=} info.player optional master media player
 * @param {string=} info.sourceName optional name for the source
 */
/**
 * @callback ExternalSyncSyncWhenUnavailableCallback
 * @returns {boolean} Whether this sync item should be left synced when the clock source is unavailable
 */

/**
 * External sync interface
 *
 * @interface ExternalSync
 * @prop {ExternalSyncInfoFunc} sync Method called to apply sync
 * @prop {ExternalSyncInfoFunc} unsync Method called to unapply sync
 * @prop {ExternalSyncSyncWhenUnavailableCallback=} syncWhenUnavailable Optional method called to determine whether to apply sync when the clock source is unavailable
 * @prop {Function=} dump Optional function for dump interface
 */

function ExtSyncState(clock, extSync) {
	this.clock = clock;
	this.extSync = extSync;
	this._isSynced = false;
}

ExtSyncState.prototype.info = function() {
	const info = clockMap.get(this.clock);
	const source = info.source;
	return {
		isMaster: source.isMaster,
		synchroniserElement: source.synchroniserElement,
		player: source.player,
		sourceName: source.sourceName,
	};
};

ExtSyncState.prototype.sync = function() {
	if (this._isSynced) return;
	this.extSync.sync(this.info());
	this._isSynced = true;
};

ExtSyncState.prototype.unsync = function() {
	if (!this._isSynced) return;
	this.extSync.unsync(this.info());
	this._isSynced = false;
};

ExtSyncState.prototype.syncWhenUnavailable = function() {
	if (this.extSync.syncWhenUnavailable) {
		return this.extSync.syncWhenUnavailable();
	} else {
		return false;
	}
};

ExtSyncState.prototype.dump = function(dumper) {
	if (this.extSync.dump) {
		this.extSync.dump(this.info(), dumper);
	} else {
		dumper.value("ExtSyncState");
	}
};

/**
 * Timeline shared state sync utilities
 *
 * @namespace
 */
DMAppTimeline.SharedStateSyncUtil = {};

/**
 * Update shared state clock property
 *
 * This writes clockInfo into the shared state property if the change is above changeThreshold, or is otherwise significant
 *
 * @param {!SharedState} ss Shared state instance
 * @param {!string} prop Property name
 * @param {!Object} clockInfo Clock information, this is stored as is in the shared state property, if necessary
 * @param {!number} clockInfo.wallClock Wall clock time in s
 * @param {!number} clockInfo.clock Clock time in s
 * @param {!number} clockInfo.clockRate Relative clock rate
 * @param {string=} clockInfo.agentId Optional shared state agent ID
 * @param {!number} changeThreshold Change threshold in s for writes
 * @param {Logger=} logger Optional logger
 */
DMAppTimeline.SharedStateSyncUtil.UpdateSharedStateClockProperty = function(ss, prop, clockInfo, changeThreshold, logger) {
	const remoteState = ss.getItem(prop);
	if (!remoteState || typeof remoteState !== "object") {
		ss.setItem(prop, clockInfo);
		if (logger) logger.info("Setting clock update as no clock info currently -> ", clockInfo);
	} else if (clockInfo.agentId !== remoteState.agentId) {
		ss.setItem(prop, clockInfo);
		if (logger) logger.info("Setting clock update as agent ID wrong -> ", clockInfo);
	} else if (clockInfo.clockRate !== remoteState.clockRate) {
		ss.setItem(prop, clockInfo);
		if (logger) logger.info("Setting clock update as rate changed -> ", clockInfo);
	} else if (clockInfo.clockRate === 0) {
		const delta = (clockInfo.clock - remoteState.clock);
		if (delta !== 0) {
			ss.setItem(prop, clockInfo);
			if (logger) logger.info("Setting clock update as delta: " + delta + " s at rate: 0 -> ", clockInfo);
		}
	} else {
		const delta = (clockInfo.clockRate * (clockInfo.wallclock - remoteState.wallclock)) -
				(clockInfo.clock - remoteState.clock);
		if (Math.abs(delta) >= changeThreshold) {
			ss.setItem(prop, clockInfo);
			if (logger) logger.info("Setting clock update as delta: " + delta + " s >= threshold: " + changeThreshold + " s -> ", clockInfo);
		}
	}
};

function InterContextSyncCtl(timeline, syncId) {
	Object.defineProperties(this, {
		parentTimeline:       { value: timeline },
		dMAppController:      { value: timeline.dMAppController },
		logger:               { value: timeline.logger.makeChildLogger("InterContextSyncCtl") },
		syncId:               { value: syncId },
		listenerTracker:      { value: ListenerTracker.createTracker() },
		errorMsgs:            { value: [] },
		timelineDocMismatchErrorFlag:  { value: new ErrorUtil.ErrorFlag(timeline.dMAppController, timeline.dMAppController.errorSignals.configuration, ErrorUtil.ErrorMode.DEV,
				"Timeline document URL mismatch between this device and inter-context sync master") },
	});
	Object.defineProperties(this, {
		promiseExecQueue:     { value: new PromiseExecQueue(this.logger) },
	});
	this.listenerTracker.subscribeTo(this.dMAppController.layout).on('contextChange', this._setup.bind(this));
	this.listenerTracker.subscribeTo(this.dMAppController.layout).on('dmAppChange', this._setup.bind(this));
	this._setup();
}

InterContextSyncCtl.prototype._cleanup = function() {
	this.timelineDocMismatchErrorFlag.clear();
	if (this._sharedState) {
		this._sharedState.destroy();
		this._sharedState = null;
	}
	if (this._wallclockSyncUnref) {
		this._wallclockSyncUnref();
		delete this._wallclockSyncUnref;
	}
	delete this._changeHandler;
};

InterContextSyncCtl.prototype._masterUpdate = function() {
	const clock = this.parentTimeline.defaultClock;
	const wallclock = this.parentTimeline.wallClock;
	const ss = this._sharedState;
	if (!ss || ss.readyState !== "open") return;
	if (clock.isAvailable() && wallclock.isAvailable()) {
		const clockInfo = {
			wallclock: wallclock.now() / wallclock.getTickRate(),
			clock: clock.now() / clock.getTickRate(),
			clockRate: clock.getEffectiveSpeed(),
			agentId: ss.agentid,
		};
		DMAppTimeline.SharedStateSyncUtil.UpdateSharedStateClockProperty(ss, 'clock', clockInfo, sharedStateNotifyClockChangeThreshold, this.logger);
	}
};

InterContextSyncCtl.prototype._startMasterMode = function() {
	if (!this._masterMode) {
		this.logger.debug("Enabling master mode");
		this._masterMode = true;
		const handler = this._masterUpdate.bind(this);
		const clockTracker = this.listenerTracker.subscribeTo(this.parentTimeline.defaultClock);
		clockTracker.on('available', handler);
		clockTracker.on('change', handler);
		const wallTracker = this.listenerTracker.subscribeTo(this.parentTimeline.wallClock);
		wallTracker.on('available', handler);
		wallTracker.on('change', handler);
	}
	this._masterUpdate();
};

InterContextSyncCtl.prototype._stopMasterMode = function() {
	if (this._masterMode) {
		this.logger.debug("Disabling master mode");
		this._masterMode = false;
		this.listenerTracker.removeAllListeners(this.parentTimeline.defaultClock);
		this.listenerTracker.removeAllListeners(this.parentTimeline.wallClock);
	}
};

InterContextSyncCtl.prototype._slaveUpdate = function() {
	const wallclock = this.parentTimeline.wallClock;
	const clockState = this._sharedState.getItem('clock');
	const masterState = this._sharedState.getItem('master');
	if (clockState && masterState && clockState.agentId === masterState.agentId) {
		this.parentTimeline.setCorrelatedClockParent(wallclock, this._slaveClock,
				clockState.wallclock, clockState.clock, clockState.clockRate, "InterContextSyncSlave");
		this._slaveClock.availabilityFlag = true;
	}
};

InterContextSyncCtl.prototype._startSlaveMode = function() {
	if (!this._slaveMode) {
		this.logger.debug("Enabling slave mode");
		this._slaveMode = true;
		this._slaveClock = new dvbcssClocks.CorrelatedClock();
		this._slaveClock.availabilityFlag = false;
		this.parentTimeline.setDefaultClockSource(this._slaveClock, {
			isMaster: true,
			sourceName: "Inter-Context Sync: Slave Mode",
			priorityGroup: 5,
			priority: 0,
			masterOverride: true,
		});
	}
	this._slaveUpdate();
};

InterContextSyncCtl.prototype._stopSlaveMode = function() {
	if (this._slaveMode) {
		this.logger.debug("Disabling slave mode");
		this._slaveMode = false;
		this.parentTimeline.unsetDefaultClockSource(this._slaveClock);
		this._slaveClock.setParent(null);
		this._slaveClock = null;
	}
};

InterContextSyncCtl.prototype._stateChange = function(change) {
	this.logger.debug("State Change: " + change.key + " -> ", change.value);
	this._changeHandler();
};

InterContextSyncCtl.prototype._presenceChange = function(change) {
	this.logger.debug("Presence Change: " + change.key + " -> ", change.value);
	this._changeHandler();
};

InterContextSyncCtl.prototype._getMasterInfo = function(ss) {
	return {
		contextId: this.dMAppController.layout.contextId,
		deviceId: this.dMAppController.getDeviceId(),
		instanceId: this.dMAppController.instanceId,
		timelineDocUrl: this.dMAppController.layout.dmAppObj ? this.dMAppController.layout.dmAppObj.spec.timelineDocUrl : null,
		agentId: ss.agentid,
	};
};

InterContextSyncCtl.prototype._changeHandlerIntl = function() {
	const ss = this._sharedState;
	ss.request();

	let setSelfMaster = false;
	let timelineDocMismatch = false;
	const masterObj = ss.getItem('master');
	if (masterObj) {
		if (typeof masterObj !== 'object') {
			setSelfMaster = true;
		} else if (masterObj.agentId !== ss.agentid && ss.getPresence(masterObj.agentId) !== 'online') {
			setSelfMaster = true;
		}
	} else {
		setSelfMaster = true;
	}

	if (setSelfMaster) {
		// This write is racy, but that doesn't really matter so long as it is atomic and exactly one device becomes the master
		const info = this._getMasterInfo(ss);
		ss.setItem('master', info, { cas: true });
		this.logger.info("Setting self as master: ", info);
		this._stopMasterMode();
	} else {
		// Current state OK
		const isMasterSelf = (masterObj.agentId === ss.agentid);
		if (isMasterSelf) {
			this._startMasterMode();
			this._stopSlaveMode();
		} else {
			this._stopMasterMode();
			this._startSlaveMode();
			if (this.dMAppController.layout.dmAppObj && masterObj.timelineDocUrl) {
				timelineDocMismatch = (this.dMAppController.layout.dmAppObj.spec.timelineDocUrl !== masterObj.timelineDocUrl);
			}
		}
	}
	ss.send();
	this.timelineDocMismatchErrorFlag.setState(timelineDocMismatch);
	this.parentTimeline.emit("interContextSyncUpdate");
};

InterContextSyncCtl.prototype._setup = function() {
	const self = this;
	self.promiseExecQueue.cancelAll();
	self.promiseExecQueue.enqueue(function() {
		self._cleanup();
		if (self.dMAppController.layout.contextId != null && self.dMAppController.layout.dmAppObj != null && !self._destructed) {
			const p = self.dMAppController.createSharedStateFromGroupMapping('/interContextSync/' + self.syncId).then(function(ss) {
				if (self._destructed) {
					ss.destroy();
					return;
				}
				self._sharedState = ss;
				self._wallclockSyncUnref = self.parentTimeline.wallclockServiceRemoteClockSyncEnableRefCount.latch();
				self._changeHandler = UpdateUtil.makeSharedStateUpdateWhenReadyClosure(ss, self._changeHandlerIntl.bind(self));
				ss.on('change', self._stateChange, self, true);
				ss.on('presence', self._presenceChange, self, true);
				const initHandler = function() {
					if (ss.readyState !== 'open') return;
					self.logger.debug("Initial state: Master: ", ss.getItem('master'), ", Clock: ", ss.getItem('clock'), ", Presence: ",
							ss.getPresenceList().map(function(agent) {
								return agent + " = " + ss.getPresence(agent);
							}).join(", "));
					self._changeHandler();
				};
				ss.on('readystatechange', initHandler);
			});
			p.catch(function(err) {
				self.errorMsgs.push("Failed to create shared state: " + JSON.stringify(err));
				self.parentTimeline.emit("interContextSyncUpdate");
			});
			return p;
		}
	});
};

InterContextSyncCtl.prototype.hostileTakeoverMaster = function() {
	const ss = this._sharedState;
	const info = this._getMasterInfo(ss);
	ss.setItem('master', info, { cas: true });
	this.logger.warn("Hostile Takeover: Setting self as master: ", info);
	this._stopMasterMode();
};

InterContextSyncCtl.prototype.destroy = function() {
	if (this._destructed) return;
	Object.defineProperty(this, '_destructed', { value: true });
	this._stopMasterMode();
	this._stopSlaveMode();
	this.listenerTracker.removeAllListeners();
	this.promiseExecQueue.destroy();
	this._cleanup();
};

InterContextSyncCtl.prototype.dumpDebugInfo = function(dumper) {
	dumper.keyValue("Sync ID", this.syncId);
	const ss = this._sharedState;
	if (ss) {
		dumper.keyValue("Shared state status", ss.readyState);
		dumper.keyValue("Shared state agent ID", ss.agentid);
		if (ss.readyState === "open") {
			dumper.keyValue("Master state", JSON.stringify(ss.getItem('master')));
			dumper.keyValue("Clock state", JSON.stringify(ss.getItem('clock')));
			dumper.keyValue("Master mode", !!this._masterMode);
			dumper.keyValue("Slave mode", !!this._slaveMode);
			const presenceCat = dumper.subcategory("Presence");
			ss.getPresenceList().map(function(agent) {
				presenceCat.keyValue(agent, ss.getPresence(agent));
			});
			if (this._slaveMode) {
				dumper.button("Hostile takeover -> master", this.hostileTakeoverMaster.bind(this));
			}
		}
	} else {
		dumper.value("Haven't created shared state client yet");
	}
	for (let i = 0; i < this.errorMsgs.length; i++) {
		dumper.keyValue("Error", this.errorMsgs[i]);
	}
	if (this.timelineDocMismatchErrorFlag.getValue()) dumper.keyValue("Error", this.timelineDocMismatchErrorFlag.msg);
};

try {
	Object.freeze(DMAppTimeline.prototype);
	Object.freeze(MediaSyncState.prototype);
	Object.freeze(ExtSyncState.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppTimeline;
