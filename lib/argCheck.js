/************************************************************************/
/* FILE:                argCheck.js                                     */
/* DESCRIPTION:         Argument checker util                           */
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

const $ = require("jquery");

/**
 * Function to perform simple validation of an arguments array and optionally an options object
 *
 * @param {!Array} args Arguments array
 * @param {!number} count Max number of arguments to accept in args
 * @param {!Logger} logger Logger to output validation errors to
 * @param {string} name Name of caller to use when logging errors
 * @param {?Object} opts Optional options object
 * @param {?Array<string>} validOpts Optional array of valid option keys names in opts. Required if opts is non-null.
 */
function argCheck(args, count, logger, name, opts, validOpts) {
	if (opts) {
		const options = $.extend({}, opts);
		for (let j = 0; j < validOpts.length; j++) {
			delete options[validOpts[j]];
		}
		for (let prop in options) {
			logger.error("Unexpected option in " + name + ": " + prop + ": " + options[prop]);
		}
	}

	if (args.length > count) {
		logger.error.apply(logger, ["Unexpected arguments in " + name + ": "].concat([].slice.call(args, count)));
	}
}

module.exports = argCheck;
