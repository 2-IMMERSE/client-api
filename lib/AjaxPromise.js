/************************************************************************/
/* FILE:                AjaxPromise.js                                  */
/* DESCRIPTION:         Utility class to make an AJAX request           */
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
const $ = require("jquery");
const sprintf = require("sprintf-js").sprintf;
const inherits = require('inherits');
const SafeEventEmitter = require('./SafeEventEmitter');

function AjaxPromiseResult(values, no_enum_values) {
	for (const prop in values) {
		Object.defineProperty(this, prop, { enumerable: true, value: values[prop] });
	}
	for (const prop in no_enum_values) {
		Object.defineProperty(this, prop, { value: values[prop] });
	}
	try {
		Object.freeze(this);
	} catch(e) {
		/* swallow: doesn't matter too much if this fails */
	}
}
AjaxPromiseResult.prototype = {
	toString: function() {
		let msg;
		try {
			msg = JSON.stringify(this);
		} catch(e) {
			msg = "[failed to serialise result state]";
		}
		return "AjaxPromiseResult: " + msg;
	},
};

/**
 * @typedef {Object} ajaxPromiseResult
 * @prop data Result data from a successful request
 * @prop errorThrown Error data from an unsuccessful request
 * @prop {string} textStatus status string
 * @prop {jqXHR} jqXHR
 * @prop {number} status jqXHR.status
 * @prop {Array} args original arguments to ajaxPromise
 * @prop {AjaxPromise} parent AjaxPromise instance
 * @prop {number} retryNum Retry number of this request (starting for 0 for first request)
 */

/**
 * @classdesc
 *
 * Ajax Promise class. Arguments to the constructor are stored as the specified arguments for later call(s) to exec.
 *
 * @extends EventEmitter
 *
 * @constructor
 */
function AjaxPromise() {
	this.args = [].slice.call(arguments);
}
inherits(AjaxPromise, SafeEventEmitter);

/**
 * Arguments are stored as the specified arguments for later call(s) to exec.
 * Any previous stored arguments are replaced.
 *
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setArguments = function() {
	this.args = [].slice.call(arguments);
	return this;
};

/**
 * Set logger for this instance
 *
 * @param {Logger} logger
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setLogger = function(logger) {
	this.logger = logger;
	return this;
};

/**
 * Get active logger for this instance, or null, this is not generally the same as the logger supplied to {@link AjaxPromise#setLogger}.
 *
 * @returns {?Logger} active logger, or null
 */
AjaxPromise.prototype.getActiveLogger = function(logger) {
	return this.currentLogger || this.logger;
};

/**
 * Set title for this instance
 *
 * @param {string} title
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setTitle = function(title) {
	this.title = title;
	return this;
};

/**
 * Set get time function for this instance
 *
 * @param {Function} timeFunc Function which returns a timestamp in ms
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setTimeFunction = function(timeFunc) {
	this.timeFunc = timeFunc;
	return this;
};

/**
 * Add an object to be blocked during execution of the request
 *
 * @param {Blockable} obj Blockable object
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.addBlockObject = function(obj) {
	if (!this._blocks) this._blocks = [];
	this._blocks.push(obj);
	return this;
};

/**
 * Set whether auto-retry is enabled
 *
 * @param {boolean} enabled Whether to enable auto-retry
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.enableAutoRetry = function(enabled) {
	this.autoRetry = enabled;
	return this;
};

/**
 * Set timeout in ms
 *
 * @param {?number} timeout Timeout value in ms
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setTimeout = function(timeout) {
	this.timeout = timeout;
	return this;
};

/**
 * Set queue to use for queueing calls to exec()
 *
 * @param {PromiseExecQueue} queue Queue to enqueue execution on
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setPromiseExecQueue = function(queue) {
	this.execQueue = queue;
	return this;
};

/**
 * @typedef {Object} ajaxCredentials
 * @prop {string} username
 * @prop {string} password
 */

/**
 * Set credentials to use
 *
 * @param {ajaxCredentials} credentials Credentials to use
 * @returns {AjaxPromise} this
 */
AjaxPromise.prototype.setCredentials = function(credentials) {
	this.credentials = credentials;
	return this;
};

/**
 * Retry notification event.
 *
 * @event AjaxPromise#retry
 * @type {ajaxPromiseResult}
 */
