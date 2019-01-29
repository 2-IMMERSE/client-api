/************************************************************************/
/* FILE:                DMAppIosCompDiscovery.js                        */
/* DESCRIPTION:         DMApp iOS companion discovery lib               */
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

/* globals DIALClient */

/**
 * @classdesc
 *
 * Discovery functionality for companion apps on iOS devices.
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
function DMAppIosCompDiscovery(dMAppController, dMAppComp) {
	const self = this;
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'dMAppComp',       { value: dMAppComp });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DMAppIosCompDiscovery") });
	Object.defineProperty(self, '_netLogger',      { value: self.logger.makeChildLogger("Network") });
	Object.defineProperty(self, 'discoveredMap',   { value: new Map() });
	Object.defineProperty(self, 'listenerTracker', { value: new DMAppClientLib.deps.listenerTracker.createTracker() });
	self._netLogger.setLevel("warn");

	this.logger.info("DMAppIosCompDiscovery version: " + require('__VERSION__'));

	const DIALClientPromise = new Promise(function(resolve, reject) {
		if (typeof DIALClient != "undefined") {
			resolve(DIALClient);
		} else {
			document.addEventListener('deviceready', function() {
				resolve(DIALClient);
			}, false);
		}
	});

	Object.defineProperty(self, 'DIALClientPromise', { value: DIALClientPromise });

	self._discoveryEnabled = false;

	self.listenerTracker.subscribeTo(dMAppComp).on("join", function() {
		if (self._discoveryStopOnJoin) {
			self.stopDiscovery();
		}
	});

	dMAppComp._addDiscoveryInstance(self);
}

inherits(DMAppIosCompDiscovery, DMAppClientLib.SafeEventEmitter);

/**
 * New device event.
 *
 * @event DMAppIosCompDiscovery#newDevice
 * @type {discoveredDevice}
 */
/**
 * Updated device event.
 *
 * @event DMAppIosCompDiscovery#updateDevice
 * @type {discoveredDevice}
 */
/**
 * Removed device ID event.
 *
 * @event DMAppIosCompDiscovery#removeDevice
 * @type {discoveredDeviceId}
 */

DMAppIosCompDiscovery.prototype._remapDeviceToId = function(device) {
	return device.terminal.DIALHost + "/" + (device.terminal.DIALUniqueServiceName || device.terminal.UDN);
};

DMAppIosCompDiscovery.prototype._parseDeviceXml = function(deviceObj, xmlStr) {
	const xmlParser = new DOMParser();
	const doc = xmlParser.parseFromString(xmlStr, "text/xml");
	let updated = false;
	const auxData = {};
	const additionalData = {};
	const additionalDataNodes = doc.getElementsByTagNameNS('urn:dial-multiscreen-org:schemas:dial', 'additionalData');
	if (additionalDataNodes.length == 1) {
		const nodes = additionalDataNodes[0].children;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			additionalData[node.localName] = node.textContent;
		}
	}

	const auxre = /^X_2ImmerseAux_(.+)$/;
	for (let prop in additionalData) {
		const res = prop.match(auxre);
		if (res) {
			auxData[res[1]] = additionalData[prop];
		}
	}
	const update = function(prop, value) {
		if (!nanoEqual(deviceObj[prop], value)) {
			deviceObj[prop] = value;
			updated = true;
		}
	};
	update('contextId', additionalData.X_2Immerse_ContextId || null);
	update('deviceId', additionalData.X_2Immerse_DeviceId || null);
	update('interContextId', additionalData.X_2Immerse_InterContextId || null);
	update('sessionId', additionalData.X_2Immerse_SessionId || null);
	update('instanceId', additionalData.X_2Immerse_InstanceId || null);
	update('additionalData', additionalData);
	update('auxData', auxData);
	deviceObj.extraData.xmlDoc = doc;
	deviceObj.extraData.xmlStr = xmlStr;
	return updated;
};

DMAppIosCompDiscovery.prototype._remapDevice = function(device) {
	const obj = {
		ciiSyncUrl: device.X_HbbTV_InterDevSyncURL,
		app2appUrl: device.X_HbbTV_App2AppURL,
		extraData: {
			terminal: device.terminal,
		},
		friendlyName: device.terminal.friendlyName,
		id: this._remapDeviceToId(device),
	};
	this._parseDeviceXml(obj, device.appXML);
	return obj;
};

/**
 * Join the first available device which is or has been discovered
 */
