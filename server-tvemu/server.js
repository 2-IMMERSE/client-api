/************************************************************************/
/* FILE:                server.js                                       */
/* DESCRIPTION:         TV emulator DIAL and app2app server             */
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
const program = require('commander');
const HbbTVApp2AppServer = require('./hbbtv-app2app-server');
const ExpressWs = require('express-ws');
const gate = require('gate');
const bodyParser = require('body-parser');
const childProcess = require('child_process');

const app2appPath = "/app2app";

const childProcesses = [];

let port = 7692;

program
	.option('-p, --port <port>', 'Set listener port', parseInt)
	.option('-n, --hostname <domain>', 'Set own hostname')
	.option('-c, --cii-url <url>', 'Set CII sync server URL')
	.option('-C, --cii-port <port>', 'Set CII sync server port', parseInt)
	.option('-u, --uuid <uuid>', 'Universal unique device identifier')
	.option('-f, --friendly-name <friendlyname>', 'Universal unique device identifier')
	.option('-s, --stop-script <scriptfile>', 'Filename of script to run to stop TV application')
	.option('-l, --launch-script <scriptfile>', 'Filename of script to run to launch a TV application')
	.parse(process.argv);

if (program.port) port = program.port;

const app = express();
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

ExpressWs(app);

const apps = {
	HbbTV: {
		disabled: false,
		name: "HbbTV",
		state: "stopped", //"running",
		allowStop: true, //false,
		additionalData: {
			"hbbtv:X_HbbTV_App2AppURL":"",
			"hbbtv:X_HbbTV_InterDevSyncURL": "",
			"hbbtv:X_HbbTV_UserAgent": "2-Immerse TV Emulator",
		},
		namespaces: {
			"hbbtv": "urn:hbbtv:HbbTVCompanionScreen:2014",
			"im2": "urn:2-Immerse:2016",
			"im2aux": "urn:2-Immerse:2016:aux",
		},
	},
};
const hbbTVParams = apps.HbbTV.additionalData;

function resetHbbTVParams() {
	hbbTVParams["im2:X_2Immerse_ContextId"] = '';
	hbbTVParams["im2:X_2Immerse_DeviceId"] = '';
	hbbTVParams["im2:X_2Immerse_InterContextId"] = '';
	hbbTVParams["im2:X_2Immerse_SessionId"] = '';
	hbbTVParams["im2:X_2Immerse_InstanceId"] = '';
	for (let prop in hbbTVParams) {
		if (prop.startsWith("im2aux:")) delete hbbTVParams[prop];
	}
}
resetHbbTVParams();



const g = gate.create();

const prefix = "/dial";

const dialOptions = {
	expressApp: app,
	port: port,
	prefix: prefix,
	corsAllowOrigins: "*",
	manufacturer: "2-Immerse",
	modelName: "2-Immerse TV Emulator",
	delegate: {
		getApp: function(appName) {
			const app = apps[appName];
			if (app && !app.disabled) {
				if (appName == "HbbTV") {

					// Distinguish between a post and a get, based on 'this' parameter bound in the call to getApp
					// A POST means that the TV application wants to store data to be advertised
					// A GET means a DIAL client has requested information about the application running on the TV
					if(("method" in this) && this.method === "POST") {
						// Store additionalData POSTed to the DIAL server from the running TV application
						// This requires body-parse middleware to be installed for x-www-form-urlencoded requests
						app.additionalData["im2:X_2Immerse_LaunchData"] = this.body.launchData;
					}

					const hostname = program.hostname || this.hostname;
					app.additionalData["hbbtv:X_HbbTV_App2AppURL"] = "ws://" + hostname + ":" + port + app2appPath + "/remote/";
					if (program.ciiUrl) {
						app.additionalData["hbbtv:X_HbbTV_InterDevSyncURL"] = String(program.ciiUrl);
					} else if (program.ciiPort) {
						app.additionalData["hbbtv:X_HbbTV_InterDevSyncURL"] = "ws://" + hostname + ":" + program.ciiPort + "/cii/";
					}
				}
				return app;
			}
			return null;
		},
		launchApp: function(appName, launchData, callback){
			console.log("Got request to launch", appName," with launch data: ", launchData);
			const app = apps[appName];
			if (app) {
				app.pid = "run";
				app.state = "starting";
				if (program.launchScript) {
					// Pipe launchData to launch script
					const hostname = (program.hostname || this.hostname || this.ip);
					const additionalDataUrl = "http://" + hostname + ":" + port + prefix + "/apps/HbbTV/dial_data";
  					const proc = spawn(program.launchScript, [additionalDataUrl], { stdio: ['pipe', process.stdout, process.stderr] });
					proc.stdin.write(encodeURIComponent(launchData));
					proc.stdin.end();
					app.state = "running";
				}
			}
			callback(app.pid);
		},
		stopApp: function(appName, pid, callback){
			console.log("Got request to stop", appName," with pid: ", pid);
			const app = apps[appName];
			if (app && app.pid == pid) {
				app.pid = null;
				app.state = "stopped";
				if (program.stopScript) {
					spawn(program.stopScript, {}, { stdio: [process.stdin, process.stdout, process.stderr] });
				}
				callback(true);
			} else {
				callback(false);
			}
		}
	},
};

