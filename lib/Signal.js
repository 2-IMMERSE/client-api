/************************************************************************/
/* FILE:                Signal.js                                       */
/* DESCRIPTION:         Utility for signal logic                        */
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
const deepEql = require('deep-eql');
const $ = require("jquery");
const SafeEventEmitter = require('./SafeEventEmitter');
const BlockableWrapper = require('./Blockable').BlockableWrapper;
const MiscUtil = require('./MiscUtil');
const onetime = require('onetime');
const Promise = require('promise');
const deepFreeze = require('deep-freeze');

/**
 * Signal logic utilities
 *
 * Rationale:
 *
 * The primary purpose of signals is to facilitate variables with both value semantics and change notifications events.
 * Coupling the value and the change event together reduces the boilerplate required to correctly get and watch a variable,
 * and reduces the scope for human error due to subscribing to and/or emitting the wrong event, or forgetting to do so.
 *
 * Other key features of signals include:
 * * Defining a signal value as a transformation of zero or more other signals/sources, whilst still supporting efficient change detection.
 * * Signals with reference count semantics and associated utility methods.
 * * Mechanisms to temporarily fix a signal at its current value (e.g. for de-bouncing or change aggregation).
 * * Utility methods to await a signal being in a suitable state.
 * * Support for reference (pointer), value (pointed to) and wrapper (const cast/facade) immutability.
 * * Permanently disabling signals to prevent and detect use-after-free type errors.
 *
 * The design of the signal interfaces attempts to promote ease of use and run-time efficiency whilst discouraging accidental human error.
 *
 * Signals are used for various internal and externally-facing purposes.
 * Signals are one of the mechanisms used for both local and remote communications between components, modules, devices, etc.
 *
 * Component parameters and various flags/reference-counts are implemented and exposed as signals.
 * Various other non-component flags/reference-counts are also signals.
 *
 * The controller exposes interfaces which associate string names with signal instances.
 * This can be used for otherwise disjoint components/modules/etc. to communicate by acquiring the signal with the same name.
 * These interfaces include ones which automatically propagate signal changes between devices, such that (to a first approximation), components/modules/etc. on different devices
 * can communicate by acquiring the same named signal.
 * See {@link DMAppController#getSignalByName}, {@link DMAppController#setSignalByName} and other interfaces referenced in the documentation of the aforementioned methods for more details.
 *
 * @namespace Signal
 */

/**
 * @classdesc
 *
 * Base class for Signals, non-assignable for static values
 *
 * @extends EventEmitter
 *
 * @memberof Signal
 *
 * @constructor
 * @param value Initial and final value for this signal instance
 */
function BaseSignal(value) {
	this._value = value;
}

inherits(BaseSignal, SafeEventEmitter);

/**
 * Signal change notification event.
 *
 * Note that mutating operations performed on the same signal instance are non re-entrant with respect to emission of this event type.
 *
 * @typedef {Object} Signal.BaseSignal~SignalEvent
 * @property oldValue Old value of signal
 * @property newValue New value of signal
 */
/**
 * Change event.
 * This is emitted when the value changes.
 *
 * @event Signal.BaseSignal#change
 * @type {Signal.BaseSignal~SignalEvent}
 */
/**
 * Toggle event.
 * This is emitted when the value changes from a low/falsey value to a high/truthy one, or vice versa.
 *
 * @event Signal.BaseSignal#toggle
 * @type {Signal.BaseSignal~SignalEvent}
 */
/**
 * Rise event.
 * This is emitted when the value changes from a low/falsey value to a high/truthy one.
 *
 * @event Signal.BaseSignal#rise
 * @type {Signal.BaseSignal~SignalEvent}
 */
/**
 * Value change event.
 * This is emitted when the value changes from a high/truthy value to a low/falsey one.
 *
 * @event Signal.BaseSignal#fall
 * @type {Signal.BaseSignal~SignalEvent}
 */

BaseSignal.prototype._isEqual = deepEql.bind(null);

BaseSignal.prototype._change = function(value) {
	if (this._refCount) {
		if (!Number.isInteger(value)) throw new Error("Signal: Cannot change refcount to be a non-integer");
		if (value < 0) throw new Error("Signal: Cannot change refcount to be a negative integer");
	}
	if (this._boolean) {
		value = !!value;
	}
	if (!this._isEqual(this._value, value)) {
		const oldValue = this._value;
		this._value = value;
		if (this._autoFreeze) this._freeze();
		const info = Object.freeze({
			newValue: value,
			oldValue: oldValue,
		});
		this.emit("change", info);
		if (oldValue && !value) {
			this.emit("fall", info);
			this.emit("toggle", info);
		} else if (!oldValue && value) {
			this.emit("rise", info);
			this.emit("toggle", info);
		}
	}
};

