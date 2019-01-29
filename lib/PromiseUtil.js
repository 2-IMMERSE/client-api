/************************************************************************/
/* FILE:                PromiseUtil.js                                  */
/* DESCRIPTION:         Promise utilities                               */
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
 * Promise utilities
 *
 * @namespace PromiseUtil
 */

/**
 * Equivalent of Promise.all for object values.
 * Returns a promise which is resolved with a copy of the input object with all enumerable Promise properties
 * replaced with their resolved value.
 *
 * @memberof PromiseUtil
 *
 * @param {Object.<string, (Promise|value)>} obj Object of promises or values
 * @returns {Object.<string, value>} Promise resolved with copy of input object with Promise properties resolved
 */
function promiseAllObject(obj) {
	const props = [];
	const promises = [];
	for (let prop in obj) {
		props.push(prop);
		promises.push(obj[prop]);
	}
	return Promise.all(promises).then(function(values) {
		const out = {};
		for (let i = 0; i < props.length; i++) {
			out[props[i]] = values[i];
		}
		return out;
	});
}

module.exports = {
	promiseAllObject: promiseAllObject,
};
