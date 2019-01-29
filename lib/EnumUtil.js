/************************************************************************/
/* FILE:                EnumUtil.js                                     */
/* DESCRIPTION:         Enum utilities                                  */
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

/**
 * Enumeration utilities
 *
 * @namespace EnumUtil
 */

let annotationSymbol = "___enum_anotation_symbol___";
try {
	annotationSymbol = Symbol(annotationSymbol);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

/**
 * Function to return a display string representing an enum value
 *
 * @memberof EnumUtil
 *
 * @param {!Object} obj Enum object
 * @param value Enum value
 * @returns {string}
 */
function enumToString(obj, value) {
	for (let prop in obj) {
		if (obj[prop] === value) return prop;
	}
	return "Unknown enum" + (Object.prototype.hasOwnProperty.call(obj, annotationSymbol) ? " [" + obj[annotationSymbol] + "] " : " ") + "value: " + value;
}

/**
 * Function to create a const enum object which traps (by throwing an exception) on property accesses on non-existent keys
 *
 * @memberof EnumUtil
 *
 * @param {!Object} obj Enum object
 * @param {?string} name Optional enum name
 * @returns {!Object} Const and trapped enum object
 */
function createConstEnum(obj, name) {
	try {
		let clone = Object.create(null);
		for (let prop in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, prop)) clone[prop] = obj[prop];
		}
		obj = clone;
		if (name) obj[annotationSymbol] = name;
		Object.freeze(obj);
	} catch (e) {
		/* swallow: doesn't matter too much if this fails */
	}
	if (typeof Proxy === 'undefined') return obj;
	return new Proxy(obj, {
		get: function(target, key) {
			if (!(key in target)) {
				throw new Error("Attempted to access nonexistent property: '" + String(key) + "' on enum object" + (name ? ": '" + name + "'" : ""));
			}
			return target[key];
		}
	});
}

module.exports = {
	enumToString: enumToString,
	createConstEnum: createConstEnum,
};