/**
 * Get current value
 *
 * @returns value of this signal instance
 */
BaseSignal.prototype.getValue = function() {
	return this._value;
};

/**
 * Attach an event listener to this instance which calls block/unblock on the given blockable object.
 * The blockable is unblocked when this instance's value is low/falsey, and blocked when this instance's value is high/truthy.
 *
 * @param {Blockable} blockable
 */
BaseSignal.prototype.addOutputBlockable = function(blockable) {
	const bw = new BlockableWrapper(blockable);
	bw.setBlocked(this.getValue());
	this.on('toggle', function() {
		bw.setBlocked(this.getValue());
	}.bind(this));
};

/**
 * Call callback when value becomes equal to given value
 * The callback may be called immediately, the callback is not called more than once.
 *
 * @param value Value to compare to signal value
 * @param {Function} callback This is called 0 or 1 times, possibly immediately
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 */
BaseSignal.prototype.awaitEqual = function(value, callback, listenerTracker) {
	if (this._isEqual(this._value, value)) {
		callback();
	} else {
		const evSrc = listenerTracker ? listenerTracker.subscribeTo(this) : this;
		const completion = onetime(callback);
		const check = function() {
			if (this._isEqual(this._value, value)) {
				completion();
				evSrc.removeListener('change', check);
			}
		}.bind(this);
		evSrc.on('change', check);
	}
};

function awaitBoolCommon(signal, expected, event, callback, listenerTracker) {
	/* jshint -W018 */
	if ((!!signal._value) === expected) {
	/* jshint +W018 */
		callback();
	} else {
		const evSrc = listenerTracker ? listenerTracker.subscribeTo(signal) : signal;
		evSrc.once(event, callback);
	}
}

/**
 * Call callback when value becomes high/truthy.
 * The callback may be called immediately, the callback is not called more than once.
 *
 * @param {Function} callback This is called 0 or 1 times, possibly immediately
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 */
BaseSignal.prototype.awaitHigh = function(callback, listenerTracker) {
	awaitBoolCommon(this, true, 'rise', callback, listenerTracker);
};

/**
 * Call callback when value becomes low/falsey.
 * The callback may be called immediately, the callback is not called more than once.
 *
 * @param {Function} callback This is called 0 or 1 times, possibly immediately
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 */
BaseSignal.prototype.awaitLow = function(callback, listenerTracker) {
	awaitBoolCommon(this, false, 'fall', callback, listenerTracker);
};

function immediateTrackCommon(signal, eventName, listener, listenerTracker) {
	const evSrc = listenerTracker ? listenerTracker.subscribeTo(signal) : signal;
	evSrc.on(eventName, listener);
}

/**
 * Convenience method to add an event listener using .on(), and then call the listener immediately with no arguments
 *
 * @param {string|symbol} eventName The name of the event
 * @param {Function} listener The callback function
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 * @returns {BaseSignal} this
 */
BaseSignal.prototype.onImmediate = function(eventName, listener, listenerTracker) {
	immediateTrackCommon(this, eventName, listener, listenerTracker);
	listener();
	return this;
};

/**
 * Convenience method to add a rise event listener using .on("rise"), and then call the listener immediately with no arguments if the signal value is high/truthy
 *
 * @param {Function} listener The callback function
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 * @returns {BaseSignal} this
 */
BaseSignal.prototype.onHighImmediate = function(listener, listenerTracker) {
	immediateTrackCommon(this, "rise", listener, listenerTracker);
	if (this._value) listener();
	return this;
};

/**
 * Convenience method to add a fall event listener using .on("fall"), and then call the listener immediately with no arguments if the signal value is low/falsey
 *
 * @param {Function} listener The callback function
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 * @returns {BaseSignal} this
 */
BaseSignal.prototype.onLowImmediate = function(listener, listenerTracker) {
	immediateTrackCommon(this, "fall", listener, listenerTracker);
	if (!this._value) listener();
	return this;
};

