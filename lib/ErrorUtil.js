/************************************************************************/
/* FILE:                ErrorUtil.js                                    */
/* DESCRIPTION:         Utilities for error management                  */
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

const inherits = require('inherits');
const $ = require("jquery");
const ListenerTracker = require('listener-tracker');

const Signal = require('./Signal');
const EnumUtil = require('./EnumUtil');

/**
 * Error management utilities
 *
 * @namespace ErrorUtil
 */

const ErrorMode = EnumUtil.createConstEnum(
		/**
		 * Error mode bit flags
		 *
		 * @readonly
		 * @alias ErrorMode
		 * @memberof! ErrorUtil
		 * @enum {number}
		 */
		{
			/** user level error, don't use this without having read and understood the source */
			USER: 1 << 0,

			/** developer level error */
			DEV:  1 << 1,

			/** warning instead of error */
			WARN:  1 << 2,
		}, "ErrorUtil.ErrorMode");

/**
 * Base mixin for error flag and signal
 *
 * @memberof ErrorUtil
 * @mixin
 */
const ErrorMixin = {};

ErrorMixin.setup = function() {
	const self = this;

	let logPrefix = '';
	if (self.modes & ErrorMode.DEV) {
		logPrefix += "DEV: ";
	}
	if (self.modes & ErrorMode.USER) {
		logPrefix += "USER: ";
	}

	self.logMethod = (self.modes & ErrorMode.WARN) ? 'warn' : 'error';
	self.logTypePrefix = (self.modes & ErrorMode.WARN) ? "Warning signal" : "Error signal";

	let last_rise;

	self.on("rise", function() {
		last_rise = self.dMAppController.monotonicNow();
		if (self.modes & ErrorMode.DEV) {
			if (!self._devLogCtl) self._devLogCtl = self.dMAppController.makeDevLoggingCtl({ single: true });
			self.dMAppController.devDialogLogger[self.logMethod](self.logTypePrefix + ": " + self.msg, self._devLogCtl);
		}
		if (self.modes & ErrorMode.USER) {
			self.dMAppController._userErrorMap.set(self, self.msg);
			self._updateUserErrors();
		}
		self.dMAppController._errorSignalLogger[self.logMethod](logPrefix + self.logTypePrefix + ": " + self.msg);
		if (self.parent) {
			self.parent.registerReference(self);
		}
	});
	self.on("fall", function() {
		const delta = self.dMAppController.monotonicNow() - last_rise;
		if (self.modes & ErrorMode.DEV) {
			if (self._devLogCtl) self._devLogCtl.clear();
		}
		if (self.modes & ErrorMode.USER) {
			self.dMAppController._userErrorMap.delete(self);
			self._updateUserErrors();
		}
		self.dMAppController._errorSignalLogger.info(logPrefix + self.logTypePrefix + " cleared: " + self.msg + " (after: " + delta + " ms)");
		if (self.parent) {
			self.parent.unregisterReference(self);
		}
	});
};

ErrorMixin._updateUserErrors = function() {
	const errorList = [];
	for (let [item, name] of this.dMAppController._userErrorMap) {
		let ok = true;
		if (item._umsSignals) {
			for (let i = 0; i < item._umsSignals.length; i++) {
				if (item._umsSignals[i].getValue()) {
					ok = false;
					break;
				}
			}
		}
		if (ok) errorList.push(name);
	}
	this.dMAppController.userErrorSignal._change(errorList);
};

/**
 * Change message (dev) or user error name (user, see {@link DMAppController#userErrorTexts}, {@link DMAppController#userErrorSignal}) string
 *
 * @param {string|DMAppController.UserErrorName} msg
 */
ErrorMixin.setMessage = function(msg) {
	this.msg = msg;
	if (this.getValue() && this.modes & ErrorSignal.DEV) {
		this.dMAppController.devDialogLogger[this.logMethod](this.logTypePrefix + ": " + msg, this._devLogCtl);
	}
	if (this.getValue() && this.modes & ErrorSignal.USER) {
		this.dMAppController._userErrorMap.set(this, msg);
		this._updateUserErrors();
	}
};

