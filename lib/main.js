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

const controller = require('./DMAppController');

/**
 * DMAppClientLib exports.
 *
 * The client library is intended to be imported using a 'require' statement, which is then resolved by browserify.
 * The component and test libraries assume that this library is reachable using: `require('DMAppClientLib')`.
 *
 * @prop {AjaxPromise} AjaxPromise
 * @prop {DMAppComponentBehaviour} DMAppComponentBehaviour
 * @prop {DMAppAVPlayerComponentBehaviour} DMAppAVPlayerComponentBehaviour
 * @prop {DMAppController} DMAppController
 * @prop {Object<string, DMAppComponentDefinition>} dMAppComponentTypes Add DMApp component definitions, keyed by their typeName, here
 * @prop {DMAppLayout} DMAppLayout
 * @prop {DMAppLayoutIO} DMAppLayoutIO
 * @prop {DMAppLayoutRegionCtl} DMAppLayoutUtil.DMAppLayoutRegionCtl
 * @prop {ComponentContainer} DMAppLayoutUtil.ComponentContainer
 * @prop {DMAppTimeline} DMAppTimeline
 * @prop {MediaSynchroniser} MediaSynchroniser
 * @prop {waitable} waitable
 * @prop {PromiseExecQueue} PromiseExecQueue
 * @prop {MediaElementClockSource} MediaElementClockSource
 * @prop {ClockArrayIntervalScheduler} ClockSchedulerUtil.ClockArrayIntervalScheduler
 * @prop {argCheck} argCheck
 * @prop {EnumUtil} EnumUtil
 * @prop {DMAppComponentWrapper} DMAppComponentWrapper
 * @prop {TimeoutHandler} TimeoutHandler
 * @prop {ExecValve} ExecValve
 * @prop {Logger} Logger
 * @prop {BlockableWrapper} Blockable.BlockableWrapper
 * @prop {Signal} Signal
 * @prop {retryPromise} RetryUtil.retryPromise
 * @prop {CustomElementUtil} CustomElementUtil
 * @prop {UpdateUtil} UpdateUtil
 * @prop {PromiseUtil} PromiseUtil
 * @prop {StateMapping} StateMapping
 * @prop {ResourceMgmtUtil} ResourceMgmtUtil
 * @prop {InputUtil} InputUtil
 * @prop {ClockSyncUtil} ClockSyncUtil
 * @prop {DeviceOrientationCtl} DeviceOrientationCtl
 * @prop {ClockMiscUtil} ClockMiscUtil
 * @prop {InputDocument} InputDocument
 * @prop {DebugMiscUtil} DebugMiscUtil
 * @prop {ErrorUtil} ErrorUtil
 * @prop {LocalSignalMap} LocalSignalMap
 * @prop {MiscUtil} MiscUtil
 * @prop {ModuleUtil} ModuleUtil
 * @prop {SANDPlayer} SANDPlayer
 * @prop {VersionUtil} VersionUtil
 * @prop {string} version Version string
 * @prop {VersionUtil.FeatureVersionSet} featureVersions Feature versions instance
 * @prop deps.promise require('promise'), see {@link Promise}
 * @prop deps.promise_rejection_tracking require('promise/lib/rejection-tracking')
 * @prop deps.jquery require('jquery')
 * @prop deps.EventEmitter require('events')
 * @prop deps.dvbcssClocks require('dvbcss-clocks'), see {@link Clock}
 * @prop deps.listenerTracker require('listener-tracker'), see {@link ListenerTracker}
 * @prop deps.debounce require('just-debounce')
 * @prop deps.inherits require('inherits')
 * @prop deps.socketIoClient require('socket.io-client')
 * @prop deps.onetime require('onetime')
 * @prop deps.nanoEqual require('nano-equal')
 * @prop deps.deepEql require('deep-eql')
 * @prop deps.syncProtocols require('dvbcss-protocols')
 * @prop deps.URI require('urijs')
 * @prop deps.sprintfJs require('sprintf-js')
 * @prop deps.SharedStateClient require('shared-state-client'), see {@link SharedState} {@link MappingService}
 * @prop deps.deepFreeze require('deep-freeze')
 * @exports DMAppClientLib
 */
