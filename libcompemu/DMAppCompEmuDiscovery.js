/************************************************************************/
/* FILE:                DMAppCompEmuDiscovery.js                        */
/* DESCRIPTION:         DMApp companion emulator controller             */
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
const DMAppCompLib = require('DMAppCompLib');

const ReconnectingWebSocket = DMAppCompLib.deps.ReconnectingWebSocket;
const inherits = DMAppClientLib.deps.inherits;
const TimeoutHandler = DMAppClientLib.TimeoutHandler;
const Signal = DMAppClientLib.Signal;

const $ = DMAppClientLib.deps.jquery;
const nanoEqual = DMAppClientLib.deps.nanoEqual;

const defaultServerUrl = "ws://127.0.0.1:7693";

/**
 * @classdesc
 *
 * Device discovery client functionality for emulated companion devices using the server-compemu external server
 *
 * @extends EventEmitter
 * @implements DiscoveryCtl
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {!DMAppComp} dMAppComp parent companion controller
 * @param {?Object} options optional options object
 * @param {string} [options.serverUrl=ws://127.0.0.1:7693] override compemu server URL
 */
function DMAppCompEmuDiscovery(dMAppController, dMAppComp, options) {
	const self = this;
	if (!options) options = {};
	Object.defineProperty(self, 'dMAppController', { value: dMAppController });
	Object.defineProperty(self, 'dMAppComp',       { value: dMAppComp });
	Object.defineProperty(self, 'logger',          { value: dMAppController.createNamedLogger("DMAppCompEmuDiscovery") });
	Object.defineProperty(self, 'serverUrl',       { value: options.serverUrl || defaultServerUrl });
	Object.defineProperty(self, 'discoveredMap',   { value: new Map() });
	Object.defineProperty(self, 'listenerTracker', { value: new DMAppClientLib.deps.listenerTracker.createTracker() });
	Object.defineProperty(self, 'wsCapabilities',  { value: new Signal.SettableSignal({}, { autoFreeze: true }) });

	Object.defineProperty(self, '_errorFlag',      { value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, dMAppController.errorSignals.localServices, DMAppClientLib.ErrorUtil.ErrorMode.DEV,
			"Error connecting/using companion emulator discovery websocket: " + self.serverUrl + ". Check that companion emulator services are operational.") });

	Object.defineProperty(self, 'wsErrorCounter',  { value: self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "Discovery websocket error(s)") });

	this.logger.info("DMAppCompEmuDiscovery version: " + require('__VERSION__'));

	const ws = new ReconnectingWebSocket(self.serverUrl + "/dial/discovery", [], {
		reconnectInterval: 500,
		reconnectDecay: 2,
		maxReconnectInterval: 30000,
	});
	Object.defineProperty(self, 'ws',              { value: ws });

	DMAppClientLib.argCheck(arguments, 3, self.logger, "DMAppTvEmuSync DMAppCompEmuDiscovery", options, ['serverUrl']);

	self.wsConnected = false;
	self.ws.addEventListener("open", function() {
		self.logger.info("Discovery websocket open");
		self.wsErrorCounter.flush();
		self.wsConnected = true;
		self._errorFlag.clear();
	});
	self.ws.addEventListener("close", function() {
		self.logger.info("Discovery websocket close");
		self.wsConnected = false;
		self.wsCapabilities.setValue({});
		//self._errorFlag.raise();
	});
	self.ws.addEventListener("error", function() {
		self.wsErrorCounter.event();
		self.wsConnected = false;
		self.wsCapabilities.setValue({});
		self._errorFlag.raise();
	});
	self.ws.addEventListener("message", function(event) {
		try {
			const msg = JSON.parse(event.data);
			if (msg.type === "newDevice" || msg.type === "updateDevice") {
				const device = self._remapDevice(msg.device);
				const prevDevice = self.discoveredMap.get(msg.device.id);
				if (!prevDevice) {
					self.logger.debug("New device: ", device);
					self.discoveredMap.set(msg.device.id, device);
					self.emit("newDevice", device);
				} else if (!nanoEqual(prevDevice, device)) {
					for (let prop in prevDevice) delete prevDevice[prop];
					$.extend(prevDevice, device);
					self.logger.debug("Updated device: ", prevDevice);
					self.emit("updateDevice", prevDevice);
				}
			} else if (msg.type === "removeDevice") {
				self.logger.debug("Remove device: ", msg.id);
				self.discoveredMap.delete(msg.id);
				self.emit("removeDevice", msg.id);
			} else if (msg.type === "capabilities") {
				self.wsCapabilities.setValue(msg.value || {});
			} else {
				self.logger.warn("Unexpected message from discovery websocket", msg);
			}

		} catch(e) {
			self.logger.error("Error in handling websocket message; ", e, event.data);
		}
	});
	self.listenerTracker.subscribeTo(window).on("beforeunload", function() {
		self.wsErrorCounter.flush();
	});

	dMAppComp._addDiscoveryInstance(self);
}

