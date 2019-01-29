/************************************************************************/
/* FILE:                ClockMiscUtil.js                                */
/* DESCRIPTION:         Misc clock utilities                            */
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
 * Misc clock utilities
 *
 * @namespace ClockMiscUtil
 */

function getMonotonicTimeFunc(logger) {
	if (typeof window.performance === 'object') {
		const test = function(name) {
			if (typeof window.performance[name] !== 'function') return null;
			try {
				if (typeof window.performance[name]() !== 'number') return null;
			} catch(e) {
				return null;
			}
			if (logger) logger.debug("Using window.performance." + name + "() as monotonic clock source");
			return window.performance[name].bind(window.performance);
		};
		const result = test('now') || test('webkitNow');
		if (result) return result;
	}
	if (logger) logger.warn("Using Date.now() as monotonic clock source");
	return Date.now.bind(Date);
}

// temporary function
/**
 * Return a monotonic timestamp in ms.
 *
 * @memberof ClockMiscUtil
 * @returns {number} Monotonic timestamp in ms
 */
function monotonicNow() {
	getMonotonicTimeFunc(null)();
}

module.exports = {
	getMonotonicTimeFunc: getMonotonicTimeFunc,
	monotonicNow: monotonicNow,
};
