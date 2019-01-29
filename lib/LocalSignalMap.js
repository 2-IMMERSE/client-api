/************************************************************************/
/* FILE:                LocalSignalMap.js                               */
/* DESCRIPTION:         Local signal map container                      */
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

const Signal = require('./Signal');

/**
 * @classdesc
 * Local map of keys to {@link LocalSignalMap~T} (by default: {@link Signal.SettableSignal}) instances
 *
 * @constructor
 *
 * @param {function=} signalConstructor optional signal constructor function for this instance, if not given this is {@link Signal.SettableSignal}, this constructor SHOULD return a (subclass of) {@link Signal.BaseSignal}
 */
function LocalSignalMap(signalConstructor) {
	Object.defineProperties(this, {
		_signals:             { value: new Map() },
		_signalConstructor:   { value: signalConstructor || Signal.SettableSignal },
	});
}

/**
 * Local signal map storage type
 * By default this is {@link Signal.SettableSignal}
 *
 * A different type can be used by passing the signal constructor to this instances constructor
 *
 * @typedef LocalSignalMap~T
 */

/**
 * New signal callback
 *
 * This may be used to set default values and/or perform other operations on new signals
 *
 * @callback LocalSignalMap~NewSignalCallback
 * @param key Key of new signal
 * @param {LocalSignalMap~T} signal New signal
 */

/** @member {?LocalSignalMap~NewSignalCallback} LocalSignalMap#newSignalCallback Optional new signal callback */

/**
 * Get existing signal
 * @param key Arbitrary key suitable for lookup in a Map()
 * @returns {?LocalSignalMap~T} Local signal, or null
 */
LocalSignalMap.prototype.getExistingSignal = function(key) {
	return this._signals.get(key) || null;
};

/**
 * Get signal, creating it first if it doesn't already exist
 * @param key Arbitrary key suitable for lookup in a Map()
 * @returns {!LocalSignalMap~T} Local signal
 */
LocalSignalMap.prototype.getSignal = function(key) {
	let signal = this._signals.get(key);
	if (!signal) {
		signal = new this._signalConstructor();
		this._signals.set(key, signal);
		if (this.newSignalCallback) this.newSignalCallback(key, signal);
	}
	return signal;
};

/**
 * Get array of existing keys
 * @returns {!Array} Array of keys
 */
LocalSignalMap.prototype.getKeys = function() {
	return Array.from(this._signals.keys());
};

/**
 * Get iterator of existing keys/signals
 * @returns {!MapIterator.<Key, LocalSignalMap~T>} Iterator of key, signal pairs
 */
LocalSignalMap.prototype.getEntries = function() {
	return this._signals.entries();
};

/**
 * Clear all signals
 */
LocalSignalMap.prototype.clear = function() {
	this._signals.clear();
};

try {
	Object.freeze(LocalSignalMap.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = LocalSignalMap;