/**
 * SettableSignal constructor options
 *
 * @typedef {Object} Signal.SettableSignal~ConstructorOptions
 * @property {boolean=} boolean Limit signal to only hold boolean values
 * @property {boolean=} autoFreeze Set auto-freeze flag (see {@link Signal.SettableSignal#setAutoFreeze})
 */

/**
 * @classdesc
 *
 * Signal which has a re-assignable value
 *
 * @extends Signal.BaseSignal
 *
 * @memberof Signal
 *
 * @constructor
 * @param initialValue Initial value for this signal instance
 * @param {Signal.SettableSignal~ConstructorOptions=} options Optional constructor options
 */
function SettableSignal(initialValue, options) {
	if (options) {
		for (let prop in options) {
			switch (prop) {
				case 'boolean':
					if (options.boolean) {
						Object.defineProperty(this, '_boolean', { value: true });
						initialValue = !!initialValue;
					}
					break;

				case 'autoFreeze':
					this.setAutoFreeze(options.autoFreeze);
					break;

				default:
					throw new Error("Unexpected option in SettableSignal constructor: " + prop + ": " + options[prop]);
			}
		}
	}
	this._value = initialValue;
	if (this._autoFreeze) this._freeze();
}

inherits(SettableSignal, BaseSignal);

SettableSignal.prototype._clearInputEvents = function() {
	if (this._inputTracker) {
		this._inputTracker.removeAllListeners();
		delete this._inputTracker;
	}
	if (this._refreshTransform) {
		delete this._refreshTransform;
	}
};

SettableSignal.prototype._bufferedChange = function(value) {
	if (this._hysteresisCheck) {
		const ret = this._hysteresisCheck(value, this._value, this._changePending ? this._pendingValue : this._value);
		if (ret === false) {
			if (this._hysteresisTimer) window.clearTimeout(this._hysteresisTimer);
			delete this._hysteresisTimer;
			this._hysteresisBlocked = false;
			this._changePending = false;
		} else if (ret === true) {
			// do nothing
		} else if (typeof ret === "number") {
			if (this._hysteresisTimer) window.clearTimeout(this._hysteresisTimer);
			this._hysteresisBlocked = true;
			this._hysteresisTimer = window.setTimeout(function() {
				this._hysteresisBlocked = false;
				delete this._hysteresisTimer;
				this._checkPending();
			}.bind(this), ret);
		} else {
			throw new Error("Invalid return value from SettableSignal hysteresis filter callback");
		}
	}
	if (this._blocked || this._hysteresisBlocked) {
		this._pendingValue = value;
		this._changePending = true;
	} else {
		this._change(value);
	}
};

/**
 * Set current value
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * @param value
 */
SettableSignal.prototype.setValue = function(value) {
	if (this._const) throw new Error("Cannot call setValue on a const SettableSignal");
	this._clearInputEvents();
	this._bufferedChange(value);
};

/**
 * Signal transform: transient signal subscription
 *
 * This may be called to transiently subscribe to a signal within a {@link Signal.SettableSignal~TransformCallback} callback.
 * Do not call this asynchronously, or outside of a {@link Signal.SettableSignal~TransformCallback} callback.
 *
 * @callback Signal.SettableSignal~TransformTransientSubscriptionCallback
 * @param {BaseSignal} signal Signal to subscribe to, the subscription is ended when the {@link Signal.SettableSignal~TransformCallback} callback is next called.
 */

/**
 * Signal transform callback
 *
 * @callback Signal.SettableSignal~TransformCallback
 * @param {!(Signal.BaseSignal|Signal.BaseSignal[]|Object.<string, Signal.BaseSignal>)} signalSet Set of signals being monitored
 * @param {!Signal.SettableSignal~TransformTransientSubscriptionCallback} subscribeTransient Transiently subscribe to a signal
 * @returns Output value from transformation, becomes new value of signal instance
 */

/**
 * Set value to be a transform of a set of other signals
 * The transform function is re-executed whenever one or more of the set of input signals changes, or when {@link Signal.SettableSignal#refreshTransform} is called.
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * Use of a directed graph of signal copies and/or transforms that forms a cycle may result in undefined behaviour.
 *
 * @param {!(Signal.BaseSignal|Signal.BaseSignal[]|Object.<string, Signal.BaseSignal>)} signalSet Set of signals to monitor
 * @param {!Signal.SettableSignal~TransformCallback} transform Signal transform function, the return value is the new value of the signal instance
 */