module.exports = {
	AjaxPromise: require('./AjaxPromise'),
	DMAppComponentBehaviour: require('./DMAppComponentBehaviour'),
	DMAppAVPlayerComponentBehaviour: require('./DMAppAVPlayerComponentBehaviour'),
	DMAppController: controller,
	dMAppComponentTypes: controller.prototype.dMAppComponentTypes,
	DMAppLayout: require('./DMAppLayout'),
	DMAppLayoutIO: require('./DMAppLayoutIO'),
	DMAppLayoutUtil: require('./DMAppLayoutUtil'),
	DMAppTimeline: require('./DMAppTimeline'),
	MediaSynchroniser: require('./MediaSynchroniser'),
	waitable: require('./waitable'),
	PromiseExecQueue: require("./PromiseExecQueue"),
	MediaElementClockSource: require("./MediaElementClockSource"),
	ClockSchedulerUtil: require("./ClockSchedulerUtil"),
	argCheck: require("./argCheck"),
	EnumUtil: require("./EnumUtil"),
	DMAppComponentWrapper: require("./DMAppComponentWrapper"),
	TimeoutHandler: require("./TimeoutHandler"),
	ExecValve: require("./ExecValve"),
	Logger: require("./Logger"),
	Blockable: require("./Blockable"),
	Signal: require("./Signal"),
	RetryUtil: require("./RetryUtil"),
	CustomElementUtil: require("./CustomElementUtil"),
	UpdateUtil: require("./UpdateUtil"),
	PromiseUtil: require("./PromiseUtil"),
	StateMapping: require("./StateMapping"),
	ResourceMgmtUtil: require("./ResourceMgmtUtil"),
	InputUtil: require("./InputUtil"),
	ClockSyncUtil: require("./ClockSyncUtil"),
	DeviceOrientationCtl: require("./DeviceOrientationCtl"),
	ClockMiscUtil: require("./ClockMiscUtil"),
	InputDocument: require("./InputDocument"),
	DebugMiscUtil: require("./DebugMiscUtil"),
	ErrorUtil: require("./ErrorUtil"),
	LocalSignalMap: require("./LocalSignalMap"),
	RefCountedSignalMap: require("./RefCountedSignalMap"),
	MiscUtil: require("./MiscUtil"),
	ModuleUtil: require("./ModuleUtil"),
	SANDPlayer: require("./SANDPlayer"),
	VersionUtil: require("./VersionUtil"),
	version: require("__VERSION__"),
	featureVersions: require('./FeatureVersions'),
	SafeEventEmitter: require("./SafeEventEmitter"),
	deps: {
		promise: require('promise'),
		promise_rejection_tracking: require('promise/lib/rejection-tracking'),
		jquery: require('jquery'),
		EventEmitter: require('events'),
		dvbcssClocks: require('dvbcss-clocks/src/main'),
		listenerTracker: require('listener-tracker'),
		debounce: require('just-debounce'),
		inherits: require('inherits'),
		socketIoClient: require('socket.io-client'),
		onetime: require('onetime'),
		nanoEqual: require('nano-equal'),
		deepEql: require('deep-eql'),
		syncProtocols: require('dvbcss-protocols/src/main_browser'),
		URI: require('urijs'),
		sprintfJs: require('sprintf-js'),
		SharedStateClient: require('shared-state-client'),
		deepFreeze: require('deep-freeze'),
	},
};

/**
 * Listener tracker instance
 * @global
 * @typedef ListenerTracker
 * @see {@link https://www.npmjs.com/package/listener-tracker}
 * @see {@link module:DMAppClientLib} -> deps.listenerTracker
 */

/**
 * Promise instance
 * @global
 * @typedef Promise
 * @see {@link https://www.npmjs.com/package/promise}
 * @see {@link module:DMAppClientLib} -> deps.promise
 */

/**
 * Shared state client instance
 * @global
 * @typedef SharedState
 * @see {@link https://github.com/2-IMMERSE/shared-state-client/blob/master/js/sharedstate.js}
 * @see {@link module:DMAppClientLib} -> deps.SharedStateClient -> SharedState
 */
/**
 * Shared state mapping service client instance
 * @global
 * @typedef MappingService
 * @see {@link https://github.com/2-IMMERSE/shared-state-client/blob/master/js/mappingservice.js}
 * @see {@link module:DMAppClientLib} -> deps.SharedStateClient -> MappingService
 */
/**
 * DVB-CSS clock instance
 * @global
 * @typedef Clock
 * @see {@link https://github.com/bbc/dvbcss-clocks}
 * @see {@link module:DMAppClientLib} -> deps.dvbcssClocks
 */
