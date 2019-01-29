/************************************************************************/
/* FILE:                RefCountedSignalMap.js                          */
/* DESCRIPTION:         Reference counted signal map container          */
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
const onetime = require('onetime');

const Signal = require('./Signal');
const SafeEventEmitter = require('./SafeEventEmitter');

/**
 * @classdesc
 * Reference counted map of keys to {@link Signal.SettableSignal} instances
 *
 * @extends EventEmitter
 *
 * @constructor
 */
function RefCountedSignalMap() {
	Object.defineProperties(this, {
		_items:               { value: new Map() },
	});
}

inherits(RefCountedSignalMap, SafeEventEmitter);

/**
 * @typedef {Object} RefCountedSignalMap~GetSignalResult
 * @prop {!Signal.SettableSignal} signal signal instance
 * @prop {!Function} unref Use this method to signal that the signal instance is no longer required, this will decrement its ref count
 */

/**
 * New signal notification event.
 *
 * @event RefCountedSignalMap#newSignal
 * @type {object}
 * @property {!string} key Key
 * @property {!Signal.SettableSignal} signal signal instance
 */
/**
 * Remove signal notification event.
 *
 * @event RefCountedSignalMap#removeSignal
 * @type {object}
 * @property {!string} key Key
 */

/**
 * Get signal, incrementing its ref count and creating it if it doesn't already exist
 *
 * @param {string} key Arbitrary string key
 * @returns {!RefCountedSignalMap~GetSignalResult} Signal instance
 */
RefCountedSignalMap.prototype.getSignal = function(key) {
	const self = this;
	if (typeof key !== "string") throw new Error("RefCountedSignalMap.getSignal: key must be a string");
	let item = self._items.get(key);
	if (!item) {
		item = {
			rc: 0,
			signal: new Signal.SettableSignal(),
		};
		self._items.set(key, item);
		self.emit("newSignal", { key: key, signal: item.signal });
	}
	item.rc++;
	return Object.freeze({
		signal: item.signal,
		unref: onetime(function() {
			item.rc--;
			if (item.rc === 0) {
				self.emit("removeSignal", { key: key });
				item.signal.scuttle();
				self._items.delete(key);
			}
		}),
	});
};

/**
 * Get existing signal, without affecting its ref count
 *
 * @param {string} key Arbitrary string key
 * @returns {?Signal.SettableSignal} Signal instance, or null
 */
RefCountedSignalMap.prototype.getExistingSignal = function(key) {
	const item = this._items.get(key);
	return item ? item.signal : null;
};

/**
 * Get array of existing keys
 * @returns {!Array.<string>} Array of string keys
 */
RefCountedSignalMap.prototype.getKeys = function() {
	return Array.from(this._items.keys());
};

/**
 * Get iterator of existing keys/signals
 * @returns {!MapIterator.<string, Signal.SettableSignal>} Iterator of key, signal pairs
 */
RefCountedSignalMap.prototype.getEntries = function() {
	return this._items.entries();
};

try {
	Object.freeze(RefCountedSignalMap.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = RefCountedSignalMap;
