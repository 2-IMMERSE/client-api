/************************************************************************/
/* FILE:                SafeEventEmitter.js                             */
/* DESCRIPTION:         Safe event emitter wrapper which handles        */
/*                      throwing listeners                              */
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

const EventEmitter = require('events');
const inherits = require('inherits');
const Logger = require('./Logger');

/* global console */

function SafeEventEmitter() {
	// do nothing, to make inheritance easier
}

inherits(SafeEventEmitter, EventEmitter);

SafeEventEmitter.prototype._maxListeners = Infinity; // turn off those pesky max listener warnings

SafeEventEmitter.prototype.setSafeEventEmitterLogger = function(logger, name) {
	this._safeEventEmitterLogger = logger;
	this._safeEventEmitterName = name;
};

function safeEventEmitterError(instance, err, type) {
	let logger;
	if (instance._safeEventEmitterLogger) {
		logger = instance._safeEventEmitterLogger;
	} else if (instance.logger instanceof Logger) {
		logger = instance.logger;
	} else if (SafeEventEmitter.defaultLogger instanceof Logger) {
		logger = SafeEventEmitter.defaultLogger;
	} else {
		logger = console;
	}
	logger.error("Error thrown in listener when emitting '" + type + "' event on '" + (instance._safeEventEmitterName ? instance._safeEventEmitterName: instance.toString()) + "': ", err);
}

SafeEventEmitter.monkeyPatch = function(instance) {
	if (instance.emit === EventEmitter.prototype.emit) {
		for (let prop in SafeEventEmitter.prototype) {
			instance[prop] = SafeEventEmitter.prototype[prop];
		}
	}
};

// copy and modify base EventEmitter implementation of emit method
// changes:
// * don't bother with "error" event logic
// * wrap all listener calls in try..catch, with logging
SafeEventEmitter.prototype.emit = function(type) {
	let handler, len, args, i, listeners;

	if (!this._events)
		this._events = {};

	handler = this._events[type];

	if (!handler)
		return false;

	if (typeof handler === 'function') {
		try {
			switch (arguments.length) {
				// fast cases
				case 1:
					handler.call(this);
					break;
				case 2:
					handler.call(this, arguments[1]);
					break;
				case 3:
					handler.call(this, arguments[1], arguments[2]);
					break;
				// slower
				default:
					args = Array.prototype.slice.call(arguments, 1);
					handler.apply(this, args);
			}
		} catch (e) {
			safeEventEmitterError(this, e, type);
		}
	} else if (typeof handler === 'object') {
		args = Array.prototype.slice.call(arguments, 1);
		listeners = handler.slice();
		len = listeners.length;
		for (i = 0; i < len; i++) {
			try {
				listeners[i].apply(this, args);
			} catch (e) {
				safeEventEmitterError(this, e, type);
			}
		}
	}

	return true;
};

try {
	Object.freeze(SafeEventEmitter.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = SafeEventEmitter;
