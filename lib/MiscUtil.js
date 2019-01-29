/************************************************************************/
/* FILE:                MiscUtil.js                                     */
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

const $ = require("jquery");

/**
 * Misc utilities
 *
 * @namespace MiscUtil
 */

const evForwardSet = new WeakSet();

/**
 * Forwards all events emitted on src (except newListener and removeListener) to follower.
 * This tries to avoid leaking follower with respect to src.
 *
 * @memberof MiscUtil
 *
 * @param {EventEmitter} src Event source
 * @param {EventEmitter} follower Event follower
 */
function setupEventForwarding(src, follower) {
	if (evForwardSet.has(follower)) {
		throw new Error("Don't call setupEventForwarding more than once on same follower");
	}
	evForwardSet.add(follower);

	const handlerMap = new Map();
	follower.on('newListener', function(type) {
		if (type === 'newListener' || type === 'removeListener') return;
		if (follower.listenerCount(type) === 0) {
			const handler = follower.emit.bind(follower, type);
			handlerMap.set(type, handler);
			src.on(type, handler);
		}
	});
	follower.on('removeListener', function(type) {
		if (type === 'newListener' || type === 'removeListener') return;
		if (follower.listenerCount(type) === 0) {
			src.removeListener(type, handlerMap.get(type));
			handlerMap.delete(type);
		}
	});
}

/**
 * Set toString() member of an object to return the JSON.stringify representation, optionally with a string prefix.
 *
 * @memberof MiscUtil
 *
 * @param obj Object (if this is not an object, there is no effect).
 * @param {string=} prefix Optional string prefix
 * @return obj parameter
 */
function setObjectToStringJson(obj, prefix) {
	if (obj && typeof obj === "object") {
		if (!obj.hasOwnProperty('toString')) {
			const toString = function() {
				let msg;
				try {
					msg = JSON.stringify(obj);
				} catch(e) {
					msg = "[failed to serialise object: " + obj.prototype.toString.call(obj) + "]";
				}
				if (prefix) msg = prefix + ": " + msg;
				return msg;
			};
			Object.defineProperty(obj, 'toString', { value: toString, configurable: true, writable: true, enumerable: false });
		}
	}
	return obj;
}

const makeSingleLevelReadOnlyObjectAccessWrapperObjectMap = new WeakMap();

/**
 * Create single-level read-only object proxy using ES6 Proxy
 *
 * @memberof MiscUtil
 *
 * @param {!Object} obj Object to proxy
 * @return {!Object} obj Read-only proxy of obj, or obj itself if proxying was not possible
 */
function makeSingleLevelReadOnlyObjectAccessWrapper(obj) {
	if (typeof Proxy === 'undefined') return obj;
	const prev = makeSingleLevelReadOnlyObjectAccessWrapperObjectMap.get(obj);
	if (prev) return prev;
	const res = new Proxy(obj, {
		setPrototypeOf: function(target, newProto) {
			throw new TypeError('MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper: Attempt to call setPrototypeOf on read-only object');
		},
		preventExtensions: function(target) {
			throw new TypeError('MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper: Attempt to call preventExtensions on read-only object');
		},
		defineProperty: function(target, property, descriptor) {
			throw new TypeError('MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper: Attempt to call defineProperty on read-only object, property: ' + property);
		},
		set: function(target, property, value, receiver) {
			throw new TypeError('MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper: Attempt to call set on read-only object, property: ' + property);
		},
		deleteProperty: function(target, property) {
			throw new TypeError('MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper: Attempt to call deleteProperty on read-only object, property: ' + property);
		},
	});
	makeSingleLevelReadOnlyObjectAccessWrapperObjectMap.set(obj, res);
	return res;
}

const makeRecursiveReadOnlyObjectAccessWrapperObjectMap = new WeakMap();

/**
 * Create recursive read-only object proxy using ES6 Proxy
 *
 * @memberof MiscUtil
 *
 * @param {!Object} obj Object to proxy
 * @return {!Object} obj Read-only proxy of obj, or obj itself if proxying was not possible
 */
function makeRecursiveReadOnlyObjectAccessWrapper(obj) {
	if (typeof Proxy === 'undefined') return obj;
	const prev = makeRecursiveReadOnlyObjectAccessWrapperObjectMap.get(obj);
	if (prev) return prev;
	const res = new Proxy(obj, {
		get: function(target, name) {
			const val = target[name];
			if (val && typeof val === 'object') {
				return makeRecursiveReadOnlyObjectAccessWrapper(val);
			} else {
				return val;
			}
		},
		setPrototypeOf: function(target, newProto) {
			throw new TypeError('MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper: Attempt to call setPrototypeOf on read-only object');
		},
		preventExtensions: function(target) {
			throw new TypeError('MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper: Attempt to call preventExtensions on read-only object');
		},
		defineProperty: function(target, property, descriptor) {
			throw new TypeError('MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper: Attempt to call defineProperty on read-only object, property: ' + property);
		},
		set: function(target, property, value, receiver) {
			throw new TypeError('MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper: Attempt to call set on read-only object, property: ' + property);
		},
		deleteProperty: function(target, property) {
			throw new TypeError('MiscUtil.makeRecursiveReadOnlyObjectAccessWrapper: Attempt to call deleteProperty on read-only object, property: ' + property);
		},
	});
	makeRecursiveReadOnlyObjectAccessWrapperObjectMap.set(obj, res);
	return res;
}

/**
 * Deep-clone value and perform write at path
 *
 * @memberof MiscUtil
 *
 * @param input Input value, this should be JSON-serialisable
 * @param {!Array.<string>} path Array of path elements
 * @return Clone of input value, with written value
 */
function cloneWithWriteAtPath(input, path, value) {
	const enter = function(parent, pathOffset) {
		if (pathOffset === path.length) return value;
		let ret;
		if (Array.isArray(parent)) {
			ret = parent.slice();
		} else {
			ret = $.extend({}, parent);
		}
		ret[path[pathOffset]] = enter(ret[path[pathOffset]], pathOffset + 1);
		return ret;
	};
	return enter(input, 0);
}

module.exports = {
	setupEventForwarding: setupEventForwarding,
	setObjectToStringJson: setObjectToStringJson,
	makeSingleLevelReadOnlyObjectAccessWrapper: makeSingleLevelReadOnlyObjectAccessWrapper,
	makeRecursiveReadOnlyObjectAccessWrapper: makeRecursiveReadOnlyObjectAccessWrapper,
	cloneWithWriteAtPath: cloneWithWriteAtPath,
};
