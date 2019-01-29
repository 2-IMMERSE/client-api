/************************************************************************/
/* FILE:                RetryUtil.js                                    */
/* DESCRIPTION:         Utility for retry logic                         */
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
const $ = require('jquery');
const argCheck = require('./argCheck');

/**
 * Retry job function type
 *
 * @callback retryPromiseJobFunction
 * @param {!Object} retryState Retry State
 * @param {!number} retryState.attemptNum Attempt number (starting from 1)
 * @param {!Object} retryState.options Options object passed to {@link retryPromise}
 * @returns {(value|Promise)} job result, if a rejected promise is returned, the job function is retried
 */
/**
 * Retry job failure handler callback type
 *
 * @callback retryPromiseJobFailureCallback
 * @param err Promise rejection value
 * @param {!Object} retryState Retry State
 * @param {!number} retryState.attemptNum Attempt number (starting from 1)
 * @param {!Object} retryState.options Options object passed to {@link retryPromise}
 * @returns {boolean} Return true to continue retrying, or false to stop here
 */
/**
 * Retry job pre-retry callback type
 *
 * @callback retryPromisePreRetryCallback
 * @returns {boolean} Return true to continue retrying, or false to stop here
 */

/**
 * Execute and retry a function which returns a promise until it succeeds
 *
 * @param {!retryPromiseJobFunction} func Job function to execute, if a rejected promise is returned, the job function is retried
 * @param {!Logger} logger Logger
 * @param {Object=} options Optional options object
 * @param {string=} options.name Optional job name
 * @param {number=} [options.minDelay=0] Optional minimum delay in ms
 * @param {number=} [options.maxDelay=16384] Optional maximum delay in ms
 * @param {number=} [options.baseDelay=64] Optional base delay in ms
 * @param {number=} [options.maxAttempts=Infinity] Optional max attempt count
 * @param {retryPromiseJobFailureCallback=} options.retryFailureCallback Optional function to call if the job fails and is about to be retried
 * @param {retryPromisePreRetryCallback=} options.preRetryCallback Optional function to call just before executing a retry
 * @returns {Promise} Result promise which is resolved when the function eventually succeeds
 */
function retryPromise(func, logger, options) {
	argCheck(arguments, 3, logger, "retryPromise", options, ['name', 'minDelay', 'maxDelay', 'baseDelay', 'maxAttempts', 'retryFailureCallback', 'preRetryCallback']);
	const opts = $.extend({
		maxDelay: 16384,
		minDelay: 0,
		baseDelay: 64,
		maxAttempts: Infinity,
	}, options);
	let attemptNum = 0;
	const handler = function() {
		const result = new Promise(function(resolve, reject) {
			attemptNum++;
			resolve(func({
				attemptNum: attemptNum,
				options: options,
			}));
		});
		return result.then(function(res) {
			return res;
		}).catch(function(err) {
			if (attemptNum >= opts.maxAttempts) {
				logger.error("Attempt " + attemptNum + " of '" + (opts.name || "Unnamed job") + "' failed: ", err, ", making no more attempts");
				return Promise.reject(err);
			}
			if (opts.retryFailureCallback) {
				const continueRetry = opts.retryFailureCallback(err, {
					attemptNum: attemptNum,
					options: options,
				});
				if (!continueRetry) {
					logger.error("Attempt " + attemptNum + " of '" + (opts.name || "Unnamed job") + "' failed: ", err, ", making no more attempts as cancelled by callback");
					return Promise.reject(err);
				}
			}
			const interval = Math.max(opts.minDelay, Math.min(opts.maxDelay, opts.baseDelay * (1 << (attemptNum - 1))));
			logger.error("Attempt " + attemptNum + " of '" + (opts.name || "Unnamed job") + "' failed: ", err, ", retrying in " + interval + " ms");
			return new Promise(function(resolve, reject) {
				window.setTimeout(function() {
					if (opts.preRetryCallback) {
						if (!opts.preRetryCallback()) {
							logger.error("Attempt " + attemptNum + " of '" + (opts.name || "Unnamed job") + "' failed: ", err, ", aborted retry as cancelled by callback");
							reject(err);
							return;
						}
					}
					resolve(handler());
				}, interval);
			});
		});
	};
	return handler();
}

module.exports = {
	retryPromise: retryPromise,
};
