/************************************************************************/
/* FILE:                Logger.js                                       */
/* DESCRIPTION:         Logging functionality                           */
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

const sprintf = require("sprintf-js").sprintf;
const argCheck = require('./argCheck');
const ClockMiscUtil = require('./ClockMiscUtil');

/* global console */

/**
 * Logging method at trace level (4)
 *
 * @method Logger#trace
 * @param {...*} args arguments to call logging method with
 */
/**
 * Logging method at debug level (3)
 *
 * @method Logger#debug
 * @param {...*} args arguments to call logging method with
 */
/**
 * Logging method at info level (2)
 *
 * @method Logger#info
 * @param {...*} args arguments to call logging method with
 */
/**
 * Logging method at warn level (1)
 *
 * @method Logger#warn
 * @param {...*} args arguments to call logging method with
 */
/**
 * Logging method at error level (0)
 *
 * @method Logger#error
 * @param {...*} args arguments to call logging method with
 */

/**
 * @classdesc
 *
 * Logging interface loosely based on LogLevel
 * @see https://github.com/pimterry/loglevel
 *
 * @constructor
 * @param {Object=} params                    optional parameters object
 * @param {string=} params.name               optional name for this Logger, used as a prefix
 * @param {(number|string)=} params.level     optional logging level, defaults to WARN
 * @param {boolean=} params.concatLogArgs     optional whether to concat logging arguments before outputting (useful on Android)
 * @param {boolean=} params.consoleLongForm   optional whether to add supplementary information to console logging output
 * @param {boolean=} params.noConsoleOutput   optional whether to disable output to the console
 * @param {Array.<Logger~MessageTransformFunction>=} params.messageTransforms optional array of message transform functions
 * @param {Array.<Logger~MessageOutputFunction>=} params.messageOutputs optional array of message output functions
 */
function Logger(params) {
	if (params) {
		if (params.name != null) {
			this._name = params.name;
		}
		if (params.concatLogArgs != null) {
			this._concatLogArgs = params.concatLogArgs;
		}
		if (params.consoleLongForm != null) {
			this._consoleLongForm = params.consoleLongForm;
		}
		if (params.noConsoleOutput != null) {
			this._noConsoleOutput = params.noConsoleOutput;
		}
		if (params.messageTransforms != null && params.messageTransforms.length) {
			this._messageTransforms = [].concat(params.messageTransforms);
		}
		if (params.messageOutputs != null && params.messageOutputs.length) {
			this._messageOutputs = [].concat(params.messageOutputs);
		}
	}
	if (params && params.level != null) {
		this.setLevel(params.level);
	} else {
		this.setLevel(this.levels.WARN);
	}
}

/**
 * Object mapping from level names to their corresponding integer values
 * Levels include: SILENT, ERROR, WARN, INFO, DEBUG, TRACE
 *
 * This is both an instance and a static member
 *
 * @static
 */
Logger.prototype.levels = {
	"SILENT": -1,
	"ERROR": 0,
	"WARN": 1,
	"INFO": 2,
	"DEBUG": 3,
	"TRACE": 4,
};

Logger.levels = Logger.prototype.levels;

/**
 * Get description text of log level
 * @param {number|string} level
 */
Logger.getLevelDescription = function(level) {
	if (typeof level === "string" && Logger.levels[level.toUpperCase()] !== undefined) {
		level = Logger.levels[level.toUpperCase()];
	}
	if (Number.isInteger(level)) {
		for (let prop in Logger.levels) {
			if (Logger.levels[prop] === level) {
				return prop + " (" + level + ")";
			}
		}
	}
	return "Invalid level: " + level;
};

/**
 * Get integer log level number from log level
 * @param {number|string} level number or string
 * @returns number integer log level
 */
Logger.getLevelNumber = function(level) {
	if (typeof level === "string" && Logger.levels[level.toUpperCase()] !== undefined) {
		level = Logger.levels[level.toUpperCase()];
	}
	if (Number.isInteger(level)) {
		return level;
	}
	throw new Error("Logger.getLevelNumber() called with invalid level: " + level);
};

/**
 * Flatten log message output to a string in long-form format
 *
 * See {@link Logger~MessageOutputFunction}
 *
 * @param {!Array} logArguments Arguments to log method
 * @param {!string} methodName Log method name
 * @param {!number} methodLevel Log method level
 * @param {!string} loggerName Logger name
 * @returns {!string} Flattened message
 */
Logger.flattenMessageOutputLongForm = function(logArguments, methodName, methodLevel, loggerName) {
	return sprintf("%-24s %5s: ", (new Date()).toISOString(), methodName.toUpperCase()) + (loggerName ? loggerName + ": " : "") + Logger.flattenMessageArray(logArguments);
};

/**
 * Flatten log message array to a string
 *
 * @param {!Array} logArguments Arguments to log method
 * @returns {!string} Flattened message
 */