/**
 * Change set of user-level masking signals for this error
 *
 * This error is suppressed at user level when any of the provided signals are truthy/raised
 *
 * @param {!Signal.BaseSignal[]} signals Array of signals (may be empty) (useful with {@link ErrorUtil.ErrorFlag} or {@link ErrorUtil.ErrorSignal})
 */
ErrorMixin.setUserMaskingSignals = function(signals) {
	if (this._umsTracker) this._umsTracker.removeAllListeners();
	this._umsTracker = ListenerTracker.createTracker();
	for (let i = 0; i < signals.length; i++) {
		this._umsTracker.subscribeTo(signals[i]).on("toggle", this._updateUserErrors.bind(this));
	}
	this._umsSignals = signals;
	this._updateUserErrors();
};

/**
 * Reference-counter error signal
 *
 * @memberof ErrorUtil
 * @constructor
 * @extends Signal.RefCountSignal
 * @mixes ErrorUtil.ErrorMixin
 * @param {!DMAppController} dMAppController DMApp controller
 * @param {?Signal.RefCountSignal} parentSignal Optional parent reference count signal (useful with {@link ErrorUtil.ErrorSignal})
 * @param {!ErrorUtil.ErrorMode} modes Mode bits
 * @param {!(string|DMAppController.UserErrorName)} msg Error message (dev) or user error name (user, see {@link DMAppController#userErrorTexts}, {@link DMAppController#userErrorSignal}) string
 */
function ErrorSignal(dMAppController, parentSignal, modes, msg) {
	Object.defineProperties(this, {
		dMAppController: { value: dMAppController },
		parent:          { value: parentSignal },
		modes:           { value: modes },
		msg:             { value: msg, writable: true },
	});

	Signal.RefCountSignal.call(this);
	this.setup();
}

inherits(ErrorSignal, Signal.RefCountSignal);
$.extend(ErrorSignal.prototype, ErrorMixin);

/**
 * Boolean error flag
 *
 * @memberof ErrorUtil
 * @constructor
 * @extends Signal.BaseSignal
 * @mixes ErrorUtil.ErrorMixin
 * @param {!DMAppController} dMAppController DMApp controller
 * @param {?Signal.RefCountSignal} parentSignal Optional parent reference count signal (useful with {@link ErrorUtil.ErrorSignal})
 * @param {!ErrorUtil.ErrorMode} modes Mode bits
 * @param {!(string|DMAppController.UserErrorName)} msg Error message (dev) or user error name (user, see {@link DMAppController#userErrorTexts}, {@link DMAppController#userErrorSignal}) string
 */
function ErrorFlag(dMAppController, parentSignal, modes, msg) {
	Object.defineProperties(this, {
		dMAppController: { value: dMAppController },
		parent:          { value: parentSignal },
		modes:           { value: modes },
		msg:             { value: msg, writable: true },
	});

	Signal.BaseSignal.call(this, false, { boolean: true });
	this.setup();
}

inherits(ErrorFlag, Signal.BaseSignal);
$.extend(ErrorFlag.prototype, ErrorMixin);

/**
 * Sets error state to true/raised
 */
ErrorFlag.prototype.raise = function() {
	this._change(true);
};

/**
 * Clears error state to false/cleared
 */
ErrorFlag.prototype.clear = function() {
	this._change(false);
};

/**
 * Sets error state
 * @param {boolean} value Error state to set
 */
ErrorFlag.prototype.setState = function(value) {
	this._change(!!value);
};

try {
	Object.freeze(ErrorSignal.prototype);
	Object.freeze(ErrorFlag.prototype);
	Object.freeze(ErrorMode);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = {
	ErrorSignal: ErrorSignal,
	ErrorFlag: ErrorFlag,
	ErrorMode: ErrorMode,
};
