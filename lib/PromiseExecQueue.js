/************************************************************************/
/* FILE:                PromiseExecQueue.js                             */
/* DESCRIPTION:         Promise exec queue utility                      */
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
 * @classdesc
 *
 * Queue for serialised execution of job functions which may either return a value
 * indicating immediate completion, or a promise indicating ongoing asynchronous
 * execution.
 * Execution may be temporarily blocked. Queued jobs may be cancelled.
 *
 * @implements Blockable
 *
 * @constructor
 * @param {Logger} [logger=console] Optional Logger, if not specified the console is used
 */
function PromiseExecQueue(logger /* optional */) {
	/* globals console */
	this._logger = logger ? logger : console;
	this._queue = [];
	this._running = false;
	this._blockCount = 0;
}

function PromiseExecQueueJobCancellation(msg) {
	this._msg = msg;
}

PromiseExecQueueJobCancellation.prototype.toString = function() {
	return this._msg;
};

PromiseExecQueue.prototype = {

	/**
	 * Enqueue a new job
	 *
	 * @param {Function} job Job function which returns a value, or a promise
	 * @param {string=} name Optional name for the job
	 * @returns {Promise} A promise that resolves to the job's return value, or is rejected with a cancellation reason object
	 */
	enqueue: function (job, name /* optional */) /* -> Promise<job result> */ {
		const self = this;
		const p = new Promise(function (resolve, reject) {
			if (self._destroyed) {
				let msg = "Queue destroyed";
				if (name) msg += ", job: " + name;
				return reject(msg);
			}
			self._queue.push({
				run: function() {
					resolve(job());
				},
				cancel: function(reason) {
					let msg = "Job cancelled: " + reason;
					if (name) msg += ", job: " + name;
					reject(new PromiseExecQueueJobCancellation(msg));
				},
			});
		});
		p.catch(function(e) {
			if (e instanceof PromiseExecQueueJobCancellation) {
				self._logger.info(e);
			} else {
				let msg = "Rejected promise in PromiseExecQueue";
				if (name) msg += ", job: " + name;
				if (e != null) {
					self._logger.error(msg + ", error: ", e);
				} else {
					self._logger.error(msg);
				}
			}
		});
		p.finally(function() {
			self._running = false;
			self._run();
		});
		this._run();
		return p;
	},

	_run: function() {
		if (this._execValveBlocked) return;
		if (this._execValve && this._execValve.isBlocked()) {
			this._execValveBlocked = true;
			const ev = this._execValve;
			ev.enqueue(function() {
				if (this._execValve === ev) delete this._execValveBlocked;
				this._run();
			}.bind(this));
			return;
		}
		if (this._blockCount === 0 && !this._running && this._queue.length) {
			const job = this._queue.shift();
			this._running = true;
			job.run();
		}
	},

	/**
	 * Cancel all non-started jobs
	 *
	 * @param {string} reason Cancellation reason
	 */
	cancelAll: function(reason) {
		let job;
		while ((job = this._queue.shift())) {
			job.cancel(reason);
		}
	},

	/**
	 * Increment the block counter, jobs are not started when the block counter > 0
	 */
	block: function() {
		this._blockCount++;
	},

	/**
	 * Decrement the block counter, jobs are not started when the block counter > 0
	 */
	unblock: function() {
		if (this._blockCount === 0) throw new Error("PromiseExecQueue.unblock called when block count is 0");
		this._blockCount--;
		this._run();
	},

	/**
	 * Set an ExecValve, execution is blocked whenever the ExecValve is blocked
	 * @param {?ExecValve} execValve
	 */
	setExecValve: function(execValve) {
		delete this._execValveBlocked;
		this._execValve = execValve;
		this._run();
	},

	/**
	 * Get number of jobs currently queued
	 *
	 * @returns {number} Number of jobs which are currently queued (not including the currently running job, if any)
	 */
	getQueueLength: function() {
		return this._queue.length;
	},

	/**
	 * Get whether a job is currently running
	 *
	 * @returns {boolean} Whether a job is currently running
	 */
	isJobRunning: function() {
		return this._running;
	},

	/**
	 * Destructor: the object should not be used after this method is called
	 *
	 * @param {string=} reason Optional destruction reason
	 */
	destroy: function(reason) {
		this._blockCount = Infinity;
		this._destroyed = true;
		this.cancelAll(reason || "queue destruction");
	},
};

try {
	Object.freeze(PromiseExecQueue.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = PromiseExecQueue;
