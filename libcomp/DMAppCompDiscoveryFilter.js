/************************************************************************/
/* FILE:                DMAppCompDiscoveryFilter.js                     */
/* DESCRIPTION:         DMApp companion lib discovery filter            */
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

const DMAppClientLib = require('DMAppClientLib');

const inherits = DMAppClientLib.deps.inherits;
const argCheck = DMAppClientLib.argCheck;


/**
 * Discovery device filter callback
 *
 * @callback DMAppCompDiscoveryFilter~DeviceFilterFunction
 * @param {!discoveredDevice} device Device to filter
 * @returns {boolean} True to include device, false to exclude it
 */

/**
 * @classdesc
 *
 * Utility class to filter a set of discovered devices
 *
 * @extends EventEmitter
 * @implements DiscoveryCtl
 *
 * @constructor
 * @param {!DiscoveryCtl} discoverySource parent discovery source
 * @param {?Object} options optional options object
 * @param {boolean=} [options.needDeviceId] optional whether to only include devices with a device ID
 * @param {boolean=} [options.needContextId] optional whether to only include devices with a context ID
 * @param {boolean=} [options.needInterContextId] optional whether to only include devices with a inter-context ID
 * @param {boolean=} [options.needSessionId] optional whether to only include devices with a session ID
 * @param {boolean=} [options.deduplicateInstances] optional whether to de-duplicate devices with the same instance ID
 * @param {Object=} [options.requiredAuxData] optional object specifying the required values of auxiliary data key(s)
 * @param {DMAppCompDiscoveryFilter~DeviceFilterFunction=} [options.filterFunction] optional filter function to call to determine whether to include a device
 * @param {boolean=} [options.autoStart=true] optional whether to automatically call start(), set to false to set up any event handlers, etc. before calling start()
 */
function DMAppCompDiscoveryFilter(discoverySource, options) {
	Object.defineProperties(this, {
		discoverySource:     { value: discoverySource },
		logger:              { value: discoverySource.logger.makeChildLogger("DMAppCompDiscoveryFilter") },
		dMAppController:     { value: discoverySource.dMAppController },
		dMAppComp:           { value: discoverySource.dMAppComp },
		discoveredMap:       { value: new Map(), writable: true },
		listenerTracker:     { value: new DMAppClientLib.deps.listenerTracker.createTracker() },
		needDeviceId:        { value: !!(options && options.needDeviceId) },
		needContextId:       { value: !!(options && options.needContextId) },
		needInterContextId:  { value: !!(options && options.needInterContextId) },
		needSessionId:       { value: !!(options && options.needSessionId) },
		deduplicateInstances:{ value: !!(options && options.deduplicateInstances) },
		requiredAuxData:     { value: options ? options.requiredAuxData : null },
		filterFunction:      { value: options ? options.filterFunction : null },
	});
	argCheck(arguments, 2, this.logger, "DMAppCompDiscoveryFilter constructor", options, ['needDeviceId', 'needContextId', 'needInterContextId', 'needSessionId', 'deduplicateInstances', 'requiredAuxData', 'filterFunction', 'autoStart']);

	this._devs = [];
	this._started = false;
	if (!options || options.autoStart !== false) this.start();
}

inherits(DMAppCompDiscoveryFilter, DMAppClientLib.SafeEventEmitter);

DMAppCompDiscoveryFilter.prototype._recalculateSet = function() {
	const self = this;
	const srcDevs = Array.from(self.discoverySource.discoveredMap.values());
	srcDevs.sort(function(a, b) {
		return a.id - b.id;
	});
	const instanceSet = self.deduplicateInstances ? new Set() : null;
	const devs = srcDevs.filter(function(device) {
		if (self.needDeviceId && !device.deviceId) return false;
		if (self.needContextId && !device.contextId) return false;
		if (self.needInterContextId && !device.interContextId) return false;
		if (self.needSessionId && !device.sessionId) return false;
		if (self.requiredAuxData) {
			if (!device.auxData) return false;
			for (let prop in self.requiredAuxData) {
				if (device.auxData[prop] !== self.requiredAuxData[prop]) return false;
			}
		}
		if (self.filterFunction && !self.filterFunction(device)) return false;
		if (self.deduplicateInstances && device.instanceId) {
			if (instanceSet.has(device.instanceId)) return false;
			instanceSet.add(device.instanceId);
		}
		return true;
	});
	const oldMap = self.discoveredMap;
	self.discoveredMap = new Map();
	for (let device of devs) {
		self.discoveredMap.set(device.id, device);
	}
	// iterate twice to make sure that discoveredMap is consistent when events are emitted
	for (let device of devs) {
		const existed = oldMap.delete(device.id);
		self.emit(existed ? "updateDevice" : "newDevice", device);
	}
	for (let key of oldMap.keys()) {
		self.emit("removeDevice", key);
	}
};

/** Start discovery filter if not already started */
DMAppCompDiscoveryFilter.prototype.start = function() {
	if (this._started) return;
	this._started = true;

	const recalc = this._recalculateSet.bind(this);
	const tracker = this.listenerTracker.subscribeTo(this.discoverySource);
	tracker.on('newDevice', recalc);
	tracker.on('updateDevice', recalc);
	tracker.on('removeDevice', recalc);
	this._recalculateSet();
};

/**
 * Join the first available device which is or has been discovered
 */
DMAppCompDiscoveryFilter.prototype.joinFirst = function() {
	const self = this;
	if (self.discoveredMap.size > 0) {
		const first = self.discoveredMap.values().next().value;
		self.dMAppComp.joinDevice(first);
	} else {
		const devLogCtl = self.dMAppController.makeDevLoggingCtl();
		const timeout = new DMAppClientLib.TimeoutHandler(function() {
			self.logger.warn("Discovered 0 2-Immerse TVs after 10s, continuing discovery.");
			if (!self._haveLoggedDevLogFoundNoTerminals) {
				self._haveLoggedDevLogFoundNoTerminals = true;
				self.dMAppController.devDialogLogger.warn("DIAL/HbbTV discovery: discovered 0 suitable 2-Immerse TVs which pass filter after 10s. Check network environment and presence of 2-Immerse TV device. " +
						"This message will only be shown once. Discovery continues...", devLogCtl);
			}
		}, 10000);
		self.listenerTracker.subscribeTo(self).once("newDevice", function(device) {
			timeout.cancel();
			devLogCtl.clear();
			self.dMAppComp.joinDevice(device);
		});
	}
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This method SHOULD be called when the discovery instance is no-longer required.
 */
DMAppCompDiscoveryFilter.prototype.destroy = function() {
	this.emit('destroy');
	this.discoveredMap.clear();
	this.listenerTracker.removeAllListeners();
};

module.exports = DMAppCompDiscoveryFilter;