SettableSignal.prototype.setSignalTransform = function(signalSet, transform) {
	if (this._const) throw new Error("Cannot call setSignalTransform on a const SettableSignal");
	const self = this;
	this._clearInputEvents();
	this._inputTracker = ListenerTracker.createTracker();
	let transients, outgoingTransients, subscribeTransientOk;
	let param;
	const cbs = {};
	cbs.subscribeTransient = function(signal) {
		if (!(signal instanceof BaseSignal)) throw new Error("Signal: setSignalTransform: subscribeTransient: attempted to subscribe to a non-signal");
		if (!subscribeTransientOk) throw new Error("Signal: setSignalTransform: subscribeTransient: callback called at inappropriate time");
		if (!transients) transients = new Set();
		if (outgoingTransients && outgoingTransients.delete(signal)) {
			// preserve without re-adding event handler
			transients.add(signal);
		} else if (!transients.has(signal)) {
			// add new event handler
			transients.add(signal);
			self._inputTracker.subscribeTo(signal).on('change', cbs.updateTransient);
		}
	};
	cbs.update = function() {
		outgoingTransients = transients;
		transients = null;
		subscribeTransientOk = true;
		self._bufferedChange(transform(param, cbs.subscribeTransient));
		subscribeTransientOk = false;
		if (outgoingTransients && outgoingTransients.size) {
			// clear old transient event listeners
			for (let signal of outgoingTransients) {
				self._inputTracker.subscribeTo(signal).removeListener('change', cbs.updateTransient);
			}
		}
		outgoingTransients = null;
	};
	cbs.updateTransient = cbs.update.bind(null); // same method, but !== to avoid mixing up static and transient listeners
	this._refreshTransform = cbs.update;
	const track = function(signal) {
		if (!(signal instanceof BaseSignal)) throw new Error("Signal: setSignalTransform: attempted to subscribe to a non-signal");
		self._inputTracker.subscribeTo(signal).on('change', cbs.update);
	};
	if (signalSet instanceof BaseSignal) {
		track(signalSet);
		param = signalSet;
	} else if (Array.isArray(signalSet)) {
		for (let i = 0; i < signalSet.length; i++) {
			track(signalSet[i]);
		}
		param = [].concat(signalSet);
	} else {
		for (let prop in signalSet) {
			track(signalSet[prop]);
		}
		param = $.extend({}, signalSet);
	}
	cbs.update();
};

/**
 * If this signal is currently set as a transform using {@link Signal.SettableSignal#setSignalTransform}, re-execute the transformation callback.
 * Otherwise this method has no effect.
 *
 * Wherever possible, subscribing to signals should be used instead.
 * This method is intended to be used when the transformation callback depends on a mutable non-signal.
 */
SettableSignal.prototype.refreshTransform = function() {
	if (this._refreshTransform) this._refreshTransform();
};

/**
 * Convenience function to create a {@link Signal.SettableSignal}, call {@link Signal.SettableSignal#setSignalTransform} and optionally {@link Signal.SettableSignal#makeConst}
 *
 * @param {boolean} makeConst whether to make this signal const using {@link Signal.SettableSignal#makeConst}
 * @param signalSet passed to {@link Signal.SettableSignal#setSignalTransform}
 * @param transform passed to {@link Signal.SettableSignal#setSignalTransform}
 * @param {Signal.SettableSignal~ConstructorOptions=} options Optional constructor options
 * @returns {Signal.SettableSignal}
 */
SettableSignal.makeWithSignalTransform = function(makeConst, signalSet, transform, options) {
	const signal = new SettableSignal(undefined, options);
	signal.setSignalTransform(signalSet, transform);
	if (makeConst) signal.makeConst();
	return signal;
};

/**
 * Set value to be a copy of another signal
 * This value is updated whenever the input signal changes.
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * Use of a directed graph of signal copies and/or transforms that forms a cycle may result in undefined behaviour.
 *
 * @param {BaseSignal} signal Signal to monitor and copy
 */
SettableSignal.prototype.setSignalCopy = function(signal) {
	if (this._const) throw new Error("Cannot call setSignalCopy on a const SettableSignal");
	this._clearInputEvents();
	this._inputTracker = ListenerTracker.createTracker();

	if (!(signal instanceof BaseSignal)) throw new Error("Signal: setSignalCopy: attempted to subscribe to a non-signal");
	if (signal === this) throw new Error("Signal: setSignalCopy: attempted to subscribe to self");
	this._inputTracker.subscribeTo(signal).on('change', function(info) {
		this._bufferedChange(info.newValue);
	}.bind(this));
	this._bufferedChange(signal.getValue());
};

