/*******************************************************************************
 *
 * Copyright (c) 2015 Louay Bassbouss, Fraunhofer FOKUS, All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3.0 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>.
 *
 * AUTHORS: Louay Bassbouss (louay.bassbouss@fokus.fraunhofer.de)
 *
 ******************************************************************************/

"use strict";

let ws = require("ws");
let util = require("util");
let events = require("events");

let HbbTVApp2AppServer = function(app, path) {
	let pendingLocalConnections = null;
	let pendingRemoteConnections = null;
	let handlePendingConnectionsChanged = function(channel) {
		let channelPendingLocalConnections = pendingLocalConnections[channel] || [];
		let channelPendingRemoteConnections = pendingRemoteConnections[channel] || [];
		while (channelPendingLocalConnections.length > 0 && channelPendingRemoteConnections.length > 0) {
			let localConnection = channelPendingLocalConnections.pop();
			let remoteConnection = channelPendingRemoteConnections.pop();
			localConnection.pair = remoteConnection;
			remoteConnection.pair = localConnection;
			localConnection.send("pairingcompleted");
			remoteConnection.send("pairingcompleted");
			localConnection.send(JSON.stringify({
				type: "remoteAddr",
				port: remoteConnection._socket.remotePort,
				address: remoteConnection._socket.remoteAddress,
			}));
		}
		if (channelPendingLocalConnections.length === 0) {
			delete pendingLocalConnections[channel];
		}
		if (channelPendingRemoteConnections.length === 0) {
			delete pendingRemoteConnections[channel];
		}
	};
	let handleConnectionClosed = function(connection) {
		if (connection.local) {
			let channelPendingLocalConnections = pendingLocalConnections[connection.channel] || [];
			let index = channelPendingLocalConnections.indexOf(connection);
			if (index >= 0) channelPendingLocalConnections.splice(index, 1);
			if (channelPendingLocalConnections.length === 0) {
				delete pendingLocalConnections[connection.channel];
			}
		} else if (connection.remote) {
			let channelPendingRemoteConnections = pendingRemoteConnections[connection.channel] || [];
			let index = channelPendingRemoteConnections.indexOf(connection);
			if (index >= 0) channelPendingRemoteConnections.splice(index, 1);
			if (channelPendingRemoteConnections.length === 0) {
				delete pendingRemoteConnections[connection.channel];
			}
		}
	};

	let handleConnectionReceived = function(connection, channel, local) {
		if (!channel) {
			connection.close();
			return;
		}
		connection.channel = channel;
		if (local) {
			connection.local = true;
			let channelPendingLocalConnections = pendingLocalConnections[channel] || (pendingLocalConnections[channel] = []);
			channelPendingLocalConnections.push(connection);
		} else {
			connection.remote = true;
			let channelPendingRemoteConnections = pendingRemoteConnections[channel] || (pendingRemoteConnections[channel] = []);
			channelPendingRemoteConnections.push(connection);
		}
		handlePendingConnectionsChanged(channel);
		connection.on("message", function(msg, flags) {
			let options = {};
			if (flags.binary) options.binary = true;
			if (flags.masked) options.masked = true;
			if (connection.pair && (connection.pair.readyState == ws.OPEN)) connection.pair.send(msg, options);
		});
		connection.on("close", function(code, reason) {
			if (connection.pair) {
				connection.pair.close();
				connection.pair = null;
			} else {
				handleConnectionClosed(connection);
			}
			connection = null;
		});
		connection.on("error", function(err) {
			console.error("Connection error on socket: " + channel + ", " + (local ? "local" : "remote") + ", " + err);
		});
	};

	pendingLocalConnections = [];
	pendingRemoteConnections = [];
	app.ws(path + '/local/:channel', function(connection, req) {
		console.log("Local: ", req.params.channel);
		handleConnectionReceived(connection, req.params.channel, true);
	});
	app.ws(path + '/remote/:channel', function(connection, req) {
		console.log("Remote: ", req.params.channel);
		handleConnectionReceived(connection, req.params.channel, false);
	});
};

util.inherits(HbbTVApp2AppServer, events.EventEmitter);

module.exports = HbbTVApp2AppServer;
