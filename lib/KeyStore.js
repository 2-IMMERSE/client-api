/************************************************************************/
/* FILE:                KeyStore.js                                     */
/* DESCRIPTION:         Key store utility                               */
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
 * @classdesc
 *
 * Local store for media keys
 *
 * @constructor
 */
function KeyStore() {
	Object.defineProperties(this, {
		_cencKeyMap:          { value: {} },
	});
}

/**
 * Returns a mutable object mapping DASH CENC W3-style Clearkey key ID -> key value
 * Key IDs and values must be base64url format, see: {@link https://w3c.github.io/encrypted-media/index.html#using-base64url}
 *
 * @returns {Object.<string, string>}
 */
KeyStore.prototype.cencKeyMap = function() {
	return this._cencKeyMap;
};

/**
 * Convert a hex key string to a base64url string
 *
 * @param {string} hex key string
 * @returns {string} base64url key string
 */
KeyStore.prototype.hexKeyToBase64Url = function(keyString) {
	let str = new Buffer(keyString, 'hex').toString('base64');
	str = str.replace(/=+$/g, '');
	str = str.replace(/\+/g, '-');
	str = str.replace(/\//g, '_');
	return str;
};

/**
 * Convert a object containing hex key string to key valkue pairs to an object of base64url key strings to base64url string values
 *
 * @param {Object.<string, string>} hex key string pair object
 * @returns {Object.<string, string>} base64url key string pair object
 */
KeyStore.prototype.hexKeySetToBase64UrlSet = function(keyObject) {
	let out = {};
	for (let key in keyObject) {
		out[this.hexKeyToBase64Url(key)] = this.hexKeyToBase64Url(keyObject[key]);
	}
	return out;
};

try {
	Object.freeze(KeyStore.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = KeyStore;
