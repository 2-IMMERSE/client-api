/************************************************************************/
/* FILE:                ModuleUtil.js                                   */
/* DESCRIPTION:         Module utilities                                */
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

const Promise = require("promise");

/**
 * Utilities for module operations
 *
 * @namespace ModuleUtil
 */

const loadedModules = {};

let scriptBaseUrl;
const getScriptBaseUrl = function() {
	if (scriptBaseUrl) return scriptBaseUrl;
	const targ = "/lib/client-lib.js";
	const scripts = document.getElementsByTagName("script");
	for (let i = 0; i < scripts.length; ++i) {
		const src = scripts[i].getAttribute('src');
		if (src.endsWith(targ)) {
			scriptBaseUrl = src.slice(0, 1 - targ.length);
			return scriptBaseUrl;
		}
	}
	throw new Error("Can't get base script URL");
};

const loadModule = function(postfix, req) { // jshint ignore:line
	if (!loadedModules[postfix]) {
		loadedModules[postfix] = new Promise(function(fulfill, reject) {
			const script = document.createElement('script');
			script.onload = function() {
				try {
					fulfill(window.require(req));
				} catch(e) {
					reject("Failed to require module: " + postfix + ", " + req + ", " + e.toString());
				}
			};
			script.onerror = function(e) {
				reject("Failed to load module: " + postfix + ", " + req);
			};
			script.src = getScriptBaseUrl() + postfix;
			document.body.appendChild(script);
		});
	}
	return loadedModules[postfix];
};

module.exports = {
};
