/************************************************************************/
/* FILE:                DeviceOrientationCtl.js                         */
/* DESCRIPTION:         Device orientation controller                   */
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
 * @classdesc
 *
 * Sets {@link DMAppLayout#orientationController} and emits orientation change events via {@link DMAppLayout#notifyOrientationChanged}
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 */
function DeviceOrientationCtl(dMAppController) {
	const self = this;
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DeviceOrientationCtl") });

	self._orientationEvtHandle = function() {
		dMAppController.layout.io.notifyOrientationChanged(self.getOrientation());
	};
	window.addEventListener("orientationchange", self._orientationEvtHandle);

	Object.defineProperty(dMAppController.layout, 'orientationController', {
		confgurable: true,
		value: {
			getOrientation: function() /* -> orientation string */ {
				return self.getOrientation();
			},

			getAvailableOrientations: function() /* -> array of orientation strings */ {
				return ["portrait", "landscape"];
			},
		}
	});
}

/**
 * Get current orientation
 * @returns {string}
 */
DeviceOrientationCtl.prototype.getOrientation = function() {
	try {
		if (window.matchMedia("(orientation: portrait)").matches) return "portrait";
		if (window.matchMedia("(orientation: landscape)").matches) return "landscape";
	} catch (e) {
		/* swallow */
	}
	/* When tested, screen.orientation seemed to be an object instead of a string */
	// return /^\w+/.exec(screen.orientation) || "portrait"
	return screen.height >= screen.width ? "portrait" : "landscape";
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 */
DeviceOrientationCtl.prototype.destroy = function() {
	delete this.dMAppController.layout.orientationController;
	window.removeEventListener("orientationchange", this._orientationEvtHandle);
};

try {
	Object.freeze(DeviceOrientationCtl.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DeviceOrientationCtl;
