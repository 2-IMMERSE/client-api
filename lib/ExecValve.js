/************************************************************************/
/* FILE:                ExecValve.js                                    */
/* DESCRIPTION:         Utility wrapper to queue or exec functions      */
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

const waitable = require('./waitable');

/**
 * @classdesc
 *
 * Utility wrapper to queue or exec functions
 *
 * @implements Blockable
 *
 * @constructor
 */
function ExecValve() {
	this._queue = [];
	this._blockCount = 0;
}

/**
 * Enqueue a new job
 *
 * @param {Function} job Job function
 * @returns {Promise} A promise that resolves to the job's return value
 */
ExecValve.prototype.enqueue = function(job) {
	const w = waitable();
	if (this._blockCount === 0) {
		return w.resolveFunction(job);
	} else {
		this._queue.push(w.resolveFunction.bind(w, job));
	}
	return w;
};


ExecValve.prototype._run = function() {
	while (this._blockCount === 0 && this._queue.length) {
		this._queue.shift()();
	}
};

/**
 * Increment the block counter, jobs are not executed when the block counter > 0
 */
ExecValve.prototype.block = function() {
	this._blockCount++;
};

/**
 * Decrement the block counter, jobs are not executed when the block counter > 0
 */
ExecValve.prototype.unblock = function() {
	if (this._blockCount === 0) throw new Error("ExecValve.unblock called when block count is 0");
	this._blockCount--;
	this._run();
};

/**
 * Returns true if jobs are blocked, i.e. if the block counter > 0
 * @returns {boolean} True if jobs are blocked
 */
ExecValve.prototype.isBlocked = function() {
	return this._blockCount > 0;
};

module.exports = ExecValve;