/**
 * Signal hysteresis filter callback
 *
 * @callback Signal.SettableSignal~HysteresisCallback
 * @param newValue New (incoming) value
 * @param currentValue Current signal value (note that this is held back both by the hysteresis filter and the update block signal)
 * @param previousValue Previously set value (this is not held back by the hysteresis filter or the update block signal)
 * @returns {boolean|number} Return false to update value with no hysteresis, return true to continue with any existing hysteresis, return a number to delay by this many milliseconds
 */

/**
 * Get hysteresis filter for this signal.
 *
 * @returns {?Signal.SettableSignal~HysteresisCallback} Hysteresis callback, or null if disabled
 */
SettableSignal.prototype.getHysteresisFilter = function() {
	return this._hysteresisCheck || null;
};

/**
 * Set hysteresis filter for this signal.
 * The filter may arbitrarily delay value updates to the signal.
 *
 * Any hysteresis currently in progress is cancelled (by calling {@link Signal.SettableSignal#flushHysteresis})
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * @param {?Signal.SettableSignal~HysteresisCallback} callback Hysteresis callback, or null to disable hysteresis
 */
SettableSignal.prototype.setHysteresisFilter = function(callback) {
	if (this._const) throw new Error("Cannot call setHysteresisFilter on a const SettableSignal");

	this.flushHysteresis();

	if (callback == null) {
		delete this._hysteresisCheck;
	} else if (typeof callback === "function") {
		this._hysteresisCheck = callback;
	} else {
		throw new Error("Signal: setHysteresisFilter: invalid value for callback parameter");
	}
};

/**
 * Flush any pending changes delayed by a hysteresis filter
 */
SettableSignal.prototype.flushHysteresis = function() {
	if (this._hysteresisTimer) {
		window.clearTimeout(this._hysteresisTimer);
		delete this._hysteresisTimer;
		this._hysteresisBlocked = false;
		this._checkPending();
	}
};

SettableSignal.prototype._blockSignalChange = function() {
	this._blocked = this._blockSignal ? (!!this._blockSignal.getValue()) : false;
	this._checkPending();
};

SettableSignal.prototype._checkPending = function() {
	if (!(this._blocked || this._hysteresisBlocked) && this._changePending) {
		this._changePending = false;
		this._change(this._pendingValue);
	}
};

/**
 * Set update block signal, changes to this signal are blocked when the blockSignal is high/truthy/blocked
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * @param {?Signal.BlockCountSignal} blockSignal Update block signal, or null
 */
SettableSignal.prototype.setUpdateBlockSignal = function(blockSignal) {
	if (this._const) throw new Error("Cannot call setUpdateBlockSignal on a const SettableSignal");
	if (this._blockSignal) {
		this._blockSignal.removeListener("toggle", this._blockSignalChangeHandler);
	}
	this._blockSignal = blockSignal;
	if (this._blockSignal) {
		if (!this._blockSignalChangeHandler) {
			this._blockSignalChangeHandler = this._blockSignalChange.bind(this);
		}
		this._blockSignal.on("toggle", this._blockSignalChangeHandler);
	}
	this._blockSignalChange();
};

/**
 * Mark this signal as const
 *
 * After calling this method {@link Signal.SettableSignal#setValue}, {@link Signal.SettableSignal#setSignalTransform}, {@link Signal.SettableSignal#setSignalCopy},
 * {@link Signal.SettableSignal#setUpdateBlockSignal}, {@link Signal.SettableSignal#setHysteresisFilter}, {@link Signal.SettableSignal#setAutoFreeze}, {@link Signal.SettableSignal#setEqualityComparator}, and {@link Signal.SettableSignal#scuttle} may not be called.
 */
SettableSignal.prototype.makeConst = function() {
	if (!this._const) {
		Object.defineProperty(this, '_const',          { value: true });
	}
};

/**
 * Get auto-freeze flag
 * The default value is false
 *
 * @returns {boolean} Current value for auto-freeze enabled flag
 */
SettableSignal.prototype.getAutoFreeze = function() {
	return !!this._autoFreeze;
};

