/************************************************************************/
/* FILE:                InputUtil.js                                    */
/* DESCRIPTION:         Input utilities                                 */
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
 * Utilities for input handling, parsing, etc.
 *
 * @namespace InputUtil
 */

/**
 * Function to parse a string into a boolean, with a default value
 *
 * @memberof InputUtil
 *
 * @param {?string} value String input
 * @param {?boolean} def Default value
 * @param {?boolean} permissive Don't throw if value is non-empty but not parseable
 * @returns {boolean}
 */
function parseBool(value, def, permissive) {
	if (value === "y" || value === "yes" || value === "t" || value === "true" || value === "on") return true;
	if (value === "n" || value === "no" || value === "f" || value === "false" || value === "off") return false;
	if (!permissive && value != null && value !== "") throw new Error("Cannot parse string: '" + value + "' as boolean");
	return def;
}

/**
 * Function to parse a time value (string or number) into a number, with a default value
 *
 * @memberof InputUtil
 *
 * @param {?(string|number)} value String input
 * @param {?boolean} def Default value
 * @param {?boolean} permissive Don't throw if value is non-empty but not parseable
 * @returns {number}
 */
function parseTime(value, def, permissive) {
	if (typeof value === "number") return value;
	if (value != null) {
		if (typeof value === "string") {
			const match = value.match(/^(-?)(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d*)?)$/);
			if (match) {
				let num = Number(match[4]);
				if (match[3]) num += 60 * Number(match[3]);
				if (match[2]) num += 3600 * Number(match[2]);
				if (match[1]) num = -num;
				return num;
			}
		}
		const num = Number(value);
		if (!Number.isNaN(num)) return num;
	}

	if (!permissive && value != null && value !== "") throw new Error("Cannot parse string: '" + value + "' as a time value");
	return def;
}

/**
 * Function to check if a string is in the list of permitted values
 *
 * @memberof InputUtil
 *
 * @param {?string} value String input
 * @param {!string[]} list List of permitted values
 * @param {?boolean} permissive Don't throw if value is empty/null
 * @returns {?string} Input value
 */
function checkStringInList(value, list, permissive) {
	if (value == null || value === '') {
		if (permissive) return value;
		throw new Error("checkStringInList: input unexpectedly null/empty");
	}
	for (let i = 0; i < list.length; i++) {
		if (value === list[i]) return value;
	}
	throw new Error("checkStringInList: input: '" + value + "' unexpectedly not in permitted list");
}

module.exports = {
	parseBool: parseBool,
	parseTime: parseTime,
	checkStringInList: checkStringInList,
};
