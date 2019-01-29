/************************************************************************/
/* FILE:                server-compemu.js                               */
/* DESCRIPTION:         Companion emulator DIAL client proxy server     */
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

const dial = require("peer-dial");
const express = require('express');
const ExpressWs = require('express-ws');
const gate = require('gate');
const nanoEqual = require('nano-equal');

const dialClient = new dial.Client();
const compSockets = new Set();
const hbbTVApps = new Map();

const port = 7693;
const debug = false;

let nextDeviceId = 1;

const app = express();
ExpressWs(app);

const g = gate.create();

function handleDiscoveryUpdate(isNew, deviceDescriptionUrl, ssdpHeaders) {
	dialClient.getDialDevice(deviceDescriptionUrl, function(dialDevice, err) {
		if (dialDevice) {
			if (dialDevice.manufacturer !== "2-Immerse" || dialDevice.modelName !== "2-Immerse TV Emulator") return;

			dialDevice.getAppInfo("HbbTV", function(appInfo, err) {
				if (appInfo) {
					if (debug) console.log((isNew ? "New" : "Updated") + " DIAL device ", deviceDescriptionUrl, ": ", appInfo);
					handleHbbTVApp(deviceDescriptionUrl, dialDevice, appInfo);
				} else if (err) {
					console.error("Error on get HbbTV App Info or HbbTV App is not available on", deviceDescriptionUrl, err);
				}
			});
		} else if(err) {
			console.error("Error on get DIAL device description from ", deviceDescriptionUrl, err);
		}
	});
}

dialClient.on("ready",function() {
	console.log("DIAL client ready");
	const l = g.latch();
	dialClient.once("stop", function() {
		console.log("DIAL client stopped");
		l();
	});
});
dialClient.on("found", handleDiscoveryUpdate.bind(null, true));
dialClient.on("update", handleDiscoveryUpdate.bind(null, false));
dialClient.on("disappear", function(deviceDescriptionUrl) {
	removeHbbTVApp(deviceDescriptionUrl);
	if (debug) console.log("DIAL device ", deviceDescriptionUrl," disappeared");
});
dialClient.start();

app.ws('/dial/discovery', function(connection, req) {
	compSockets.add(connection);
	connection.on("close", function() {
		compSockets.delete(connection);
	});
	connection.on("error", function(err) {
		console.error("/dial/discovery websocket error: ", err);
		compSockets.delete(connection);
	});
	connection.on("message", function(msg) {
		console.log("message from client: ", msg);
		try {
			const json = JSON.parse(msg);
			if (json.type === "discoverFromUrl") {
				handleDiscoveryUpdate(true, json.url, null);
			} else {
				console.warn("Unexpected client message type: " + json.type);
				return;
			}
		} catch (e) {
			console.error("Failed to handle incoming client message: ", e);
		}
	});
	// update app info
	connection.send(JSON.stringify({
		type: "capabilities",
		value: {
			discoverFromUrl: true,
		},
	}));
	for (let hbbTVApp of hbbTVApps.values()) {
		hbbTVApp.dialDevice.getAppInfo("HbbTV", function(appInfo, err) {
			if (appInfo) {
				updateHbbTVAppInfo(hbbTVApp, false, hbbTVApp.dialDevice, appInfo, connection);
			}
			try {
				connection.send(JSON.stringify({
					type: "newDevice",
					device: hbbTVApp,
				}));
			} catch (e) {
				console.error("/dial/discovery on join app send failed: ", e);
			}
		});
	}
});

app.listen(port, function() {
	console.log("Companion Emulator Server is running on port " + port);
});

process.on('SIGINT', tidyUp);
process.on('SIGHUP', tidyUp);
process.on('SIGTERM', tidyUp);

function tidyUp() {
	console.log("Tidying up...");
	dialClient.stop();
	g.await(function() {
		process.exit(0);
	});
	setTimeout(function() {
		console.error("Timed out");
		process.exit(1);
	}, 3000);
}


function handleHbbTVApp(deviceDescriptionUrl, dialDevice, appInfo) {
	let info = hbbTVApps.get(deviceDescriptionUrl);
	const isNew = !info;
	if (!info) {
		info = {
			id: nextDeviceId,
			auxData: {},
		};
		nextDeviceId++;
		hbbTVApps.set(deviceDescriptionUrl, info);
	}
	updateHbbTVAppInfo(info, isNew, dialDevice, appInfo, null);
}

function updateHbbTVAppInfo(info, isNew, dialDevice, appInfo, socketExclude) {
	const anyChange = fillHbbTVAppInfo(info, dialDevice, appInfo);
	const msg = JSON.stringify({
		type: isNew ? "newDevice" : "updateDevice",
		device: info,
	});
	if (!anyChange && !isNew) return;
	for (let sock of compSockets) {
		if (sock !== socketExclude) sock.send(msg);
	}
}

function fillHbbTVAppInfo(info, dialDevice, appInfo) {
	let anyChange = false;
	Object.defineProperty(info, 'dialDevice', { value: dialDevice, configurable: true }); // non-enumerable

	if (dialDevice.friendlyName !== info.friendlyName) {
		info.friendlyName = dialDevice.friendlyName;
		anyChange = true;
	}
	if (dialDevice.UDN !== info.UDN) {
		info.UDN = dialDevice.UDN;
		anyChange = true;
	}
	if (dialDevice.applicationUrl !== info.applicationUrl) {
		info.applicationUrl = dialDevice.applicationUrl;
		anyChange = true;
	}
	if(appInfo.state !== info.state) {
		info.state = appInfo.state;
		anyChange = true;
	}
	if (appInfo.additionalData) {
		const vars = {
			'X_HbbTV_App2AppURL': 'app2appUrl',
			'X_HbbTV_InterDevSyncURL': 'ciiSyncUrl',
			'X_2Immerse_ContextId': 'contextId',
			'X_2Immerse_DeviceId': 'deviceId',
			'X_2Immerse_InterContextId': 'interContextId',
			'X_2Immerse_SessionId': 'sessionId',
			'X_2Immerse_InstanceId': 'instanceId',
		};
		for (let prop in vars) {
			let value = appInfo.additionalData[prop];
			if (value === '') value = null;
			if (info[vars[prop]] !== value) {
				anyChange = true;
				info[vars[prop]] = value;
			}
		}
		const oldAuxData = info.auxData;
		info.auxData = {};
		const auxre = /^X_2ImmerseAux_(.+)$/;
		for (let prop in appInfo.additionalData) {
			const res = prop.match(auxre);
			if (res) {
				info.auxData[res[1]] = appInfo.additionalData[prop];
			}
		}
		if (!nanoEqual(info.additionalData, appInfo.additionalData) || !nanoEqual(oldAuxData, info.auxData)) anyChange = true;
		info.additionalData = appInfo.additionalData;
	}
	return anyChange;
}

function removeHbbTVApp(deviceDescriptionUrl) {
	const hbbTVApp = hbbTVApps.get(deviceDescriptionUrl);
	if (hbbTVApp) {
		hbbTVApps.delete(deviceDescriptionUrl);
		for (let sock of compSockets) {
			sock.send(JSON.stringify({
				type: "removeDevice",
				id: hbbTVApp.id,
			}));
		}
	}
}