inherits(DMAppCompEmuDiscovery, DMAppClientLib.SafeEventEmitter);

/**
 * New device event.
 *
 * @event DMAppCompEmuDiscovery#newDevice
 * @type {discoveredDevice}
 */
/**
 * Updated device event.
 *
 * @event DMAppCompEmuDiscovery#updateDevice
 * @type {discoveredDevice}
 */
/**
 * Removed device ID event.
 *
 * @event DMAppCompEmuDiscovery#removeDevice
 * @type {discoveredDeviceId}
 */

DMAppCompEmuDiscovery.prototype._remapDevice = function(device) {
	const obj = $.extend({}, device);
	if (obj.auxData) {
		for (let k in obj.auxData) {
			try {
				obj.auxData[k] = JSON.parse(obj.auxData[k]);
			} catch(e) {
				this.logger.warn("Failed to parse JSON in auxData", e);
				delete obj.auxData[k];
			}
		}
	}
	return obj;
};

/**
 * Join the first available device which is or has been discovered
 */
DMAppCompEmuDiscovery.prototype.joinFirst = function() {
	const self = this;
	if (self.discoveredMap.size > 0) {
		const first = self.discoveredMap.values().next().value;
		self.dMAppComp.joinDevice(first);
	} else {
		const timeout = new TimeoutHandler(function() {
			self.logger.warn("Discovered 0 2-Immerse TVs after 10s, continuing discovery.");
			if (!self._haveLoggedDevLogFoundNoTerminals) {
				self._haveLoggedDevLogFoundNoTerminals = true;
				self.dMAppController.devDialogLogger.warn("DIAL/HbbTV discovery: discovered 0 suitable 2-Immerse TVs after 10s. Check network environment and presence of 2-Immerse TV device. This message will only be shown once. Discovery continues...");
			}
		}, 10000);
		self.listenerTracker.subscribeTo(self).once("newDevice", function(device) {
			timeout.cancel();
			self.dMAppComp.joinDevice(device);
		});
	}
};

/**
 * Destructor, the instance MAY NOT be used after calling this.
 * This method SHOULD be called when the discovery instance is no-longer required.
 */
DMAppCompEmuDiscovery.prototype.destroy = function() {
	this.emit('destroy');
	this.ws.close();
	this.wsErrorCounter.flush();
	this.listenerTracker.removeAllListeners();
	this.dMAppComp._removeDiscoveryInstance(this);
};

DMAppCompEmuDiscovery.prototype.dumpDebugInfo = function(dumper) {
	const self = this;
	const cat = dumper.subcategory("DMAppCompEmuDiscovery");
	cat.keyValue("Version", require('__VERSION__'));
	cat.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	cat.keyValue("Websocket connected", !!this.wsConnected);
	if (this._errorFlag.getValue()) cat.keyValue("Error", this._errorFlag.msg);
	this.dMAppComp._dumpDiscoveredDeviceMap(this.discoveredMap, cat);
	if (self.wsCapabilities.getValue().discoverFromUrl) {
		cat.stringInput("Discover from IP using DIAL URL: http://???:7692/dial/ssdp/device-desc.xml", function(ip) {
			self.ws.send(JSON.stringify({
				type: "discoverFromUrl",
				url: "http://" + ip + ":7692/dial/ssdp/device-desc.xml",
			}));
		}, null, "Discover");
	}
};

DMAppCompEmuDiscovery.prototype.setupDumpDebugEvents = function(listenerTracker, func) {
	const tracker = listenerTracker.subscribeTo(this);
	tracker.on("newDevice", func);
	tracker.on("updateDevice", func);
	tracker.on("removeDevice", func);
	listenerTracker.subscribeTo(this._errorFlag).on("toggle", func);
	listenerTracker.subscribeTo(this.wsCapabilities).on("change", func);
};

try {
	Object.freeze(DMAppCompEmuDiscovery.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppCompEmuDiscovery;
