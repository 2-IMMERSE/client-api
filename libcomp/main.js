/************************************************************************/
/* FILE:                main.js                                         */
/* DESCRIPTION:         Main module export                              */
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
 * DMAppCompLib exports
 * @prop {DMAppComp} DMAppComp
 * @prop {DMAppCompDiscoveryFilter} DMAppCompDiscoveryFilter
 * @prop {string} version Version string
 * @prop {VersionUtil.FeatureVersionSet} featureVersions Feature versions instance
 * @prop deps.ReconnectingWebSocket require('reconnectingwebsocket')
 * @exports DMAppCompLib
 */
module.exports = {
	DMAppComp: require('./DMAppComp'),
	DMAppCompDiscoveryFilter: require('./DMAppCompDiscoveryFilter'),
	CiiSyncHandlerBase: require('./CiiSyncHandlerBase'),
	SyncProtocolsCiiSyncHandler: require('./SyncProtocolsCiiSyncHandler'),
	version: require("__VERSION__"),
	featureVersions: require("./FeatureVersions"),
	deps: {
		ReconnectingWebSocket: require("reconnectingwebsocket"),
	},
};
