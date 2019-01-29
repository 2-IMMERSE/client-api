/************************************************************************/
/* FILE:                ResourceMgmtUtil.js                             */
/* DESCRIPTION:         Resource management utilities                   */
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

const TimeoutHandler = require('./TimeoutHandler');

/**
 * Resource management utilities
 *
 * @namespace ResourceMgmtUtil
 */

 /**
 * RefCountedDelayedDestructor reference counter change callback
 *
 * @callback ResourceMgmtUtil.RefCountedDelayedDestructor~RefCountChangeCallback
 * @param {!ResourceMgmtUtil.RefCountedDelayedDestructor} instance RefCountedDelayedDestructor instance
 * @param {!number} refcount Current reference count
 * @param {!boolean} increased True if icnreased, false if decreased
 */

/**
 * Reference counter with delayed destructor semantics.
 *
 * The destructor(s) are called when the reference count falls to 0 from a non-zero value and then remains at 0 for the timeout period.
 * The initial value of the reference count is 0.
 *
 * @memberof ResourceMgmtUtil
 *
 * @constructor
 * @param {number} timeoutPeriod Timeout period in ms to wait before calling the destructor(s) when the refcount falls and remains at 0
 * @param {Function=} destructor Optional destructor function
 */
function RefCountedDelayedDestructor(timeoutPeriod, destructor) {
	Object.defineProperties(this, {
		_timeoutPeriod:       { value: timeoutPeriod },
		_refCount:            { value: 0, writable: true },
		_destructors:         { value: [] },
	});
	if (destructor) this._destructors.push(destructor);
}

/**
 * Add destructor functions
 *
 * Destructors are called in reverse order
 *
 * @param {...Function} destructors Destructor functions to add
 */
RefCountedDelayedDestructor.prototype.addDestructors = function() {
	if (this._destroyed) throw new Error("RefCountedDelayedDestructor is destroyed (addDestructors)");
	this._destructors.push.apply(this._destructors, arguments);
};

/**
 * Increment reference count
 */
RefCountedDelayedDestructor.prototype.ref = function() {
	if (this._destroyed) throw new Error("RefCountedDelayedDestructor is destroyed (ref)");
	this._refCount++;
	if (this._rcChangeCallbacks) {
		for (let i = 0; i < this._rcChangeCallbacks.length; i++) {
			this._rcChangeCallbacks[i](this, this._refCount, true);
		}
	}
	if (this._timeout) {
		this._timeout.cancel();
		delete this._timeout;
	}
};

/**
 * Decrement reference count
 */
RefCountedDelayedDestructor.prototype.unref = function() {
	if (this._destroyed) throw new Error("RefCountedDelayedDestructor is destroyed (unref)");
	if (this._refCount === 0) throw new Error("RefCountedDelayedDestructor.unref called when reference count is 0");
	this._refCount--;
	if (this._rcChangeCallbacks) {
		for (let i = 0; i < this._rcChangeCallbacks.length; i++) {
			this._rcChangeCallbacks[i](this, this._refCount, false);
		}
	}
	if (this._refCount === 0) {
		this._timeout = new TimeoutHandler(function() {
			while (this._destructors.length) {
				this._destructors.pop()();
			}
			Object.defineProperty(this, 'destroyed', { value: true });
		}.bind(this), this._timeoutPeriod);
	}
};

/**
 * Get reference count
 * @returns {number} reference count
 */
RefCountedDelayedDestructor.prototype.getReferenceCount = function() {
	if (this._destroyed) throw new Error("RefCountedDelayedDestructor is destroyed (getReferenceCount)");
	return this._refCount;
};

/**
 * Add a calllback called when the reference count changes
 * @param {...ResourceMgmtUtil.RefCountedDelayedDestructor~RefCountChangeCallback} callbacks callback functions to add
 */
RefCountedDelayedDestructor.prototype.addRefCountChangeCallbacks = function() {
	if (this._destroyed) throw new Error("RefCountedDelayedDestructor is destroyed (addRefCountChangeCallback)");
	if (!this._rcChangeCallbacks) {
		Object.defineProperty(this, '_rcChangeCallbacks', { value: [] });
	}
	this._rcChangeCallbacks.push.apply(this._rcChangeCallbacks, arguments);
};


module.exports = {
	RefCountedDelayedDestructor: RefCountedDelayedDestructor,
};