/**
 * Set auto-freeze flag
 * The default value is false
 * When enabled, [deepFreeze](https://www.npmjs.com/package/deep-freeze) is called on signal values where possible
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * @param {boolean} enabled New value for auto-freeze enabled flag
 */
SettableSignal.prototype.setAutoFreeze = function(enabled) {
	if (this._const) throw new Error("Cannot call setAutoFreeze on a const SettableSignal");
	this._autoFreeze = enabled;
	if (enabled) this._freeze();
};

SettableSignal.prototype._freeze = function() {
	if (this._value && typeof this._value === "object") {
		try {
			deepFreeze(this._value);
		} catch (e) {
			/* swallow */
		}
	}
};

/**
 * Permanently disable all future use of this signal
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 */
SettableSignal.prototype.scuttle = function() {
	if (this._scuttled) return;
	if (this._const) throw new Error("Cannot call scuttle on a const SettableSignal");
	this._clearInputEvents();
	this.removeAllListeners();
	if (this._hysteresisTimer) window.clearTimeout(this._hysteresisTimer);
	const scuttleTrap = function() {
		throw new Error("Cannot read/write or otherwise access a scuttled SettableSignal");
	};
	const handler = { get: scuttleTrap, set: scuttleTrap };
	Object.defineProperties(this, {
		_scuttled:            { value: true },
		_const:               handler,
		_autoFreeze:          handler,
		_blocked:             handler,
		_blockSignal:         handler,
		_hysteresisTimer:     handler,
		_hysteresisCheck:     handler,
		_value:               handler,
		_events:              handler,
		removeListener:       { value: function() {} },
		removeAllListeners:   { value: function() {} },
	});
};

/**
 * Signal value equality comparison callback
 *
 * This callback MUST NOT have observable side-effects, and MUST NOT attempt to modify the value or other properties of any signal.
 * Equality comparisons SHOULD be commutative and associative.
 *
 * @callback Signal.SettableSignal~EqualityComparatorCallback
 * @param valueA Arbitrary value A
 * @param valueB Arbitrary value B
 * @returns {boolean} Return true if the values are considered equal, false otherwise
 */

/**
 * Get signal value equality comparator callback for this signal
 *
 * By default the equality comparator is that from the [deep-eql](https://www.npmjs.com/package/deep-eql) npm package.
 *
 * @returns {Signal.SettableSignal~EqualityComparatorCallback} Current signal value equality comparator
 */
SettableSignal.prototype.getEqualityComparator = function() {
	return this._isEqual;
};

/**
 * Set equality comparator callback for this signal
 *
 * This may not be called if {@link Signal.SettableSignal#makeConst} has been called.
 *
 * Note the requirements of {@link Signal.SettableSignal~EqualityComparatorCallback} before use.
 *
 * @param {Signal.SettableSignal~EqualityComparatorCallback} comparator New current signal value equality comparator
 */
SettableSignal.prototype.setEqualityComparator = function(comparator) {
	if (this._const) throw new Error("Cannot call setEqualityComparator on a const SettableSignal");
	Object.defineProperty(this, '_isEqual', {
		value: comparator, configurable: true,
	});
};

function signalCountRegister(signal, key) {
	if (!signal._registrations) {
		Object.defineProperty(signal, '_registrations', { value: new Set() });
	}
	if (!signal._registrations.has(key)) {
		signal._registrations.add(key);
		signal._change(signal._value + 1);
	}
}

function signalCountUnregister(signal, key) {
	if (signal._registrations) {
		if (signal._registrations.delete(key)) signal._change(signal._value - 1);
	}
}

function getSignalCountRegistrationIterator(signal) {
	if (signal._registrations) {
		return signal._registrations.values();
	} else {
		return [][Symbol.iterator]();
	}
}

function signalCountFollowSignal(signal, other, listenerTracker) {
	immediateTrackCommon(other, "toggle", function() {
		if (other.getValue()) {
			signalCountRegister(signal, other);
		} else {
			signalCountUnregister(signal, other);
		}
	}, listenerTracker);
	if (other.getValue()) signalCountRegister(signal, other);
}

/**
 * @classdesc
 *
 * Const/read-only access wrapper around another signal
 *
 * @extends Signal.BaseSignal
 *
 * @memberof Signal
 *
 * @constructor
 * @param {!Signal.BaseSignal} signal Signal to wrap
 */