Logger.flattenMessageArray = function(msgs) {
	return msgs.map(function(val) {
		if (val != null && val instanceof Error) {
			return "[" + val.name + ": " + val.message + "\n" + val.stack + "\n]";
		} else if (val != null && typeof val === "object" && val.toString === Object.prototype.toString) {
			try {
				return JSON.stringify(val);
			} catch (e) {
				/* swallow */
			}
		}
		return val;
	}).join(" ");
};

Logger.prototype._flattenMessageArray = Logger.flattenMessageArray;

Logger.prototype._noop = function() { };

/**
 * Get current log level
 *
 * @returns {number}
 */
Logger.prototype.getLevel = function () {
	return this._level;
};

/**
 * Set current log level
 * @param {number} level
 */
Logger.prototype.setLevel = function (level) {
	if (typeof level === "string" && this.levels[level.toUpperCase()] !== undefined) {
		level = this.levels[level.toUpperCase()];
	}
	if (Number.isInteger(level)) {
		this._level = level;
		this._setup();
	} else {
		throw new Error("log.setLevel() called with invalid level: " + level);
	}
};

Logger.prototype._setup = function() {
	this._setupMethod("error", 0);
	this._setupMethod("warn", 1);
	this._setupMethod("info", 2);
	this._setupMethod("debug", 3);
	this._setupMethod("trace", 4);
};

Logger.prototype._setupMethod = function(methodName, level) {
	if (level > this._level) {
		this[methodName] = this._noop;
		return;
	}

	let method;
	if (this._noConsoleOutput || typeof console === "undefined") {
		method = this._noop;
	} else if (console[methodName] !== undefined) {
		method = console[methodName].bind(console);
	} else if (console.log !== undefined) {
		method = console.log.bind(console);
	} else {
		method = this._noop;
	}

	if (this._consoleLongForm) {
		let oldMethod = method;
		method = function() {
			oldMethod(sprintf("%-24s %5s: ", (new Date()).toISOString(), methodName.toUpperCase()) + this._flattenMessageArray([].slice.call(arguments)));
		}.bind(this);
	}

	const prefix = this._name ? this._name + ": " : "";
	if (this._concatLogArgs) {
		let oldMethod = method;
		method = function() {
			oldMethod(prefix + this._flattenMessageArray([].slice.call(arguments)));
		}.bind(this);
	} else if (prefix) {
		method = method.bind(null, prefix);
	}

	if (this._messageOutputs) {
		let oldMethod = method;
		method = function() {
			let args = [].slice.call(arguments);
			for (let i = 0; i < this._messageOutputs.length; i++) {
				this._messageOutputs[i](args, methodName, level, this._name);
			}
			oldMethod.apply(null, args);
		}.bind(this);
	}

	if (this._messageTransforms) {
		let oldMethod = method;
		method = function() {
			let args = [].slice.call(arguments);
			for (let i = 0; i < this._messageTransforms.length; i++) {
				args = this._messageTransforms[i](args, methodName, level, this._name);
			}
			oldMethod.apply(null, args);
		}.bind(this);
	}

	this[methodName] = method;
};

const methodNames = ["error", "warn", "info", "debug", "trace"];

Logger.prototype.emitMessage = function(level, options) {
	let args = [].slice.call(arguments, 2);
	level = Logger.getLevelNumber(level);
	if (level > this._level) return;
	const methodName = methodNames[level];

	if (!options) options = {};

	if (this._messageTransforms) {
		for (let i = 0; i < this._messageTransforms.length; i++) {
			args = this._messageTransforms[i](args, methodName, level, this._name);
		}
	}
	if (this._messageOutputs && !options.noMessageOutputs) {
		for (let i = 0; i < this._messageOutputs.length; i++) {
			this._messageOutputs[i](args, methodName, level, this._name);
		}
	}
	if (options.console != null ? !options.console : this._noConsoleOutput) return;
	if (typeof console === "undefined") return;
	const prefix = this._name ? this._name + ": " : "";
	if (options.longform != null ? options.longform : this._consoleLongForm) {
		args = [sprintf("%-24s %5s: ", (new Date()).toISOString(), methodName.toUpperCase()) + prefix + this._flattenMessageArray(args)];
	} else if (this._concatLogArgs) {
		args = [prefix + this._flattenMessageArray(args)];
	} else {
		args.unshift(prefix);
	}
	if (console[methodName] !== undefined) {
		console[methodName].apply(console, args);
	} else if (console.log !== undefined) {
		console.log.apply(console, args);
	}
};

/**
 * Set current log level to enable all logging
 */
Logger.prototype.enableAll = function() {
	this.setLevel(this.levels.TRACE);
};

/**
 * Set current log level to disable all logging
 */
Logger.prototype.disableAll = function() {
	this.setLevel(this.levels.SILENT);
};

/**
 * Return a new logger with an extended prefix
 *
 * @param {string=} subName optional name to append to this Logger's name/prefix
 * @returns {Logger}
 */
