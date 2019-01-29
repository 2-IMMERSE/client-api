/************************************************************************/
/* FILE:                DMAppAndroidCompDiscovery.js                    */
/* DESCRIPTION:         DMApp Android companion discovery lib           */
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
const TimeoutHandler = DMAppClientLib.TimeoutHandler;

const Promise = DMAppClientLib.deps.promise;
const inherits = DMAppClientLib.deps.inherits;
const $ = DMAppClientLib.deps.jquery;
const nanoEqual = DMAppClientLib.deps.nanoEqual;

/* globals hbbtv */

/**
 * @classdesc
 *
 * Discovery functionality for companion apps on Android devices.
 * Requires cordova plugin: cordova-plugin-hbbtv.
 * May be constructed before cordova and cordova plugins are initialised.
 *
 * @extends EventEmitter
 * @implements DiscoveryCtl
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {!DMAppComp} dMAppComp parent companion controller
 */
function DMAppAndroidCompDiscovery(dMAppController, dMAppComp) {
	const self = this;
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'dMAppComp',       { value: dMAppComp });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DMAppAndroidCompDiscovery") });
	Object.defineProperty(self, 'discoveredMap',   { value: new Map() });
	Object.defineProperty(self, 'listenerTracker', { value: new DMAppClientLib.deps.listenerTracker.createTracker() });


	this.logger.info("DMAppAndroidCompDiscovery version: " + require('__VERSION__'));

	const hbbtvPromise = new Promise(function(resolve, reject) {
		if (typeof hbbtv != "undefined") {
			resolve(hbbtv);
		} else {
			document.addEventListener('deviceready', function() {
				resolve(hbbtv);
			}, false);
		}
	});
	const hbbtvTermMgrPromise = hbbtvPromise.then(function(hbbtv) {
		return hbbtv.createTerminalManager();
	});

	Object.defineProperty(self, 'hbbtvPromise',    { value: hbbtvPromise });
	Object.defineProperty(self, 'hbbtvTMPromise',  { value: hbbtvTermMgrPromise });

	hbbtvTermMgrPromise.then(function(hbbtvTermMgr) {
		if (hbbtvTermMgr.discoverTerminalAtDeviceDescriptionUrl) {
			Object.defineProperty(self, 'manualDevices',   { value: new Set() });
			self.emit('_debugInfoChange');
		}
		hbbtvTermMgr.setDiscoverTerminalImmediateCallback(function(terminal) {
			self._handleTerminal(terminal);
		});
	});

	self._discoveryEnabled = false;
	self._discoveryInProgress = false;

	self.listenerTracker.subscribeTo(dMAppComp).on("join", function() {
		if (self._discoveryStopOnJoin) {
			self._discoveryEnabled = false;
		}
	});

	dMAppComp._addDiscoveryInstance(self);
}

inherits(DMAppAndroidCompDiscovery, DMAppClientLib.SafeEventEmitter);

/**
 * New device event.
 *
 * @event DMAppAndroidCompDiscovery#newDevice
 * @type {discoveredDevice}
 */
/**
 * Updated device event.
 *
 * @event DMAppAndroidCompDiscovery#updateDevice
 * @type {discoveredDevice}
 */
/**
 * Removed device ID event.
 *
 * @event DMAppAndroidCompDiscovery#removeDevice
 * @type {discoveredDeviceId}
 */

DMAppAndroidCompDiscovery.prototype._remapDevice = function(device) {
	const auxData = {};
	const auxre = /^X_2ImmerseAux_(.+)$/;
	for (let prop in device.additionalData) {
		const res = prop.match(auxre);
		if (res) {
			try {
				auxData[res[1]] = JSON.parse(device.additionalData[prop]);
			} catch(e) {
				this.logger.warn("Failed to parse JSON in auxData", e);
			}
		}
	}
	return {
		ciiSyncUrl: device.X_HbbTV_InterDevSyncURL,
		contextId: device.additionalData.X_2Immerse_ContextId || null,
		deviceId: device.additionalData.X_2Immerse_DeviceId || null,
		interContextId: device.additionalData.X_2Immerse_InterContextId || null,
		sessionId: device.additionalData.X_2Immerse_SessionId || null,
		instanceId: device.additionalData.X_2Immerse_InstanceId || null,
		app2appUrl: device.X_HbbTV_App2AppURL,
		applicationUrl: device.terminal.applicationUrl,
		extraData: device.terminal,
		additionalData: device.additionalData,
		friendlyName: device.terminal.friendlyName,
		UDN: device.terminal.udn,
		id: device.terminal.launchUrl,
		auxData: auxData,
	};
};

/**
 * Join the first available device which is or has been discovered
 */