function ConstWrapperSignal(signal) {
	const self = this;
	Object.defineProperties(self, {
		_value:               { get: function () { return signal.getValue(); } },
		_isEqual:             { get: function () { return signal._isEqual; } },
		_change:              { value: null },
	});
	['isBlocked', 'getRegisteredBlockerIterator', 'getRegisteredReferenceIterator', 'getHysteresisFilter', 'getAutoFreeze', 'getEqualityComparator'].map(function(prop) {
		if (signal[prop] != null) {
			Object.defineProperty(self, prop, { value: function () { return signal[prop].apply(signal, arguments); } });
		}
	});
	MiscUtil.setupEventForwarding(signal, self);
}

inherits(ConstWrapperSignal, BaseSignal);

/**
 * @classdesc
 *
 * Block counter signal
 *
 * @extends Signal.BaseSignal
 *
 * @implements Blockable
 *
 * @memberof Signal
 *
 * @constructor
 */
function BlockCountSignal() {
	Object.defineProperty(this, '_refCount',        { value: true });
	this._value = 0;
}

inherits(BlockCountSignal, BaseSignal);

/**
 * Increment the block counter
 *
 * Using a {@link BlockableWrapper}, or calling one of: {@link Signal.BlockCountSignal#latch}, {@link Signal.BlockCountSignal#registerBlocker}, or {@link Signal.BlockCountSignal#setBlockerRegistered}, is generally preferable to calling this method.
 */
BlockCountSignal.prototype.block = function() {
	this._change(this._value + 1);
};

/**
 * Decrement the block counter
 *
 * Using a {@link BlockableWrapper} or the result of a previous call to {@link Signal.BlockCountSignal#latch}, or calling {@link Signal.BlockCountSignal#unregisterBlocker} or {@link Signal.BlockCountSignal#setBlockerRegistered}, is generally preferable to calling this method.
 */
BlockCountSignal.prototype.unblock = function() {
	this._change(this._value - 1);
};

/**
 * Add a blocker to the set of registered blockers, and increment the block counter if it was not already in the set
 * @param key An arbitrary key suitable for storing in a Set
 */
BlockCountSignal.prototype.registerBlocker = function(key) {
	signalCountRegister(this, key);
};

/**
 * Remove a blocker from the set of registered blockers, and decrement the block counter if it was in the set
 * @param key An arbitrary key suitable for storing in a Set
 */
BlockCountSignal.prototype.unregisterBlocker = function(key) {
	signalCountUnregister(this, key);
};

/**
 * Call {@link Signal.BlockCountSignal#registerBlocker} or {@link Signal.BlockCountSignal#unregisterBlocker}
 * @param key An arbitrary key suitable for storing in a Set
 * @param {boolean} registered True if the key is to be registered, false if the key is to be unregistered
 */
BlockCountSignal.prototype.setBlockerRegistered = function(key, registered) {
	if (registered) {
		signalCountRegister(this, key);
	} else {
		signalCountUnregister(this, key);
	}
};

/**
 * Return an iterator of the set of registered blockers
 * @returns {Iterator}
 */
BlockCountSignal.prototype.getRegisteredBlockerIterator = function() {
	return getSignalCountRegistrationIterator(this);
};

/**
 * Increment the block counter, and return a closure which decrements it again
 *
 * @returns {Function} closure which decrements the block counter
 */
BlockCountSignal.prototype.latch = function() {
	this.block();
	return onetime(this.unblock.bind(this));
};

/**
 * Returns true if jobs are blocked, i.e. if the block counter > 0
 * @returns {boolean} True if blocked
 */
BlockCountSignal.prototype.isBlocked = function() {
	return this._value > 0;
};

/**
 * Calls {@link Signal.BlockCountSignal#registerBlocker} when the value of the signal is highy/truthy, and {@link Signal.BlockCountSignal#unregisterBlocker} when the value of the signal is low/falsey, as necessary.
 * This can be used to follow the state of another block signal, for example.
 *
 * Note that remove the event listener using the listenerTracker does not unregister the blocker.
 *
 * @param {Signal.BaseSignal} signal Signal to follow
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 */
BlockCountSignal.prototype.registerBlockerSignal = function(signal, listenerTracker) {
	signalCountFollowSignal(this, signal, listenerTracker);
};

/**
 * @classdesc
 *
 * Reference counter signal
 *
 * @extends Signal.BaseSignal
 *
 * @memberof Signal
 *
 * @constructor
 */
