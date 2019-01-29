/************************************************************************/
/* FILE:                VersionUtil.js                                  */
/* DESCRIPTION:         Utilities for version handling                  */
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
 * Utilities for version handling
 *
 * @namespace VersionUtil
 */

 /**
 * @classdesc
 *
 * Feature version set
 *
 * @memberof VersionUtil
 *
 * @constructor
 * @param {!Object.<string,number>} versions Key-value object of version feature strings to numbers
 */
function FeatureVersionSet(versions) {
	Object.defineProperties(this, {
		versions:             { value: Object.freeze($.extend(Object.create(null), versions)) },
	});
	Object.freeze(this);
}

/**
 * Get version of a named feature
 * @param {!string} feature Feature name
 * @returns {number} Version number, 0 if not present
 */
FeatureVersionSet.prototype.getFeatureVersion = function(feature) {
	return this.versions[feature] || 0;
};

/**
 * Test whether version of a named feature is present or optionally within a given range
 * @param {!string} feature Feature name
 * @param {number=} [min=0] Minimum feature version
 * @param {number=} [max=Infinity] Maximum feature version
 * @returns {number} Version number, 0 if not present
 */
FeatureVersionSet.prototype.hasFeatureVersion = function(feature, min, max) {
	const v = this.getFeatureVersion(feature);
	return (v >= (min != null ? min : 0)) && (v <= (max != null ? max : Infinity));
};

/**
 * Get immutable object of all feature versions
 * @returns {!Object.<string,number>} versions Key-value object of version feature strings to numbers
 */
FeatureVersionSet.prototype.getVersionObject = function() {
	return this.versions;
};

/**
 * Dump string describing all feature versions
 * @returns {string} dump
 */
FeatureVersionSet.prototype.dumpString = function() {
	let str = "";
	for (let prop in this.versions) {
		if (str.length) str += "\n";
		str += prop + ": " + (this.versions[prop] || 0);
	}
	return str;
};

module.exports = {
	FeatureVersionSet: FeatureVersionSet,
};