DMAppAndroidCompDiscovery.prototype.joinFirst = function() {
	const self = this;
	if (self.discoveredMap.size > 0) {
		const first = self.discoveredMap.values().next().value;
		self.dMAppComp.joinDevice(first);
	} else {
		const devLogCtl = self.dMAppController.makeDevLoggingCtl();
		const timeout = new TimeoutHandler(function() {
			self.logger.warn("Discovered 0 2-Immerse TVs after 10s, continuing discovery.");
			if (!self._haveLoggedDevLogFoundNoTerminals) {
				self._haveLoggedDevLogFoundNoTerminals = true;
				self.dMAppController.devDialogLogger.warn("DIAL/HbbTV discovery: discovered 0 suitable 2-Immerse TVs after 10s. Check network environment and presence of 2-Immerse TV device. " +
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

DMAppAndroidCompDiscovery.prototype._handleTerminal = function(terminal) {
	if (terminal.terminal.manufacturer !== "2-Immerse" || terminal.terminal.modelName !== "2-Immerse TV Emulator") return false;
	const device = this._remapDevice(terminal);
	const prevDevice = this.discoveredMap.get(device.id);
	if (!prevDevice) {
		this.logger.debug("New device: ", device);
		this.discoveredMap.set(device.id, device);
		this.emit("newDevice", device);
	} else if (!nanoEqual(prevDevice, device)) {
		for (let prop in prevDevice) delete prevDevice[prop];
		$.extend(prevDevice, device);
		this.logger.debug("Updated device: ", prevDevice);
		this.emit("updateDevice", prevDevice);
	}
	return true;
};

/**
 * Discover TV emulator devices
 *
 * @param {?Object} options optional options object
 * @param {boolean} [options.stopOnJoin=true] stop discovery when a device join occurs
 */
DMAppAndroidCompDiscovery.prototype.discover = function(options) {
	const params = $.extend({
		stopOnJoin: true,
	}, options || {});
	this._discoveryEnabled = true;
	this._discoveryStopOnJoin = params.stopOnJoin;

	this._discoverCtl();
	this.emit('_debugInfoChange');
};

/**
 * Stop any ongoing discovery
 *
 * Discovery events/changes may still be emitted after this is called.
 */
DMAppAndroidCompDiscovery.prototype.stopDiscovery = function() {
	this._discoveryEnabled = false;
	this.emit('_debugInfoChange');
};

DMAppAndroidCompDiscovery.prototype._discoverCtl = function() {
	const self = this;

	if (self._discoveryInProgress) return;
	if (!self._discoveryEnabled) return;

	self._discoveryInProgress = true;
	self.hbbtvTMPromise.then(function(hbbtvTermMgr) {
		hbbtvTermMgr.discoverTerminals(function(terminals) {
			self.logger.debug("Discovery done: " + terminals.length + " terminals");
			self._discoveryInProgress = false;
			let okCount = 0;
			const whitelist = new Set();
			for (let i = 0; i < terminals.length; i++) {
				if (self._handleTerminal(terminals[i])) {
					okCount++;
					whitelist.add(terminals[i].terminal.launchUrl);
				}
			}
			for (const key of self.discoveredMap.keys()) {
				if (!whitelist.has(key)) {
					self.discoveredMap.delete(key);
					self.logger.debug("Remove device: ", key);
					self.emit("removeDevice", key);
				}
			}

			window.setTimeout(function() {
				self._discoverCtl();
			}, 500);
		});
		if (self.manualDevices) {
			for (let addr of self.manualDevices) {
				hbbtvTermMgr.discoverTerminalAtDeviceDescriptionUrl(addr);
			}
		}
	});
};

DMAppAndroidCompDiscovery.prototype._manualDiscover = function(deviceDescriptionUrl) {
	const self = this;
	if (!self.manualDevices) return;

	self.manualDevices.add(deviceDescriptionUrl);

	if (self._discoveryEnabled) {
		self.hbbtvTMPromise.then(function(hbbtvTermMgr) {
			hbbtvTermMgr.discoverTerminalAtDeviceDescriptionUrl(deviceDescriptionUrl);
		});
	}
	self.emit('_debugInfoChange');
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This method SHOULD be called when the discovery instance is no-longer required.
 */
DMAppAndroidCompDiscovery.prototype.destroy = function() {
	this.stopDiscovery();
	this.listenerTracker.removeAllListeners();
	this.dMAppComp._removeDiscoveryInstance(this);
	this.emit('destroy');
};

DMAppAndroidCompDiscovery.prototype.dumpDebugInfo = function(dumper) {
	const self = this;
	const cat = dumper.subcategory("DMAppAndroidCompDiscovery");
	cat.keyValue("Version", require('__VERSION__'));
	cat.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	cat.keyValue("Discovery enabled", !!this._discoveryEnabled);
	this.dMAppComp._dumpDiscoveredDeviceMap(this.discoveredMap, cat);
	if (self._discoveryEnabled && self.manualDevices) {
		cat.stringInput("Discover from IP using DIAL URL: http://???:7692/dial/ssdp/device-desc.xml", function(ip) {
			self._manualDiscover("http://" + ip + ":7692/dial/ssdp/device-desc.xml");
		}, null, "Discover");
		if (self.manualDevices.size) {
			const mcat = cat.subcategory("Manual discovery addresses");
			for (let addr of self.manualDevices) {
				mcat.value(addr);
			}
		}
	}
};

DMAppAndroidCompDiscovery.prototype.setupDumpDebugEvents = function(listenerTracker, func) {
	const tracker = listenerTracker.subscribeTo(this);
	tracker.on("newDevice", func);
	tracker.on("updateDevice", func);
	tracker.on("removeDevice", func);
	tracker.on("_debugInfoChange", func);
};

try {
	Object.freeze(DMAppAndroidCompDiscovery.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppAndroidCompDiscovery;