if(program.uuid) {
	dialOptions.uuid = program.uuid;
}
if(program.friendlyName) {
	dialOptions.friendlyName = program.friendlyName;
}

const dialServer = new dial.Server(dialOptions);
dialServer.on("ready", function() {
	console.log("DIAL server ready");
	const l = g.latch();
	dialServer.once("stop", function() {
		console.log("DIAL server stopped");
		l();
	});
});

new HbbTVApp2AppServer(app, "/app2app").on("error", function (err) {
	console.error("HbbTVApp2AppServer Error", err);
});

app.ws('/control', function(connection, req) {
	console.log("control connection");
	connection.on("message", function(msg) {
		console.log("control message", msg);
		try {
			const json = JSON.parse(msg);
			if (json.type === "device") {
				hbbTVParams["im2:X_2Immerse_DeviceId"] = json.value != null ? json.value : '';
			} else if (json.type === "context") {
				hbbTVParams["im2:X_2Immerse_ContextId"] = json.value != null ? json.value : '';
			} else if (json.type === "interContext") {
				hbbTVParams["im2:X_2Immerse_InterContextId"] = json.value != null ? json.value : '';
			} else if (json.type === "session") {
				hbbTVParams["im2:X_2Immerse_SessionId"] = json.value != null ? json.value : '';
			} else if (json.type === "instance") {
				hbbTVParams["im2:X_2Immerse_InstanceId"] = json.value != null ? json.value : '';
			} else if (json.type === "setAuxData") {
				if (json.value != null) {
					hbbTVParams["im2aux:X_2ImmerseAux_" + json.key] = json.value;
				} else {
					delete hbbTVParams["im2aux:X_2ImmerseAux_" + json.key];
				}
			} else {
				console.warn("Unexpected control message type: " + json.type);
				return;
			}
			if (dialServer.ready) dialServer.update();
		} catch (e) {
			console.error("Failed to handle incoming control message: ", e);
		}
	});
	connection.on("close", function(code, reason) {
		resetHbbTVParams();
		if (dialServer.ready) dialServer.update();
	});
	connection.on("error", function (err) {
		resetHbbTVParams();
		console.error("Control websocket error: ", err);
		if (dialServer.ready) dialServer.update();
	});
});

app.listen(port, function() {
	dialServer.start();
	console.log("TV Emulator Server is running on port " + port);
});

process.on('SIGINT', tidyUp);
process.on('SIGHUP', tidyUp);
process.on('SIGTERM', tidyUp);
process.on('exit', exitChildProcesses);

function spawn(proc, args, opts) {
	const result = childProcess.spawn(proc, args, opts);
	childProcesses.push(result);
	return result;
}

function exitChildProcesses() {
	console.log('killing', childProcesses.length, 'child processes');
	childProcesses.forEach(function(child) {
		child.kill();
	});
	childProcesses.length = 0;
}

function tidyUp() {
	console.log("Tidying up...");
	dialServer.stop();
	g.await(function() {
		exitChildProcesses();
		process.exit(0);
	});
	setTimeout(function() {
		console.error("Timed out");
		exitChildProcesses();
		process.exit(1);
	}, 3000);
}
