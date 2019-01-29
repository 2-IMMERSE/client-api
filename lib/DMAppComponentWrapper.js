/************************************************************************/
/* FILE:                DMAppComponentWrapper.js                        */
/* DESCRIPTION:         Wrap a generic HTML element as a component      */
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

const DMAppComponentBehaviour = require('./DMAppComponentBehaviour');

/**
 * @classdesc
 *
 * Wrap a generic HTML element as a component
 *
 * @mixes DMAppComponentBehaviour
 *
 * @constructor
 * @param {Element} element HTML element to wrap
 * @param {DMAppController} dMAppController controller
 */
function DMAppComponentWrapper(element, dMAppController) {
	Object.defineProperties(this, {
		_element:           { value: element },
	});
	this.ready();
}

DMAppComponentWrapper.prototype = $.extend({}, DMAppComponentBehaviour);

DMAppComponentWrapper.prototype.getComponentElement = function() {
	return this._element;
};

DMAppComponentWrapper.prototype.dumpDebugInfo = function(dumper) {
	dumper.subcategory("DMAppComponentWrapper");
	DMAppComponentBehaviour.dumpDebugInfo.call(this, dumper);
};

try {
	Object.freeze(DMAppComponentWrapper.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppComponentWrapper;
