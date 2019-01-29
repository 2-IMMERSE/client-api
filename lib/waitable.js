/************************************************************************/
/* FILE:                waitable.js                                     */
/* DESCRIPTION:         Utility wrapper around Promise                  */
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

/**
 * @typedef Waitable
 * @description Promise with additional methods
 * @property {resolveMethod} signal Resolve the promise, has no effect if the promise is already resolved or rejected
 * @property {resolveMethod} abort Reject the promise, has no effect if the promise is already resolved or rejected
 * @property {resolveFunctionMethod} resolveFunction Resolve/reject the promise with the return value or thrown exception of the provided function, has no effect if the promise is already resolved or rejected
 */
/**
 @callback resolveMethod
 @param value Value with which to resolve/reject the promise
*/
/**
 @callback resolveFunctionMethod
 @param {resolveMethod} func Function with which to resolve/reject the promise
*/

/**
 * Create an unresolved promise with additional methods to resolve or reject it
 * @returns {Waitable} A promise with additional methods
 */

// Note that this is a free-standing function, not a constructed class with inheritance,
// because the latter does not play nicely with the Promise library
function waitable() {
	let _fulfill, _reject;
	const promise = new Promise(function(fulfill, reject) {
		_fulfill = fulfill;
		_reject = reject;
	});
	promise.signal = function(value) {
		_fulfill.call(promise, value);
	};
	promise.abort = function(value) {
		_reject.call(promise, value);
	};
	promise.resolveFunction = function(func) {
		const p = new Promise(function(fulfill, reject) {
			fulfill(func());
		});
		p.then(promise.signal, promise.abort);
	};
	return promise;
}

module.exports = waitable;