Logger.prototype.makeChildLogger = function(subName) {
	const subLogger = new Logger({
		name: (this._name || '') + ((this._name && subName) ? ":" : "") + (subName || ''),
		level: this._level,
		concatLogArgs: this._concatLogArgs,
		messageTransforms: this._messageTransforms,
		consoleLongForm: this._consoleLongForm,
		noConsoleOutput: this._noConsoleOutput,
		messageOutputs: this._messageOutputs,
	});
	return subLogger;
};

/**
 * Call error method on all arguments, and then call throw with the concatenation of all arguments.
 *
 * @param {...*} args arguments to call error method and throw with
 */
Logger.prototype.throwError = function() {
	const args = [].slice.call(arguments);
	this.error.apply(this, ["Throwing error: "].concat(args));
	throw new Error((this._name ? (this._name + ": ") : "") + args.join(" "));
};


/**
 * Return a closure which calls the named logging method with the remaining arguments
 *
 * @param {string} funcName name of logging method to call
 * @param {...*} args arguments to call logging method with
 * @returns {Function}
 */
Logger.prototype.deferred = function(funcName) {
	const args = [].slice.call(arguments, 1);
	return function() {
		this[funcName].apply(this, args);
	}.bind(this);
};

/**
 * Return a closure which calls the named logging method with the remaining arguments,
 * followed by the arguments to the closure
 *
 * @param {string} funcName name of logging method to call
 * @param {...*} args arguments to call logging method with, followed by closure arguments
 * @returns {Function}
 */
Logger.prototype.deferredConcat = function(funcName) {
	const args = [].slice.call(arguments, 1);
	return function() {
		this[funcName].apply(this, args.concat([].slice.call(arguments)));
	}.bind(this);
};

/**
 * Log message transform function type
 *
 * @callback Logger~MessageTransformFunction
 * @param {!Array} logArguments Arguments to log method
 * @param {!string} methodName Log method name
 * @param {!number} methodLevel Log method level
 * @param {!string} loggerName Logger name
 * @returns {!Array} New arguments to log method
 */

/**
 * Adds a log message transform function
 *
 * @param {Logger~MessageTransformFunction} transformFunc Transform function
 */
Logger.prototype.addMessageTransform = function(transformFunc) {
	if (this._messageTransforms) {
		this._messageTransforms.push(transformFunc);
	} else {
		this._messageTransforms = [transformFunc];
		this._setup();
	}
};

/**
 * Log message output function type
 *
 * @callback Logger~MessageOutputFunction
 * @param {!Array} logArguments Arguments to log method
 * @param {!string} methodName Log method name
 * @param {!number} methodLevel Log method level
 * @param {!string} loggerName Logger name
 */

/**
 * Adds a log message output function
 *
 * @param {Logger~MessageOutputFunction} outputFunc Output function
 */
Logger.prototype.addMessageOutput = function(outputFunc) {
	if (this._messageOutputs) {
		this._messageOutputs.push(outputFunc);
	} else {
		this._messageOutputs = [outputFunc];
		this._setup();
	}
};

/**
 * Set whether to disable output to the console
 *
 * @param {boolean} disabled Whether to disable output to the console
 */
Logger.prototype.setConsoleOutputDisableState = function(disabled) {
	this._noConsoleOutput = !!disabled;
	this._setup();
};

/**
 * Flushable log event counter
 *
 * @typedef Logger~FlushableLogEventCounter
 * @prop {!Function} flush Flush log output
 * @prop {!Function} event Increment the number of events to log
 */

/**
 * Create flushable log event counter for this logger
 *
 * @param {!string} funcName name of logging method to call
 * @param {object=} options Optional options object
 * @param {number=} options.autoFlushTimeout Optional timeout in ms after which flush() should be called automatically, default off
 * @param {...*} args arguments to call logging method with, preceded with number of events accumulated, postfixed with other details
 * @returns {Logger~FlushableLogEventCounter}
 */
Logger.prototype.makeFlushableLogEventCounter = function(funcName, options) {
	const logger = this;
	const args = [].slice.call(arguments, 2);
	if (!options) options = {};
	argCheck([], 0, logger, "makeFlushableLogEventCounter()", options, ['autoFlushTimeout']);
	let evtCount = 0;
	let evtFlushTimer;
	let firstEvtTime;
	const flush = function() {
		if (!evtCount) return;
		logger[funcName].apply(logger, [evtCount + " x"].concat(args, "in " + (ClockMiscUtil.monotonicNow() - firstEvtTime) + " ms"));
		evtCount = 0;
		if (evtFlushTimer != null) {
			window.clearTimeout(evtFlushTimer);
			evtFlushTimer = null;
		}
	};
	return {
		flush: flush,
		event: function() {
			if (!evtCount) firstEvtTime = ClockMiscUtil.monotonicNow();
			evtCount++;
			if (options.autoFlushTimeout && !evtFlushTimer) evtFlushTimer = window.setTimeout(flush, options.autoFlushTimeout);
		},
	};
};

try {
	Object.freeze(Logger.prototype);
	Object.freeze(Logger.prototype.levels);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = Logger;