/**
 * Success notification event.
 *
 * @event AjaxPromise#success
 * @type {ajaxPromiseResult}
 */
/**
 * Failure notification event.
 *
 * @event AjaxPromise#fail
 * @type {ajaxPromiseResult}
 */

let _nextConnId = 0;

/**
 * Wrapper function which forwards all previously specified arguments to jquery.ajax and returns a Promise
 * @returns {Promise<ajaxPromiseResult>}
 */
AjaxPromise.prototype.exec = function() {
	if (this.execQueue) {
		return this.execQueue.enqueue(this._execIntl.bind(this, 0), "AjaxPromise queued execution" + (this.title  ? ": " + this.title: ""));
	} else {
		return this._execIntl(0);
	}
};

AjaxPromise.prototype._execIntl = function(retryNum) {
	const self = this;
	const args = self.args;

	const settings = (function() {
		const base_settings = {};
		if (self.timeout) base_settings.timeout = self.timeout;
		if (self.credentials) {
			base_settings.xhrFields = {
				withCredentials: true,
			};

			base_settings.headers = {
				'Authorization': 'Basic ' + btoa(self.credentials.username + ':' + self.credentials.password),
			};
		}
		let index = 0;
		if (typeof args[0] === "string") {
			base_settings.url = args[0];
			index++;
		}
		if (typeof args[index] === "object") $.extend(base_settings, args[index]);
		return base_settings;
	})();
	const url = settings.url;

	let logger;
	let timeFunc;
	let now;
	if (self.logger) {
		logger = self.logger.makeChildLogger(" Conn: " + _nextConnId++);
		if (self.title) {
			const title = "(" + self.title + ")";
			logger.addMessageTransform(function(args) {
				args.push(title);
				return args;
			});
		}
		if (retryNum) {
			logger.addMessageTransform(function(args) {
				args.unshift("[Retry attempt: " + retryNum + "]");
				return args;
			});
		}
		if (self.timeFunc) {
			timeFunc = self.timeFunc;
			logger.addMessageTransform(function(args) {
				const t = self.timeFunc();
				args.unshift(sprintf("At %.3f ms (%+.3f ms): ", t, t - now));
				return args;
			});
		}
		self.currentLogger = logger;
	}

	if (self._blocks) {
		if (!self._pendingUnblocks) self._pendingUnblocks = [];
		for (let i = 0; i < self._blocks.length; i++) {
			self._blocks[i].block();
			self._pendingUnblocks.push(self._blocks[i]);
		}
	}

	self.promise = new Promise(function(fulfill, reject) {
		if (timeFunc) now = timeFunc();
		if (logger) logger.info("Issuing " + (settings.method || 'GET') +  " request to " + url);
		$.ajax(settings).then(function(data, textStatus, jqXHR) {
			if (logger) logger.info("Success: " + jqXHR.status + " (" + textStatus + ")");
			const result = new AjaxPromiseResult({ data: data, textStatus: textStatus, jqXHR: jqXHR, status: jqXHR.status, args: args, retryNum: retryNum }, { parent: self });
			fulfill(result);
			self.emit("success", result);
		}, function(jqXHR, textStatus, errorThrown) {
			const msg = "Failed: " + jqXHR.status + " (" + textStatus + "), (" + errorThrown + ")";
			const result = new AjaxPromiseResult({ errorThrown: errorThrown, textStatus: textStatus, jqXHR: jqXHR, status: jqXHR.status, args: args, retryNum: retryNum }, { parent: self });
			if (self.autoRetry && !jqXHR.status) {
				// connection failed: retry
				const interval = Math.min(15000, 25 * (1 << (retryNum + 1)));
				if (logger) logger.warn(msg + ", retrying in " + interval + " ms");
				window.setTimeout(function() {
					fulfill(self._execIntl(retryNum + 1));
				}, interval);
				self.emit("retry", result);
			} else {
				if (logger) logger.warn(msg);
				reject(result);
			}
			self.emit("fail", result);
		});
	});
	if (self._pendingUnblocks) {
		self.promise.finally(function() {
			for (let i = 0; i < self._pendingUnblocks.length; i++) {
				self._pendingUnblocks[i].unblock();
			}
			delete self._pendingUnblocks;
		});
	}
	return self.promise;
};

try {
	Object.freeze(AjaxPromise.prototype);
	Object.freeze(AjaxPromiseResult.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = AjaxPromise;
