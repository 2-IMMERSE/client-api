/************************************************************************/
/* FILE:                TimeoutHandler.js                               */
/* DESCRIPTION:         Utility wrapper around setTimeout               */
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
 * Utility wrapper around setTimeout.
 * Calls addTimeout on construction if timeoutHandler is set
 *
 * @constructor
 * @param {?Function} timeoutHandler callback function
 * @param {?number} millis timeout in milliseconds
 */
function TimeoutHandler(timeoutHandler, millis) {
	this._timers = [];
	if (timeoutHandler) this.addTimeout(timeoutHandler, millis);
}

/**
 * Add a timeout function, if this TimeoutHandler has not been cancelled
 *
 * @param {Function} timeoutHandler callback function
 * @param {number} millis timeout in milliseconds
 */
TimeoutHandler.prototype.addTimeout = function(timeoutHandler, millis) {
	if (this._cancelled) return;
	this._timers.push(window.setTimeout(timeoutHandler, millis));
};

/**
 * Cancel any pending and future timeout handlers
 */
TimeoutHandler.prototype.cancel = function() {
	if (this._cancelled) return;
	this._cancelled = true;
	for (let i = 0; i < this._timers.length; i++) {
		window.clearTimeout(this._timers[i]);
	}
	delete this._timers;
};

module.exports = TimeoutHandler;
