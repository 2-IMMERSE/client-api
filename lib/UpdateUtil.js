/************************************************************************/
/* FILE:                UpdateUtil.js                                   */
/* DESCRIPTION:         Utilities for updates in async contexts         */
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

const Promise = require('promise');
const Signal = require('./Signal');

/**
 * Utilities for updates in async contexts
 *
 * @namespace UpdateUtil
 */

/**
 * Return a closure which invokes the provided callback when the promise is resolved.
 * If the callback is called more than once before the promise is resolved, the calls are de-duplicated
 * and only the last call has effect.
 *
 * @memberof UpdateUtil
 *
 * @param {Promise} promise Promise to wait on
 * @param {Function} callback The first function parameter is the resolution of the promise parameter above, subsequent arguments are those passed to the returned closure
 * @returns {Function} A closure which invokes the callback parameter
 */
function makeUpdateWhenReadyClosure(promise, callback) {
	let pending_args;
	let resolved;
	let resolved_value;
	Promise.resolve(promise).then(function(value) {
		resolved = true;
		resolved_value = value;
		if (pending_args) {
			const args = [value].concat(pending_args);
			pending_args = null;
			callback.apply(null, args);
		}
	});
	return function() {
		if (resolved) {
			callback.apply(null, [resolved_value].concat([].slice.call(arguments)));
		} else {
			pending_args = [].slice.call(arguments);
		}
	};
}

/**
 * Return a closure which invokes the provided callback when the shared state instance (or promise thereof, or signal thereof) is in a writeable state
 * If the callback is called more than once whilst the shared state instance (or promise thereof, or signal thereof) is not writeable, the calls are de-duplicated
 * and only the last call has effect.
 *
 * @memberof UpdateUtil
 *
 * @param {!(SharedState|Promise<SharedState>|Signal.BaseSignal<SharedState>)} sharedState Shared state instance, promise thereof, or signal thereof
 * @param {Function} callback The first function parameter is the shared state instance, subsequent arguments are those passed to the returned closure
 * @returns {Function} A closure which invokes the callback parameter
 */
function makeSharedStateUpdateWhenReadyClosure(sharedState, callback) {
	let pending_args;
	let sharedStateValue;
	let eventHandlerApplied = false;
	const eventHandler = function() {
		if (sharedStateValue.readyState === 'open') {
			if (pending_args) {
				const args = [sharedStateValue].concat(pending_args);
				pending_args = null;
				callback.apply(null, args);
			}
			sharedStateValue.off('readystatechange', eventHandler);
			eventHandlerApplied = false;
		}
	};
	if (sharedState instanceof Signal.BaseSignal) {
		sharedStateValue = sharedState.getValue();
		sharedState.on("change", function() {
			if (sharedStateValue && eventHandlerApplied) {
				sharedStateValue.off('readystatechange', eventHandler);
				eventHandlerApplied = false;
			}
			sharedStateValue = sharedState.getValue();
			if (sharedStateValue && pending_args) {
				sharedStateValue.on('readystatechange', eventHandler);
				eventHandlerApplied = true;
			}
		});
	} else {
		Promise.resolve(sharedState).then(function(ss) {
			sharedStateValue = ss;
			if (pending_args) {
				sharedStateValue.on('readystatechange', eventHandler);
				eventHandlerApplied = true;
			}
		});
	}
	return function() {
		if (sharedStateValue && sharedStateValue.readyState === 'open') {
			callback.apply(null, [sharedStateValue].concat([].slice.call(arguments)));
		} else {
			pending_args = [].slice.call(arguments);
			if (sharedStateValue && !eventHandlerApplied) {
				sharedStateValue.on('readystatechange', eventHandler);
				eventHandlerApplied = true;
			}
		}
	};
}


module.exports = {
	makeUpdateWhenReadyClosure: makeUpdateWhenReadyClosure,
	makeSharedStateUpdateWhenReadyClosure: makeSharedStateUpdateWhenReadyClosure,
};