DMAppIosCompDiscovery.prototype.joinFirst = function() {
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

DMAppIosCompDiscovery.prototype._handleTerminal = function(terminal) {
	const self = this;
	if (terminal.terminal.manufacturer !== "2-Immerse" || terminal.terminal.modelName !== "2-Immerse TV Emulator") return false;
	const device = this._remapDevice(terminal);
	const prevDevice = this.discoveredMap.get(device.id);
	if (!prevDevice) {
		this.logger.debug("New device: ", device);
		this.discoveredMap.set(device.id, device);
		this.emit("newDevice", device);
		const timerId = window.setInterval(function() {
			if (!self._discoveryEnabled) return;

			const ap = self.dMAppController.ajaxPromiseNX({
				method: "GET",
				url: 'http://' + terminal.terminal.DIALHost + ':7692/dial/apps/HbbTV',
				dataType: "text",
			});
			ap.setTitle("Discovery update check");
			ap.setLogger(self._netLogger);
			ap.exec().then(function(info) {
				if (!self._discoveryEnabled) return;
				if (self._parseDeviceXml(device, info.data)) {
					self.logger.debug("Updated device (checked): ", device);
					self.emit("updateDevice", device);
				}
			}).catch(self.logger.deferredConcat('error', "Failed to updated discovered device info: "));
		}, 3000);
		Object.defineProperty(device, '_updateTimer', { configurable: true, value: timerId });
	} else if (!nanoEqual(prevDevice, device)) {
		for (let prop in prevDevice) delete prevDevice[prop];
		$.extend(prevDevice, device);
		this.logger.debug("Updated device: ", prevDevice);
		this.emit("updateDevice", prevDevice);
	} else {
		this.logger.debug("Discovered unchanged device: ", prevDevice);
	}
	return true;
};

/**
 * Discover TV emulator devices
 *
 * @param {?Object} options optional options object
 * @param {boolean} [options.stopOnJoin=true] stop discovery when a device join occurs
 */
DMAppIosCompDiscovery.prototype.discover = function(options) {
	const self = this;
	const params = $.extend({
		stopOnJoin: true,
	}, options || {});
	self._discoveryStopOnJoin = params.stopOnJoin;

	if (self._discoveryEnabled) return;
	self._discoveryEnabled = true;

	self.DIALClientPromise.then(function(DIALClient) {
		self.logger.debug("About to start discovery");
		DIALClient.getDIALClient().startDiscovery(function(terminals) {
			self.logger.debug("Discovery done: " + terminals.length + " terminals");
			let okCount = 0;
			const whitelist = new Set();
			for (let i = 0; i < terminals.length; i++) {
				if (self._handleTerminal(terminals[i])) {
					okCount++;
					whitelist.add(self._remapDeviceToId(terminals[i]));
				}
			}
			for (const [key, device] of self.discoveredMap) {
				if (!whitelist.has(key)) {
					self.discoveredMap.delete(key);
					if (device._updateTimer) {
						window.clearInterval(device._updateTimer);
						delete device._updateTimer;
					}
					self.logger.debug("Remove device: ", key);
					self.emit("removeDevice", key);
				}
			}
			self.emit('_debugInfoChange');
		});
	}).catch(self.logger.deferredConcat('error', "Discovery failed: "));

	self.emit('_debugInfoChange');
};

/**
 * Stop any ongoing discovery
 *
 * Discovery events/changes may still be emitted after this is called.
 */
DMAppIosCompDiscovery.prototype.stopDiscovery = function() {
	if (!this._discoveryEnabled) return;
	this._discoveryEnabled = false;

	this.DIALClientPromise.then(function(DIALClient) {
		DIALClient.stopDiscovery();
	});
	this.emit('_debugInfoChange');
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This method SHOULD be called when the discovery instance is no-longer required.
 */
DMAppIosCompDiscovery.prototype.destroy = function() {
	this.stopDiscovery();
	this.listenerTracker.removeAllListeners();
	this.dMAppComp._removeDiscoveryInstance(this);
};

DMAppIosCompDiscovery.prototype.dumpDebugInfo = function(dumper) {
	const cat = dumper.subcategory("DMAppIosCompDiscovery");
	cat.keyValue("Version", require('__VERSION__'));
	cat.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	cat.keyValue("Discovery enabled", !!this._discoveryEnabled);
	this.dMAppComp._dumpDiscoveredDeviceMap(this.discoveredMap, cat);
};

DMAppIosCompDiscovery.prototype.setupDumpDebugEvents = function(listenerTracker, func) {
	const tracker = listenerTracker.subscribeTo(this);
	tracker.on("newDevice", func);
	tracker.on("updateDevice", func);
	tracker.on("removeDevice", func);
	tracker.on("_debugInfoChange", func);
};

try {
	Object.freeze(DMAppIosCompDiscovery.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppIosCompDiscovery;