function RefCountSignal() {
	Object.defineProperty(this, '_refCount',        { value: true });
	this._value = 0;
}

inherits(RefCountSignal, BaseSignal);

/**
 * Increment the reference counter
 *
 * Using one of: {@link Signal.RefCountSignal#latch}, {@link Signal.RefCountSignal#registerReference}, or {@link Signal.RefCountSignal#setReferenceRegistered}, is generally preferable to calling this method.
 */
RefCountSignal.prototype.increment = function() {
	this._change(this._value + 1);
};

/**
 * Decrement the reference counter
 *
 * Using the result of a previous call to {@link Signal.RefCountSignal#latch}, or calling {@link Signal.RefCountSignal#unregisterReference} or {@link Signal.RefCountSignal#setReferenceRegistered}, is generally preferable to calling this method.
 */
RefCountSignal.prototype.decrement = function() {
	this._change(this._value - 1);
};

/**
 * Add a reference to the set of registered references, and increment the reference counter if it was not already in the set
 * @param key An arbitrary key suitable for storing in a Set
 */
RefCountSignal.prototype.registerReference = function(key) {
	signalCountRegister(this, key);
};

/**
 * Remove a reference from the set of registered references, and decrement the reference counter if it was in the set
 * @param key An arbitrary key suitable for storing in a Set
 */
RefCountSignal.prototype.unregisterReference = function(key) {
	signalCountUnregister(this, key);
};

/**
 * Call {@link Signal.RefCountSignal#registerReference} or {@link Signal.RefCountSignal#unregisterReference}
 * @param key An arbitrary key suitable for storing in a Set
 * @param {boolean} registered True if the key is to be registered, false if the key is to be unregistered
 */
RefCountSignal.prototype.setReferenceRegistered = function(key, registered) {
	if (registered) {
		signalCountRegister(this, key);
	} else {
		signalCountUnregister(this, key);
	}
};

/**
 * Return an iterator of the set of registered references
 * @returns {Iterator}
 */
RefCountSignal.prototype.getRegisteredReferenceIterator = function() {
	return getSignalCountRegistrationIterator(this);
};

/**
 * Increment the reference counter, and return a closure which decrements it again
 *
 * @returns {Function} closure which decrements the reference counter
 */
RefCountSignal.prototype.latch = function() {
	this.increment();
	return onetime(this.decrement.bind(this));
};

/**
 * Calls {@link Signal.RefCountSignal#registerReference} when the value of the signal is highy/truthy, and {@link Signal.RefCountSignal#unregisterReference} when the value of the signal is low/falsey, as necessary.
 * This can be used to follow the state of another reference count signal, for example.
 *
 * Note that remove the event listener using the listenerTracker does not unregister the reference.
 *
 * @param {Signal.BaseSignal} signal Signal to follow
 * @param {ListenerTracker=} listenerTracker optional listener tracker
 */
RefCountSignal.prototype.registerReferenceSignal = function(signal, listenerTracker) {
	signalCountFollowSignal(this, signal, listenerTracker);
};

/**
 * @classdesc
 *
 * Read-only shared state property signal
 *
 * @extends Signal.BaseSignal
 *
 * @memberof Signal
 *
 * @constructor
 * @param {!(SharedState|Promise<SharedState>)} sharedState Shared state instance or promise thereof
 * @param {!string} property Shared state property name
 */
function SharedStatePropertySignal(sharedState, property) {
	const self = this;
	Promise.resolve(sharedState).then(function(ss) {
		ss.on('change', function(info) {
			if (info.key === property) self._change(info.value);
		});
		ss.on('remove', function(info) {
			if (info.key === property) self._change(undefined);
		});
	});
}

inherits(SharedStatePropertySignal, BaseSignal);

try {
	Object.freeze(BaseSignal.prototype);
	Object.freeze(SettableSignal.prototype);
	Object.freeze(ConstWrapperSignal.prototype);
	Object.freeze(BlockCountSignal.prototype);
	Object.freeze(RefCountSignal.prototype);
	Object.freeze(SharedStatePropertySignal.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = {
	BaseSignal: BaseSignal,
	SettableSignal: SettableSignal,
	ConstWrapperSignal: ConstWrapperSignal,
	BlockCountSignal: BlockCountSignal,
	RefCountSignal: RefCountSignal,
	SharedStatePropertySignal: SharedStatePropertySignal,
};
