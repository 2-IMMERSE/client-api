/************************************************************************/
/* FILE:                DMAppController.js                              */
/* DESCRIPTION:         DMApp controller                                */
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

const inherits = require('inherits');
const $ = require("jquery");
const SharedStateClient = require('shared-state-client');
const URI = require('urijs');
const sprintf = require("sprintf-js").sprintf;
const onetime = require('onetime');
const socketIo = require('socket.io-client');
const nanoEqual = require("nano-equal");
const Promise = require("promise");
const exprParser = require('expr-eval').Parser;

const SafeEventEmitter = require('./SafeEventEmitter');
const waitable = require('./waitable');
const DMAppLayout = require('./DMAppLayout');
const DMAppTimeline = require('./DMAppTimeline');
const KeyStore = require('./KeyStore');
const App2AppMsgBusCtl = require('./App2AppMsgBusCtl');
const argCheck = require('./argCheck');
const AjaxPromise = require('./AjaxPromise');
const Logger = require('./Logger');
const RetryUtil = require('./RetryUtil');
const DebugMiscUtil = require('./DebugMiscUtil');
const Signal = require('./Signal');
const ResourceMgmtUtil = require('./ResourceMgmtUtil');
const ErrorUtil = require('./ErrorUtil');
const TimeoutHandler = require('./TimeoutHandler');
const DeviceOrientationCtl = require('./DeviceOrientationCtl');
const ClockMiscUtil = require('./ClockMiscUtil');
const LocalSignalMap = require('./LocalSignalMap');
const RefCountedSignalMap = require('./RefCountedSignalMap');
const MiscUtil = require('./MiscUtil');

let mostRecentController = null;
let singleControllerInstance = null;

/**
 * @classdesc
 *
 * Top-level controller class which is the "entry-point" for the client-lib.
 * Generally an application will construct exactly one instance of this class,
 * which persists for the lifetime of the application.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {Object=} options                   optional options object
 * @param {string=} options.setDeviceId       optional device ID to use, if this is set all other device ID options are ignored and local storage read/write of device IDs is disabled
 * @param {string=} options.deviceIdPrefix    optional prefix for new device IDs
 * @param {string=} options.deviceIdNamespace optional namespace for local storage of the device ID
 * @param {string=} options.deviceIdNamespaceGroup optional namespace group for local storage of the device ID
 * @param {(number|string)=} options.defaultLogLevel   optional default LogLevel logging level
 * @param {boolean=} options.concatLogArgs    optional whether to concat logging arguments before outputting (useful on Android, default on when Cordova present)
 * @param {boolean=} options.longFormConsoleLogging optional whether to use long-form console logging (default true)
 * @param {(number|string)=} options.networkLogLevel   optional log level for remote logging, null/undefined disables remote logging (this is the default). Remotely uploaded logs are a subset of the overall set of logs, as controlled by options.defaultLogLevel.
 * @param {string=} options.networkLogSourcePostfix optional postfix to append to the source field in network logs
 * @param {boolean=} options.makeNewDeviceId  optional whether to always generate a new device ID instead of using a previously stored one
 * @param {boolean=} options.communalDevice   optional is this a communal device, to report in Layout caps
 * @param {number=} options.concurrentVideo   optional number of concurrent videos which can be played, to report in Layout caps
 * @param {string=} options.deviceType        optional device type, to report in Layout caps
 * @param {boolean=} options.touchInteraction optional override whether to report touch interaction capability, to report in Layout caps
 * @param {number=} options.displayWidth      optional override reported device width, to report in Layout caps
 * @param {number=} options.displayHeight     optional override reported device height, to report in Layout caps
 * @param {number=} options.displayResolution optional override reported device resolution (nominal CSS pixels per inch), to report in Layout caps
 * @param {boolean=} options.advDebugMode     override whether to enable adv debug mode
 * @param {boolean=} options.singleInstance   override whether this instance should have singleton semantics, only one instance may be created with this true (default true)
 * @param {boolean=} options.showUserErrorMessageUI override whether this instance should show the default user error message UI element, set to false if you want to setup/style your own user error message UI using {@link DMAppController#userErrorSignal} and/or {@link DMAppController#userErrorTexts} (default false)
 * @param {boolean=} options.logWindowErrors  override whether this instance should log error events on the window object (default: value of options.singleInstance)
 * @param {ajaxCredentials=} options.serviceAjaxCredentials override initial value of {@link DMAppController#serviceAjaxCredentials} (default: null)
 * @param {boolean=} options.enableAnalytics  optional whether to enable analytics (see {@link DMAppController#analyticsEnabled})
 * @param {number=} options.initStickyDefaultClockWallclockRelative optional value to use to intialise the sticky default clock, as an offset from the wallclock at initialisation time
 * @param {number=} options.forceInitialClockUpdateValue optional value to use for the first clock update message to the layout service, this also delays subsequent clock update messages until the first component start time has been received
 */
function DMAppController(options) {
	mostRecentController = this;
	this.deviceIdPrefix = "client";
	this.deviceIdNamespace = "";
	this.defaultLogLevel = null;
	this.concatLogArgs = !!window.cordova;
	this.longFormConsoleLogging = true;
	this.networkLogLevel = null;
	this.advDebugMode = false;
	this.singleInstance = true;
	this.showUserErrorMessageUI = false;
	this.logWindowErrors = undefined;
	this.serviceAjaxCredentials = null;
	this.initStickyDefaultClockWallclockRelative = null;
	this.forceInitialClockUpdateValue = null;

	Object.defineProperties(this, {
		initedWaitable:       { value: waitable() },
	});

	const uri = new URI(location.href);
	const uri_fragment = uri.fragment();
	if (uri_fragment) {
		try {
			const params = URI.parseQuery(uri_fragment);
			const flags = params['**2idf'];
			if (flags) {
				const self = this;
				console.warn("Debug fragment flags: ", flags);
				if (!options) options = {};
				flags.split('').map(function(char) {
					if (char === 'l') options.defaultLogLevel = Logger.levels.TRACE;
					if (char === 'c') options.longFormConsoleLogging = true;
					if (char === 'a') options.advDebugMode = true;
					if (char === 'v') {
						self.initedWaitable.then(function() {
							self.enableDevDialogLogging();
						});
					}
					if (char === 'd') {
						self.initedWaitable.then(function() {
							self.app2appMsgBusCtl.send({}, '@self', '**create_debug_component');
						});
					}
					if (char === 'm') {
						self.initedWaitable.then(function() {
							DebugMiscUtil.setupTimelineMasterOverrideDebugUtil(self);
						});
					}
				});
			}
		} catch (e) {
			/* swallow */
		}
	}

	Object.defineProperty(this, '_urls', { value: Object.freeze({}), writable: true });

	if (DMAppController._debugConstructorHooks.length) {
		/* global console */
		console.warn("Executing " + DMAppController._debugConstructorHooks.length + " DMAppController debug constructor hooks");
		if (!options) options = {};
		for (let i = 0; i < DMAppController._debugConstructorHooks.length; i++) {
			DMAppController._debugConstructorHooks[i](this, options);
		}
	}

	if (options) {
		if (options.setDeviceId) this.setDeviceId = options.setDeviceId;
		if (options.deviceIdPrefix) this.deviceIdPrefix = options.deviceIdPrefix;
		if (options.deviceIdNamespace) this.deviceIdNamespace = options.deviceIdNamespace;
		if (options.deviceIdNamespaceGroup) this.deviceIdNamespace = "\u00A7" + options.deviceIdNamespaceGroup + "/" + this.deviceIdNamespace;
		if (options.defaultLogLevel != null) this.defaultLogLevel = options.defaultLogLevel;
		if (options.concatLogArgs != null) this.concatLogArgs = options.concatLogArgs;
		if (options.longFormConsoleLogging != null) this.longFormConsoleLogging = options.longFormConsoleLogging;
		if (options.networkLogLevel != null) this.networkLogLevel = Logger.getLevelNumber(options.networkLogLevel);
		if (options.networkLogSourcePostfix != null) this.networkLogSourcePostfix = options.networkLogSourcePostfix;
		if (options.makeNewDeviceId != null) this.makeNewDeviceId = options.makeNewDeviceId;
		if (options.advDebugMode != null) this.advDebugMode = options.advDebugMode;
		if (options.singleInstance != null) this.singleInstance = options.singleInstance;
		if (options.showUserErrorMessageUI != null) this.showUserErrorMessageUI = options.showUserErrorMessageUI;
		if (options.logWindowErrors != null) this.logWindowErrors = options.logWindowErrors;
		if (options.serviceAjaxCredentials != null) this.serviceAjaxCredentials = options.serviceAjaxCredentials;
		if (options.initStickyDefaultClockWallclockRelative != null) this.initStickyDefaultClockWallclockRelative = options.initStickyDefaultClockWallclockRelative;
		if (options.forceInitialClockUpdateValue != null) this.forceInitialClockUpdateValue = options.forceInitialClockUpdateValue;
	}
	if (this.logWindowErrors === undefined) this.logWindowErrors = this.singleInstance;

	Object.defineProperties(this, {
		instanceId:                { value: "/!" + this.generateRandomIdString(12) },
		_defaultSessionId:         { value: "/S" + this.generateRandomIdString(12) },
		logger:                    { value: this.createNamedLogger("DMAppController") },
		netLogger:                 { value: this.createNamedLogger("Network") },
		devDialogLogger:           { value: this.createNamedLogger("Dev Dialog Box", true) }, // don't bother logging remotely
		errorSignals:              { value: {} },
		_userErrorMap:             { value: new Map() },
		userErrorSignal:           { value: new Signal.BaseSignal([]) },
		userErrorTexts:            { value: {} },
		localDevGroupErrorSummary: { value: new Signal.BaseSignal(null) },
		_errorSignalLogger:        { value: this.createNamedLogger("Error Signal") },
		_devDialogLogSignal:       { value: new Signal.BaseSignal([]) },
		_notificationProviderList: { value: [] },
		localSignalMap:            { value: new LocalSignalMap() },
		localRefCountSignalMap:    { value: new LocalSignalMap(Signal.RefCountSignal) },
		analyticsEnabled:          { value: new Signal.SettableSignal(options && options.enableAnalytics, { boolean: true }) },
		_analyticsQueue:           { value: [] },
		_analyticsHandler:         { value: null, writable: true },
		muteAll:                   { value: new Signal.SettableSignal(false, { boolean: true }) },
	});
	Object.defineProperties(this, {
		_sessionIdSignal:     { value: new Signal.SettableSignal(this._defaultSessionId) },
	});
	Object.defineProperties(this, {
		sessionId:            { get: function () { return this._sessionIdSignal.getValue(); } },
	});

	SafeEventEmitter.defaultLogger = this.createNamedLogger("SafeEventEmitter");
	this.logger.info("DMAppController version: " + require('__VERSION__'));
	this.logger.debug("Instance ID: " + this.instanceId);
	Object.defineProperties(this, {
		monotonicNow:    { value: ClockMiscUtil.getMonotonicTimeFunc(this.logger) },
	});
	ClockMiscUtil.monotonicNow = this.monotonicNow;

	this.userErrorTexts.NETWORK = "Network connection error";
	this.userErrorTexts.NETWORK_SLOW = "Network connection is too slow";
	this.userErrorTexts.PLATFORM = "Problem with 2-Immerse platform";
	this.userErrorTexts.LOCAL_ERROR = "Problem with 2-Immerse on your device";
	this.userErrorTexts.VIDEO_ERROR = "Unable to play video";
	this.userErrorTexts.VIDEO_CAPABILITY_ERROR = "Unable to play video: your device does not have the capabilities required";

	const ErrorSignal = ErrorUtil.ErrorSignal;
	const ErrorFlag = ErrorUtil.ErrorFlag;
	const ErrorMode = ErrorUtil.ErrorMode;


	{
		const errorSignals = this.errorSignals;

		/**
		 * User-level general network error (NETWORK)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.networkGeneral = new ErrorSignal(this, null, ErrorMode.USER, 'NETWORK');

		/**
		 * Dev-level services network error
		 * @type ErrorUtil.ErrorFlag
		 * @memberof! DMAppController#
		 */
		errorSignals.networkServices = new ErrorFlag(this, errorSignals.networkGeneral, ErrorMode.DEV, "Remote network connection error: services");

		/**
		 * Dev-level media download network error
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.localServices = new ErrorSignal(this, errorSignals.networkGeneral, ErrorMode.DEV, "Local network connection/services error");

		/**
		 * Dev-level services network error
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.networkMedia = new ErrorSignal(this, errorSignals.networkGeneral, ErrorMode.DEV, "Remote network connection error: media download");

		/**
		 * User-level network slow error (NETWORK_SLOW)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.networkSlow = new ErrorSignal(this, null, ErrorMode.USER, 'NETWORK_SLOW');
		errorSignals.networkSlow.setUserMaskingSignals([errorSignals.networkGeneral]);

		/**
		 * Dev-level network slow (media download) error
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.networkSlowMedia = new ErrorSignal(this, errorSignals.networkSlow, ErrorMode.DEV, "Remote network connection too slow: media download");

		/**
		 *User-level general platform/services error (PLATFORM)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.services = new ErrorSignal(this, null, ErrorMode.USER, 'PLATFORM');

		/**
		 * Dev-level context ejection error
		 * @type ErrorUtil.ErrorFlag
		 * @memberof! DMAppController#
		 */
		errorSignals.contextEjection = new ErrorFlag(this, errorSignals.services, ErrorMode.DEV, "Unexpectedly ejected from layout context/dmapp");

		/**
		 * Dev-level shared state service error
		 * @type ErrorUtil.ErrorFlag
		 * @memberof! DMAppController#
		 */
		errorSignals.sharedState = new ErrorFlag(this, errorSignals.services, ErrorMode.DEV, "Problem with shared state service");

		/**
		 * User-level local error (LOCAL_ERROR)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.localError = new ErrorSignal(this, null, ErrorMode.USER, 'LOCAL_ERROR');

		/**
		 * Dev-level configuration error
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.configuration = new ErrorSignal(this, errorSignals.localError, ErrorMode.DEV, "Incorrect configuration: checks logs and other error flags for details");

		/**
		 * User-level video capability error (VIDEO_CAPABILITY_ERROR)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.videoCapability = new ErrorSignal(this, null, ErrorMode.USER, 'VIDEO_CAPABILITY_ERROR');

		/**
		 * User-level video error (VIDEO_ERROR)
		 * @type ErrorUtil.ErrorSignal
		 * @memberof! DMAppController#
		 */
		errorSignals.videoPlayback = new ErrorSignal(this, null, ErrorMode.USER, 'VIDEO_ERROR');
		errorSignals.videoPlayback.setUserMaskingSignals([errorSignals.videoCapability]);
	}

	try {
		Object.freeze(this.errorSignals);
	} catch (e) {
		/* swallow: doesn't matter too much if this fails */
	}

	if (this.showUserErrorMessageUI) {
		this._setupShowUserErrorMessageUI();
	}

	let self = this;
	if (this.advDebugMode) {
		self = DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(this, this.logger, "DMAppController", [
			'_sharedStateMappingService', '_deviceId', '_devDialogLoggingSetup', '_netLogTimeoutHandle', '_pageUnloading', '_netLogPendingMessages', '_errorSummarySignal', 'networkLogSourcePostfix', 'setDeviceId', '_debugDmAppCompInstances',
		]);
	}
	if (this.singleInstance) {
		if (!singleControllerInstance) {
			singleControllerInstance = self;
		} else {
			this.logger.throwError("Attempted to create more than one DMAppController in single-instance mode");
		}
	}

	Object.defineProperties(this, {
		_modeSignal:     { value: new Signal.SettableSignal(undefined) },
		_sharedSignalMap:{ value: new RefCountedSignalMap() },
		_sharedSignalStorage: { value: new LocalSignalMap() },
		_perDeviceSignalMap:           { value: new Map() },
		_perDeviceSignalMerged:        { value: new RefCountedSignalMap() },
		localPerDeviceSignalMap:       { value: new LocalSignalMap() },
		_perDeviceRCSignalMap:         { value: new Map() },
		_perDeviceRCSignalMerged:      { value: new RefCountedSignalMap() },
		localPerDeviceRefCountSignalMap: { value: new LocalSignalMap(Signal.RefCountSignal) },
		layout:          { value: new DMAppLayout(self) },
		timeline:        { value: new DMAppTimeline(self) },
		keyStore:        { value: new KeyStore() },
		app2appMsgBusCtl:{ value: new App2AppMsgBusCtl(self) },
		_sharedStateConnectionCache:   { value: new Map() },
		_sharedStateDebugDumpFuncs:    { value: new Map() },
		_debugDumpSignals:{ value: [] },
	});

	self._sharedSignalMap.on("newSignal", function(info) {
		if (self.app2appMsgBusCtl.isMaster()) {
			info.signal.setSignalCopy(self._sharedSignalStorage.getSignal(info.key));
		}
	});

	self.localPerDeviceSignalMap.newSignalCallback = function(key, signal) {
		self.emit("_newPerDeviceSignalLocal", key, signal);
		if (self.app2appMsgBusCtl.isMaster()) {
			signal.on('change', function() {
				self._updateMergedPerDeviceSignal(key);
			});
		}
	};

	self._perDeviceSignalMerged.on("newSignal", function(info) {
		if (self.app2appMsgBusCtl.isMaster()) {
			self._updateMergedPerDeviceSignal(info.key);
		}
	});

	self.localPerDeviceRefCountSignalMap.newSignalCallback = function(key, signal) {
		self.emit("_newPerDeviceRefCountSignalLocal", key, signal);
		if (self.app2appMsgBusCtl.isMaster()) {
			signal.on('change', function() {
				self._updateMergedPerDeviceRCSignal(key);
			});
		}
	};

	self._perDeviceRCSignalMerged.on("newSignal", function(info) {
		if (self.app2appMsgBusCtl.isMaster()) {
			self._updateMergedPerDeviceRCSignal(info.key);
		}
	});

	if (options) {
		this.layout._capsOverride = {};
		for (let prop of ['communalDevice', 'concurrentVideo', 'deviceType', 'touchInteraction', 'displayWidth', 'displayHeight', 'displayResolution']) {
			if (options[prop] != null) this.layout._capsOverride[prop] = options[prop];
		}
	}

	argCheck(arguments, 1, this.logger, "DMAppController constructor", options,
			['setDeviceId', 'deviceIdPrefix', 'deviceIdNamespace', 'deviceIdNamespaceGroup', 'defaultLogLevel', 'concatLogArgs', 'makeNewDeviceId', 'communalDevice', 'concurrentVideo',
					'deviceType', 'touchInteraction', 'longFormConsoleLogging', 'networkLogLevel', 'networkLogSourcePostfix',
					'displayWidth', 'displayHeight', 'displayResolution', 'advDebugMode', 'singleInstance',
					'showUserErrorMessageUI', 'logWindowErrors', 'serviceAjaxCredentials', 'enableAnalytics', 'initStickyDefaultClockWallclockRelative', 'forceInitialClockUpdateValue']);

	if (this.logWindowErrors) {
		window.addEventListener('error', function(event) {
			self.logger.error("Error event on window object: ", event.message, "\n", event.error);
		});
	}

	if (window.cordova) {
		Object.defineProperties(this, {
			_orientationCtl: { value: new DeviceOrientationCtl(this) },
		});
	}

	window.addEventListener('unload', function(event) {
		Object.defineProperties(self, {
			_pageUnloading:  { value: true },
		});
		self._flushNetworkLogMessages();
	});

	this.initedWaitable.signal();

	return self;
}
inherits(DMAppController, SafeEventEmitter);

/**
 * Return most recently created DMAppController instance
 *
 * This method should be used with care
 *
 * @returns {?DMAppController} most recently created instance, or null
 */
DMAppController.getMostRecent = function() {
	return mostRecentController;
};

function DevLoggingCtl(opts) {
	this.opts = opts || {};
	this.nodes = [];
}

DevLoggingCtl.prototype.toString = function() {
	return '';
};

DevLoggingCtl.prototype.add = function(node) {
	if (this.opts.single) {
		this.clear(true);
	}
	this.nodes.push(node);
};

DevLoggingCtl.prototype.clear = function(nocheck) {
	for (let i = 0; i < this.nodes.length; i++) {
		this.nodes[i].clear();
	}
	this.nodes = [];
	if (!nocheck) {
		const statusBar = $("#DMAppControllerDevLoggingStatusBar");
		if (statusBar && statusBar.children().length <= 2) statusBar.remove();
	}
};

DMAppController.prototype.makeDevLoggingCtl = function(opts) {
	return new DevLoggingCtl(opts);
};

/** @member {DMAppLayout} DMAppController#layout Layout instance */
/** @member {DMAppTimeline} DMAppController#timeline Timeline instance */
/** @member {Logger} DMAppController#logger logger for this instance */
/** @member {KeyStore} DMAppController#keyStore key store for this instance */
/** @member {App2AppMsgBusCtl} DMAppController#app2appMsgBusCtl App2App message bus controller for this instance */
/** @member {?ajaxCredentials} DMAppController#serviceAjaxCredentials Optional AJAX service credentials */
/** @member {LocalSignalMap} DMAppController#localSignalMap Local signal map instance */
/** @member {LocalSignalMap.<Signal.RefCountSignal>} DMAppController#localRefCountSignalMap Local ref-count signal map instance */
/** @member {Signal.SettableSignal.<boolean>} DMAppController#analyticsEnabled Signal controlling whether analytics events are enabled (default off), see See {@link DMAppController#analyticsEvent} */
/** @member {Signal.SettableSignal.<boolean>} DMAppController#muteAll Signal which when true mutes all media components */
/** @member {?string} DMAppController#sessionId current session ID */

/**
 * Local per-device signal map instance.
 * Signal values are propagated across app2app to other devices, see: {@link DMAppController#getMergedPerDeviceSignal}
 *
 * @member {LocalSignalMap} DMAppController#localPerDeviceSignalMap
 */
/**
 * Local per-device ref-count signal map instance.
 * Signal values are propagated across app2app to other devices, see: {@link DMAppController#getMergedPerDeviceRefCountSignal}
 *
 * @member {LocalSignalMap} DMAppController#localPerDeviceRefCountSignalMap
 */

/**
 * Name of user error category
 *
 * Includes: 'NETWORK', 'PLATFORM', 'LOCAL_ERROR', 'VIDEO_ERROR', 'VIDEO_CAPABILITY_ERROR'
 *
 * @typedef {string} DMAppController.UserErrorName
 */
/** @member {Signal.BaseSignal.<Array.<DMAppController.UserErrorName>>} DMAppController#userErrorSignal Signal of array of active user error names */
/** @member {Object.<DMAppController.UserErrorName, string>} DMAppController#userErrorTexts Mutable object map of user error names to text to display to the user */

/**
 * Enable developer dialog logging output to console & status bar
 */
DMAppController.prototype.enableDevDialogLogging = function() {
	const self = this;
	if (self._devDialogLoggingSetup) return;
	this._devDialogLoggingSetup = true;
	self.devDialogLogger.addMessageOutput(function(args, methodName, methodLevel, logName) {
		try {
			let statusBar = $("#DMAppControllerDevLoggingStatusBar");
			if (!statusBar.length) {
				statusBar = $("<table id='DMAppControllerDevLoggingStatusBar' style='all: initial; position: absolute; left: 0px; right: 0px; bottom: 0px; margin-left: 60px; margin-right: 60px; z-index: 500;' />");
				const node_title = $("<div style='position: absolute; transform: translateY(-100%); border: 1px solid black; background-color: white;'>Dev Log Informational Status Bar</div>");
				const node_close = $("<div style='position: absolute; transform: translateY(-100%); border: 1px solid black; background-color: white; right: 0px;'>CLOSE</div>");
				statusBar.append(node_title, node_close);
				node_close.click(function() {
					statusBar.remove();
				});
				document.body.appendChild(statusBar[0]);
			}
			let colour = "#ffffff";
			if (methodLevel === Logger.levels.ERROR) {
				colour = "#ffC0C0";
			} else if (methodLevel === Logger.levels.WARN) {
				colour = "#ffffC0";
			}
			const node = $("<tr style='background-color:" + colour + "' />");
			const node_l = $("<td>" + methodName + "</td>");
			const node_r = $("<td/>");
			const node_r_inner = $("<div style='max-height: 8em; overflow-y: auto' />");
			node.append(node_l, node_r);
			node_r.append(node_r_inner);
			const signal_node = {
				node: node,
			};
			if (args.length > 0 && args[args.length - 1] instanceof DevLoggingCtl) {
				args[args.length - 1].add(signal_node);
				args = args.slice(0, -1);
			}
			const text = Logger.prototype._flattenMessageArray(args);
			node_r_inner.text(text);
			signal_node.text = text;
			signal_node.methodName = methodName;
			signal_node.methodLevel = methodLevel;
			signal_node.clear = function() {
				node.remove();
				self._devDialogLogSignal._change(self._devDialogLogSignal.getValue().filter(function(item) {
					return item != signal_node;
				}));
			};
			statusBar.append(node);
			self._devDialogLogSignal._change(self._devDialogLogSignal.getValue().concat(signal_node));
		} catch (e) {
			/* swallow */
		}
	});
};

/**
 * Return a monotonic timestamp in ms.
 * This method does not require a valid `this` pointer, only a valid instance.
 *
 * @method DMAppController#monotonicNow
 * @returns {number} Monotonic timestamp in ms
 */

/**
 * Constructor function type which returns an uninitialised DMApp component.
 *
 * This MAY be a Polymer constructor function, but this is NOT REQUIRED.
 * This constructor function SHOULD NOT call {@link DMAppComponentBehaviour.initDMAppComponent}
 *
 * @callback DMAppComponentConstructorFunction
 * @param {!DMAppController} dMAppController controller, use of this parameter is optional
 * @returns {!DMAppComponent}
 */

/**
 * Object used to map DMApp component type names to constructor functions which return an uninitialised DMApp component.
 *
 * @type {Object.<string, DMAppComponentConstructorFunction>}
 */
DMAppController.prototype.dMAppComponentTypes = {};

DMAppController.prototype._deviceIdLocalStorageKey = "DMAppController_deviceId";

/**
 * Returns the base protocol for the current controller instance.
 * This is either "http:" or "https:"
 *
 * @returns {string} Protocol string
 */
DMAppController.prototype.getBaseUrlProtocol = function() {
	if (location.protocol === "http:") {
		return "http:";
	} else {
		return "https:";
	}
};

DMAppController.prototype._getUrl = function(prop) {
	let name = this._urls[prop];
	if (!name) return name;
	if (name.substr(0, 2) === '//') {
		name = this.getBaseUrlProtocol() + name;
	}
	return name;
};

/**
 * Returns a configured URL by name
 *
 * @param {string} prop URL property name to return: valid values include: layoutService, websocketService, timelineService, sharedStateService, loggingService, wallclockService, authService, bandwidthOrchestrationService, layoutServiceFromTimelineService
 * @returns {string} URL
 */
DMAppController.prototype.getUrl = function(prop) {
	return this._getUrl(prop);
};

/**
 * Override service URLs.
 * Presets in {@link DMAppController.serviceUrlPresets} may be passed directly to this method.
 *
 * @param {Object} urls
 * @param {string=} urls.layoutService Layout service URL
 * @param {string=} urls.websocketService Websocket service URL
 * @param {string=} urls.timelineService Timeline service URL
 * @param {string=} urls.sharedStateService Shared State service URL
 * @param {string=} urls.loggingService Logging service URL
 * @param {string=} urls.wallclockService Wallclock service URL
 * @param {string=} urls.authService Auth service URL
 * @param {string=} urls.bandwidthOrchestrationService Bandwidth orchestration service URL
 * @param {string=} urls.remoteNetSyncService Remote net sync service URL
 * @param {string=} urls.layoutServiceFromTimelineService Override layout service URL to use from timeline service
 */
DMAppController.prototype.setUrls = function(urls) /* -> void */ {
	Object.defineProperty(this, '_urls', { value: Object.freeze($.extend({}, urls)), writable: true });
};

/**
 * Get list of service URLs properties, which may be passed as objetc keys to {@link DMAppController#setUrls}
 *
 * @returns {!string[]} property name list
 */
DMAppController.getUrlProps = function() {
	return ['layoutService', 'websocketService', 'timelineService', 'sharedStateService', 'loggingService', 'wallclockService', 'authService', 'bandwidthOrchestrationService', 'layoutServiceFromTimelineService'];
};

/**
 * Service URLs presets
 *
 * Presets may be passed directly to {@link DMAppController#setUrls}.
 */
DMAppController.serviceUrlPresets = {};

/**
 * Generate a random ID string of a given length
 *
 * @param {number} length Length of the ID string to return
 * @returns {string} random ID string
 */
DMAppController.prototype.generateRandomIdString = function(length) {
	const vals = [];
	for (let i = 0; i < length; i++) {
		const randval = (Math.random() * 62) % 62;
		if (randval < 10) {
			vals.push(0x30 + randval);
			continue;
		} else if (randval < 36) {
			vals.push(0x61 + randval - 10);
		} else {
			vals.push(0x41 + randval - 36);
		}
	}
	return String.fromCharCode.apply(String, vals);
};

DMAppController.prototype._generateNewDeviceId = function(namespaceSuffix) /* -> device ID string */ {
	const deviceId = this.deviceIdPrefix + "-" + this.generateRandomIdString(10);
	// Important that this is set before logging a message, as the logger may recursively call getDeviceId again
	Object.defineProperty(this, '_deviceId', { value: deviceId }); // make device ID non-writable
	try {
		localStorage.setItem(this._deviceIdLocalStorageKey + this.deviceIdNamespace + namespaceSuffix, deviceId);
		this.logger.debug("Generated and stored new device ID: " + deviceId);
	} catch (e) {
		this.logger.error("Failed to store generated device ID: " + deviceId, e);
	}
	return deviceId;
};

/** @return {string} device ID */
DMAppController.prototype.getDeviceId = function() /* -> device ID string */ {
	if (this._deviceId) {
		return this._deviceId;
	}
	if (this.setDeviceId) {
		Object.defineProperty(this, '_deviceId', { value: this.setDeviceId }); // make device ID non-writable
		this.logger.debug("Using device ID specified in constructor options (not storing): " + this._deviceId);
		return this._deviceId;
	}
	let namespaceSuffix = "";
	try {
		if (typeof window.device === "object") {
			namespaceSuffix = "_" + window.device.serial + "_" + window.device.uuid;
		}
	} catch (e) {
		/* swallow */
	}
	if (this.makeNewDeviceId) {
		return this._generateNewDeviceId(namespaceSuffix);
	}
	try {
		const deviceId = localStorage.getItem(this._deviceIdLocalStorageKey + this.deviceIdNamespace + namespaceSuffix);
		if (deviceId) {
			// Important that this is set before logging a message, as the logger may recursively call getDeviceId again
			Object.defineProperty(this, '_deviceId', { value: deviceId }); // make device ID non-writable
			this.logger.debug("Retrieved device ID from local storage: " + deviceId);
			return deviceId;
		}
	} catch (e) {
		// Important that this is set before logging a message, as the logger may recursively call getDeviceId again
		this._generateNewDeviceId(namespaceSuffix);
		this.logger.error("Failed to retrieve stored device ID", e);
		return this._deviceId;
	}
	return this._generateNewDeviceId(namespaceSuffix);
};

/**
 * Create a logger with a given prefix
 *
 * @param {string} name Logging prefix
 * @param {boolean=} noNetworkLogging Disable network logging for this logger
 * @returns {Logger}
 */
DMAppController.prototype.createNamedLogger = function(name, noNetworkLogging) /* -> loglevel logger */ {
	const params = {
		name: name,
		concatLogArgs: this.concatLogArgs,
		level: this.defaultLogLevel,
		consoleLongForm: this.longFormConsoleLogging,
	};
	if (this.networkLogLevel != null) {
		if (!this.netLogLogger) {
			const netLogLoggerParams = {
				name: "Network (logging)",
				concatLogArgs: this.concatLogArgs,
				level: this.defaultLogLevel,
				consoleLongForm: this.longFormConsoleLogging,
			};
			Object.defineProperties(this, {
				netLogLogger:          { value: new Logger(netLogLoggerParams) },
				_netLogBlockSignal:    { value: new Signal.BlockCountSignal() },
				_netLogPendingMessages:{ value: [] },
				_netLogMaxSize:        { value: 8000000, writable: true }
			});
		}
		if (!noNetworkLogging) {
			params.messageOutputs = [ this._networkLogMessage.bind(this) ];
		}
	}
	return new Logger(params);
};

DMAppController.prototype._networkLogMessage = function(args, methodName, methodLevel, logName) {
	if (this.networkLogLevel == null || methodLevel > this.networkLogLevel) return;
	let source = "Client";
	if (this.networkLogSourcePostfix) source += "_" + this.networkLogSourcePostfix;
	this._netLogPendingMessages.push({
		logmessage: Logger.prototype._flattenMessageArray(args),
		source: source,
		subSource: logName,
		level: methodName,
		sourcetime: (new Date()).toISOString(),
		contextID: this.layout ? this.layout.contextId : '',
		dmappID: this.layout ? this.layout.dmAppId : '',
		deviceID: this.getDeviceId(),
		instanceID: this.instanceId,
		sessionID: this.sessionId,
	});
	if (this._pageUnloading) {
		this._flushNetworkLogMessages();
	} else if (this._netLogTimeoutHandle == null) {
		this._netLogTimeoutHandle = window.setTimeout(function() {
			delete this._netLogTimeoutHandle;
			this._flushNetworkLogMessages();
		}.bind(this), 2000);
	}
};

DMAppController.prototype._flushNetworkLogMessages = function(max_lines) {
	const self = this;
	if (!max_lines) max_lines = 1000;
	if (!this._netLogPendingMessages || this._netLogPendingMessages.length === 0) return;
	if (this._netLogBlockSignal.isBlocked() && !this._pageUnloading) return;

	let msgs = this._netLogPendingMessages.splice(0, max_lines);

	let str = JSON.stringify({
		logArray: msgs,
	});
	if (str.length > this._netLogMaxSize && msgs.length >= 2) {
		Array.prototype.splice.apply(this._netLogPendingMessages, [0, 0].concat(msgs));
		return this._flushNetworkLogMessages(msgs.length / 2);
	}
	const lines_left = this._netLogPendingMessages.length > 0;

	const ap = this.ajaxPromiseNX({
		method: "POST",
		data: str,
		contentType: "application/json; charset=utf-8",
		url: this.getUrl('loggingService') + 'post',
		'async': !this._pageUnloading,
	});
	ap.addBlockObject(this._netLogBlockSignal);
	ap.setLogger(this.netLogLogger);
	ap.setTitle("Upload " + msgs.length + " log messages");
	ap.exec().then(function() {
		if (lines_left) window.setTimeout(self._flushNetworkLogMessages.bind(self), 100);
	}).catch(function(info) {
		// put log messages back in queue and try again later
		Array.prototype.splice.apply(self._netLogPendingMessages, [0, 0].concat(msgs));
		if (info.status === 413 && msgs.length >= 2) {
			if (self._netLogMaxSize > str.length) {
				self._netLogMaxSize = Math.floor(str.length * 0.9);
				self.netLogLogger.warn("Reducing network logging cap to: " + self._netLogMaxSize);
			}
			window.setTimeout(self._flushNetworkLogMessages.bind(self, msgs.length / 2), 100);
		} else {
			window.setTimeout(self._flushNetworkLogMessages.bind(self, max_lines), 30000);
		}
	});
};

/**
 * Wrapper function to create and exec an AjaxPromise instance with controller-default settings and logging.
 *
 * @returns {Promise<ajaxPromiseResult>}
 */
DMAppController.prototype.ajaxPromise = function() {
	return this.ajaxPromiseNX.apply(this, arguments).exec();
};

/**
 * Wrapper function to create and not exec an AjaxPromise instance with controller-default settings and logging.
 *
 * @returns {AjaxPromise}
 */
DMAppController.prototype.ajaxPromiseNX = function() {
	const ap = new AjaxPromise();
	ap.setLogger(this.netLogger);
	ap.setTimeFunction(this.monotonicNow);
	ap.setArguments.apply(ap, arguments);
	return ap;
};

/**
 * @typedef {Object} DMAppController~GetMappingServiceResult
 * @prop {!MappingService} mappingService mapping service instance
 * @prop {?Function} unref Use this method to signal that the mapping service instance is no longer required, instead of calling destroy() on it
 */

/**
 * Get existing or create new shared state mapping service instance.
 *
 * @returns {DMAppController~GetMappingServiceResult}
 */
DMAppController.prototype.getSharedStateMappingService = function() {
	const self = this;
	if (!self._sharedStateMappingServiceRc) {
		if (!self._sharedStateLogger) {
			Object.defineProperty(self, '_sharedStateLogger', { value: self.logger.makeChildLogger("SharedState") });
		}
		const logger = self._sharedStateLogger;
		logger.debug("Creating new cached shared state mapping service connection");

		const serviceUrl = this._getUrl('sharedStateService');
		const mappingService = SharedStateClient.MappingService(serviceUrl, {
			userId: "client:" + self.getDeviceId(),
			errorFunction: logger.deferredConcat('error', "Shared State Mapping: "),
			socketIo: socketIo,
		});
		const destroy = mappingService.destroy.bind(mappingService);
		mappingService.destroy = function() {
			logger.throwError("Don't call destroy on a cached shared state mapping service instance");
		};

		self._sharedStateMappingServiceRc = {
			mappingService: mappingService,
			refManager: new ResourceMgmtUtil.RefCountedDelayedDestructor(60000, function() {
					self._sharedStateDebugDumpFuncs.delete(mappingService);
					delete self._sharedStateMappingServiceRc;
					logger.debug("Destroying cached shared state mapping service connection");
					destroy();
					self.emit("_sharedStateDebugChange");
				}),
		};

		let haveRegisteredRcCallback = false;
		self._sharedStateDebugDumpFuncs.set(mappingService, function(dumper) {
			const cat = dumper.subcategory("Mapping Service");
			cat.keyValue("Ready state", mappingService.readyState);
			cat.keyValue("Ref count", self._sharedStateMappingServiceRc.refManager.getReferenceCount());

			if (!haveRegisteredRcCallback) {
				self._sharedStateMappingServiceRc.refManager.addRefCountChangeCallbacks(self.emit.bind(self, "_sharedStateDebugChange"));
				haveRegisteredRcCallback = true;
			}
		});

		mappingService.on("readystatechange", self.emit.bind(self, "_sharedStateDebugChange"));
	}
	self._sharedStateMappingServiceRc.refManager.ref();
	return {
		mappingService: self._sharedStateMappingServiceRc.mappingService,
		unref: onetime(self._sharedStateMappingServiceRc.refManager.unref.bind(self._sharedStateMappingServiceRc.refManager)),
	};
};

let _nextSharedStateLookupId = 0;
let _nextSharedStateLoggerId = 0;

/**
 * @typedef {Object} DMAppController~CreateSharedStateResult
 * @prop {!SharedState} sharedState shared state instance
 * @prop {?Function} unref When cached mode is enabled, use this method to signal that the shared state instance is no longer required, instead of calling destroy() on it
 */

/**
 * Create shared state instance for a group mapping ID
 *
 * @param {string} groupMappingId group mapping ID
 * @param {Object=} options optional options object
 * @param {string=} options.userId optional user ID
 * @param {Logger=} options.parentLogger optional parent logger to use, if not specified this instance's logger is used
 * @param {boolean=} options.cached optional whether to cache and reuse this shared state instance
 * @param {boolean=} options.returnObject optional whether to return a CreateSharedStateResult instead of a SharedState, this must be true if using options.cached
 * @returns {Promise<(DMAppController~CreateSharedStateResult|SharedState)>}
 */
DMAppController.prototype.createSharedStateFromGroupMapping = function(groupMappingId, options) {
	const self = this;
	if (!options) options = {};

	if (!self._sharedStateLogger) {
		Object.defineProperty(self, '_sharedStateLogger', { value: self.logger.makeChildLogger("SharedState") });
	}
	const parentLogger = options.parentLogger || self._sharedStateLogger;

	let cacheKey = groupMappingId;
	let name = "Shared State Mapping: " + groupMappingId;
	if (options.userId) {
		name += " (userId = " + options.userId + ")";
		cacheKey += "\uF000" + options.userId;
	}

	const makeCachePromise = function(cacheInfo) {
		cacheInfo.refManager.ref();
		return cacheInfo.promise.then(function(result) {
			return $.extend({
				unref: onetime(cacheInfo.refManager.unref.bind(cacheInfo.refManager)),
			}, result);
		});
	};

	if (options.cached) {
		if (!options.returnObject) {
			parentLogger.throwError("Cannot use cached option without returnObject option");
		}
		const conn = self._sharedStateConnectionCache.get(cacheKey);
		if (conn) {
			parentLogger.debug("Re-using existing cached shared state connection: " + name);
			return makeCachePromise(conn);
		}
	}

	const selfLogger = (!options.cached && options.parentLogger) ? options.parentLogger : self._sharedStateLogger.makeChildLogger(_nextSharedStateLoggerId++);

	const mappingSvcInfo = self.getSharedStateMappingService();

	let cacheInfo;
	if (options.cached) {
		parentLogger.debug("Creating new cached shared state connection: " + name);
		cacheInfo = {
			refManager: new ResourceMgmtUtil.RefCountedDelayedDestructor(15000, function() {
				if (cacheInfo.ss) {
					cacheInfo.logger.debug("Destroying cached shared state connection: " + name);
					cacheInfo.ss._realDestroy();
				}
				self._sharedStateConnectionCache.delete(cacheKey);
			}),
			logger: selfLogger,
		};
	} else {
		parentLogger.debug("Creating new shared state connection: " + name);
	}

	const promise = RetryUtil.retryPromise(function(retryState) {
		const logger = selfLogger.makeChildLogger(" Lookup: " + _nextSharedStateLookupId++);
		if (logger.getLevel() >= Logger.levels.INFO) {
			const now = self.monotonicNow();
			logger.addMessageTransform(function(args) {
				const t = self.monotonicNow();
				args.unshift(sprintf("At %.3f ms (%+.3f ms): ", t, t - now));
				return args;
			});
			if (retryState.attemptNum > 1) {
				logger.addMessageTransform(function(args) {
					args.unshift("[Retry: attempt: " + retryState.attemptNum + "]");
					return args;
				});
			}
		}

		logger.debug("Looking up mapping: " + name);

		return mappingSvcInfo.mappingService.getGroupMapping(groupMappingId).then(function(data) {
			logger.debug("Got mapping, connecting to shared state");

			const timeout = new TimeoutHandler();
			timeout.addTimeout(function() {
				logger.warn("Shared State Client (" + groupMappingId + ") still not connected after 5s...");
			}, 5000);
			timeout.addTimeout(function() {
				logger.error("Shared State Client (" + groupMappingId + ") still not connected after 20s, raising error condition...");
				self.errorSignals.sharedState.raise();
			}, 20000);
			const ss = SharedStateClient.SharedState(data.group, {
				userId: options.userId || "client:" + self.getDeviceId(),
				errorFunction: logger.deferredConcat('error', "Shared State Client (" + groupMappingId + "): "),
				socketIo: socketIo,
			});

			let haveRegisteredRcCallback = false;
			self._sharedStateDebugDumpFuncs.set(ss, function(dumper) {
				const cat = dumper.subcategory("Shared State Connection");
				cat.keyValue("Ready state", ss.readyState);
				cat.keyValue("Group", groupMappingId);
				if (options.userId) cat.keyValue("User ID", options.userId);

				if (options.cached) {
					cat.keyValue("Ref count", cacheInfo.refManager.getReferenceCount());

					if (!haveRegisteredRcCallback) {
						cacheInfo.refManager.addRefCountChangeCallbacks(self.emit.bind(self, "_sharedStateDebugChange"));
						haveRegisteredRcCallback = true;
					}
				}
			});

			let currentReadyState = null;
			ss.on('readystatechange', function() {
				logger.debug("Shared state readystatechange " + currentReadyState + " -> " + ss.readyState);
				if (currentReadyState === "open" && ss.readyState === "connecting") {
					window.setTimeout(function() {
						if (ss.readyState === "connecting") {
							// Connection has dropped out temporarily, check that we aren't transitioning to closed
							self.errorSignals.sharedState.raise();
						}
					}, 0);
				}
				if (ss.readyState === "open") {
					timeout.cancel();
					self.errorSignals.sharedState.clear();
				}
				if (ss.readyState === "closed") {
					self._sharedStateDebugDumpFuncs.delete(ss);
				}
				currentReadyState = ss.readyState;
				self.emit("_sharedStateDebugChange");
			});

			const result = {
				sharedState: ss,
			};
			const origDestroy = ss.destroy;
			const newDestroy = function() {
				mappingSvcInfo.unref();
				return origDestroy.apply(this, arguments);
			};
			if (options.cached) {
				ss._realDestroy = newDestroy;
				ss.destroy = function() {
					selfLogger.throwError("Don't call destroy on a cached shared state instance");
				};
				cacheInfo.ss = ss;
			} else {
				ss.destroy = newDestroy;
			}
			return Object.freeze(result);
		});
	}, selfLogger, {
		name: name,
		maxAttempts: 3,
		baseDelay: 500,
	});
	promise.then(function () {
		self.errorSignals.sharedState.clear();
	});
	promise.catch(function (error) {
		selfLogger.error(name + " Failed: ", error);
		if (options.cached) {
			self._sharedStateConnectionCache.delete(cacheKey);
		}
		mappingSvcInfo.unref();
		self.errorSignals.sharedState.raise();
	});
	if (options.cached) {
		cacheInfo.promise = promise;
		self._sharedStateConnectionCache.set(cacheKey, cacheInfo);
		return makeCachePromise(cacheInfo);
	} else {
		if (options.returnObject) {
			return promise;
		} else {
			return promise.then(function(info) {
				return info.sharedState;
			});
		}
	}
};

DMAppController.prototype._getLozengeUIContainer = function() {
	if (!this._divLozengeUIContainer) {
		this._divLozengeUIContainer = $("<div style='all: initial; position: absolute; top: 3em; left: 50%; transform: translate(-50%, 0);" +
			"z-index: 9000; align: center;' />");
		$('body').append(this._divLozengeUIContainer);
	}
	return this._divLozengeUIContainer;
};

DMAppController.prototype._setupShowUserErrorMessageUI = function() {
	const self = this;
	self.userErrorSignal.on("change", function(info) {
		const items = info.newValue;
		if (items.length) {
			if (!self._userErrorMessageUIBlock) {
				self._userErrorMessageUIBlock = $("<div style='font-weight: bold; background-color: #000080; color: white; border-radius: 1em; padding: 1em; margin: 0.5em;' />");
			}
			self._userErrorMessageUIBlock.empty();
			for (let i = 0; i < items.length; i++) {
				const div = $('<div style="text-align: center;" />');
				div.text(self.userErrorTexts[items[i]]);
				self._userErrorMessageUIBlock.append(div);
			}
			self._getLozengeUIContainer().prepend(self._userErrorMessageUIBlock);
		} else {
			if (self._userErrorMessageUIBlock) {
				self._userErrorMessageUIBlock.remove();
				delete self._userErrorMessageUIBlock;
			}
		}
	});
};

DMAppController.prototype.getErrorSignalSummarySignal = function() {
	const self = this;
	if (!self._errorSummarySignal) {
		const signal = Signal.SettableSignal.makeWithSignalTransform(true, self.errorSignals, function(signals) {
			const out = [];
			for (let prop in signals) {
				const err = signals[prop];
				if (err.getValue()) {
					out.push({
						user: !!(err.modes & ErrorUtil.ErrorMode.USER),
						modes: err.modes,
						msg: err.msg,
						propertyName: prop,
					});
				}
			}
			return out;
		});

		Object.defineProperty(self, '_errorSummarySignal', { value: signal });
	}
	return self._errorSummarySignal;
};

DMAppController.prototype._orderedRegister = function(list, item) {
	this._orderedUnregister(list, item);
	list.push(item);
};

DMAppController.prototype._orderedUnregister = function(list, item) {
	const index = list.indexOf(item);
	if (index >= 0) list.splice(index, 1);
};

/**
 * Notification data.
 * Other properties may be set, but are ignored by the default implementation of {@link DMAppController#showNotification}
 *
 * @typedef {Object} DMAppController~ShowNotificationData
 * @prop {string=} text Text
 * @prop {boolean=} warning True if this is a warning
 * @prop {boolean=} error True if this is an error
 */
/**
 * @callback DMAppController~ShowNotificationImplementation
 * @param {!DMAppController} controller DMAppController instance
 * @param {!DMAppController~ShowNotificationData} data Notifcation data.
 */

/**
 * Register UI notification provider
 * The most recently registered provider which has not been unregistered is used.
 *
 * @param {DMAppController~ShowNotificationImplementation} func Show notification implementation function
 */
DMAppController.prototype.registerNotificationProvider = function(func) {
	return this._orderedRegister(this._notificationProviderList, func);
};

/**
 * Unregister UI notification provider
 *
 * @param {DMAppController~ShowNotificationImplementation} func Show notification implementation function previously passed to {@link DMAppController#registerNotificationProvider}
 */
DMAppController.prototype.unregisterNotificationProvider = function(func) {
	return this._orderedUnregister(this._notificationProviderList, func);
};

/**
 * Show a UI notification
 *
 * The implementation of this method can be changed.
 * See {@link DMAppController#registerNotificationProvider} and {@link DMAppController#unregisterNotificationProvider}.
 *
 * @param {!DMAppController~ShowNotificationData} data Notification data
 */
DMAppController.prototype.showNotification = function(data) {
	if (this._notificationProviderList.length) {
		this._notificationProviderList[this._notificationProviderList.length - 1](this, data);
	} else {
		let background = '#87ceeb';
		if (data.error) {
			background = '#ff4040';
		} else if (data.warning) {
			background = 'yellow';
		}
		const div = $("<div style='font-weight: bold; background-color: " + background + "; color: black; border-radius: 1em; padding: 1em; margin: 0.5em;' />");
		div.text(data.text);
		this._getLozengeUIContainer().append(div);
		window.setTimeout(function() {
			div.remove();
		}, 5000);
	}
};

/**
 * @typedef {Object} DMAppController~GetRefCountedSignalResult
 * @prop {!Signal.ConstWrapperSignal} signal signal instance
 * @prop {!Function} unref Use this method to signal that the signal instance is no longer required, this will decrement its ref count
 */

/**
 * Get context-shared signal (shared across app2app), incrementing its ref count and creating it if it doesn't already exist
 *
 * See also: {@link DMAppController#setSharedSignal}, {@link DMAppController#setSharedSignalCas}
 *
 * @param {string} key Arbitrary string key
 * @returns {!DMAppController~GetRefCountedSignalResult} Signal result, note that the signal instance is read-only
 */
DMAppController.prototype.getSharedSignal = function(key) {
	const item = this._sharedSignalMap.getSignal(key);
	return Object.freeze({
		signal: new Signal.ConstWrapperSignal(item.signal),
		unref: item.unref,
	});
};

/**
 * Set context-shared signal (shared across app2app)
 *
 * See also: {@link DMAppController#getSharedSignal}, {@link DMAppController#setSharedSignalCas}
 *
 * @param {string} key Arbitrary string key
 * @param value Arbitrary signal value
 * @returns {!Promise} Completion promise
 */
DMAppController.prototype.setSharedSignal = function(key, value) {
	return this.app2appMsgBusCtl.send({ key: key, value: value }, '@master', '**set_shared_signal');
};

/**
 * Get instantaneous value of context-shared signal (shared across app2app)
 *
 * See also: {@link DMAppController#getSharedSignal}, {@link DMAppController#setSharedSignal}, {@link DMAppController#setSharedSignalCas}
 *
 * Note: This method returns a promise of the instantaneous value at the time that the master device receives the request for the current value.
 *
 * This method should ONLY be used if:
 * * The value of the signal is only going to be checked once.
 * * Performing an instantaneous read is a valid and safe operation with respect to data races, any other write operations, etc.
 * * Notification of any future changes is not required.
 *
 * In all other cases, use {@link DMAppController#getSharedSignal} instead.
 *
 * DO NOT use this method for polling.
 *
 * @param {string} key Arbitrary string key
 * @returns {!Promise} Promise of signal value
 */
DMAppController.prototype.getSharedSignalInstantaneousValue = function(key) {
	return this.app2appMsgBusCtl.send({ key: key }, '@master', '**get_shared_signal_instantaneous');
};

/**
 * @typedef {Object} DMAppController~SetSharedSignalCasResult
 * @prop {!boolean} done True iff operation was successful (signal value was changed)
 * @prop current If operation failed (done is false), this is the (unchanged) current value of the signal. If done is true, this field is not set.
 */

/**
 * Set context-shared signal (shared across app2app), with compare and swap semantics
 *
 * See also: {@link DMAppController#getSharedSignal}, {@link DMAppController#setSharedSignal}, {@link DMAppController#setSharedSignalCasLoop}
 *
 * @param {string} key Arbitrary string key
 * @param value Arbitrary signal value
 * @param previous Required previous signal value
 * @returns {!Promise.<DMAppController~SetSharedSignalCasResult>} Completion promise
 */
DMAppController.prototype.setSharedSignalCas = function(key, value, previous) {
	return this.app2appMsgBusCtl.send({ key: key, value: value, previous: previous }, '@master', '**set_shared_signal_cas');
};

/**
 * Value transform from previous to new value for looped compare and swap assignment
 *
 * @callback DMAppController#SetCasLoopValueTransform
 * @param previous Previous value of arbitrary type
 * @returns new signal value to attempt to apply
 */


/**
 * Set context-shared signal (shared across app2app), with looped compare and swap semantics by means of applying a transform to the previous value
 *
 * See also: {@link DMAppController#getSharedSignal}, {@link DMAppController#setSharedSignal}, {@link DMAppController#setSharedSignalCas}
 *
 * @param {!string} key Arbitrary string key
 * @param {!DMAppController#SetCasLoopValueTransform} transform Signal value transform
 * @param previous Optioanl previous signal value hint
 * @returns {!Promise} Completion promise
 */
DMAppController.prototype.setSharedSignalCasLoop = function(key, transform, previous) {
	let prevPromise = (arguments.length >= 3) ? Promise.resolve(previous) : this.getSharedSignalInstantaneousValue(key);
	const tryUpdate = function(prev) {
		return this.setSharedSignalCas(key, transform(prev), prev).then(function(res) {
			if (!res.done) return tryUpdate(res.current);
		});
	}.bind(this);
	return prevPromise.then(tryUpdate);
};

/**
 * Set value info context-shared signal (shared across app2app) at path
 *
 * See also: {@link DMAppController#getSharedSignal}, {@link DMAppController#setSharedSignal}, {@link DMAppController#setSharedSignalCas}, {@link DMAppController#setSharedSignalCasLoop}
 *
 * @param {string} key Arbitrary string key
 * @param {!Array.<string>} path Array of path elements
 * @param value Arbitrary signal value
 * @returns {!Promise.<DMAppController~SetSharedSignalCasResult>} Completion promise
 */
DMAppController.prototype.setSharedSignalAtPath = function(key, path, value) {
	return this.app2appMsgBusCtl.send({ key: key, value: value, path: path }, '@master', '**set_shared_signal_at_path');
};

DMAppController.prototype._getPerDeviceSignalInfo = function(deviceId, rc) {
	const map = rc ? this._perDeviceRCSignalMap : this._perDeviceSignalMap;
	let perDeviceInfo = map.get(deviceId);
	if (!perDeviceInfo) {
		perDeviceInfo = {
			values: new Map(),
		};
		map.set(deviceId, perDeviceInfo);
	}
	return perDeviceInfo;
};

DMAppController.prototype._getExistingPerDeviceSignalInfo = function(deviceId, rc) {
	return this._perDeviceSignalMap.get(deviceId, rc);
};

DMAppController.prototype._removePerDeviceSignal = function(deviceId, rc) {
	const map = rc ? this._perDeviceRCSignalMap : this._perDeviceSignalMap;
	const perDeviceInfo = map.get(deviceId);
	if (!perDeviceInfo) return;
	map.delete(deviceId);
	for (let k of perDeviceInfo.values.keys()) {
		this._updateMergedPerDeviceGenericSignal(k, rc);
	}
};

DMAppController.prototype._updateMergedPerDeviceGenericSignal = function(key, rc) {
	if (rc) {
		this._updateMergedPerDeviceRCSignal(key);
	} else {
		this._updateMergedPerDeviceSignal(key);
	}
};

DMAppController.prototype._updateMergedPerDeviceSignal = function(key) {
	const s = this._perDeviceSignalMerged.getExistingSignal(key);
	if (!s) return;

	const out = {};
	const local = this.localPerDeviceSignalMap.getExistingSignal(key);
	if (local) {
		out[this.getDeviceId()] = local.getValue();
	}
	for (let [deviceId, info] of this._perDeviceSignalMap) {
		if (info.values.has(key)) out[deviceId] = info.values.get(key);
	}
	s.setValue(out);
};

DMAppController.prototype._updateMergedPerDeviceRCSignal = function(key) {
	const s = this._perDeviceRCSignalMerged.getExistingSignal(key);
	if (!s) return;

	let out = 0;
	const local = this.localPerDeviceRefCountSignalMap.getExistingSignal(key);
	if (local) {
		out += local.getValue();
	}
	for (let info of this._perDeviceRCSignalMap.values()) {
		if (info.values.has(key)) out += info.values.get(key);
	}
	s.setValue(out);
};

/**
 * Get merged per-device signal (shared across app2app), incrementing its ref count and creating it if it doesn't already exist
 *
 * The signal value is an object with deviceID keys and values of the corresponding device's value
 *
 * See {@link DMAppController#localPerDeviceSignalMap}
 *
 * @param {string} key Arbitrary string key
 * @returns {!DMAppController~GetRefCountedSignalResult} Signal result, note that the signal instance is read-only
 */
DMAppController.prototype.getMergedPerDeviceSignal = function(key) {
	const item = this._perDeviceSignalMerged.getSignal(key);
	return Object.freeze({
		signal: new Signal.ConstWrapperSignal(item.signal),
		unref: item.unref,
	});
};

/**
 * Get merged per-device signal ref-count (shared across app2app), incrementing its ref count and creating it if it doesn't already exist
 *
 * The signal value is a reference count
 *
 * See {@link DMAppController#localPerDeviceRefCountSignalMap}
 *
 * @param {string} key Arbitrary string key
 * @returns {!DMAppController~GetRefCountedSignalResult} Signal result, note that the signal instance is read-only
 */
DMAppController.prototype.getMergedPerDeviceRefCountSignal = function(key) {
	const item = this._perDeviceRCSignalMerged.getSignal(key);
	return Object.freeze({
		signal: new Signal.ConstWrapperSignal(item.signal),
		unref: item.unref,
	});
};

/**
 * Get signal by name
 * The name is comprised of a type prefix, followed by /, followed by the type-specific key
 *
 * Supported signal types include:
 *
 * | Short prefix | Long prefix             | Class                                | Type                          | Read-only   | Ref-counted | Acquired using                                    |
 * | ------------ | ----------------------- | ------------------------------------ | ----------------------------- | ----------- | ----------- | ------------------------------------------------- |
 * | l            | local                   | Local                                | {@link Signal.SettableSignal} | No          | No          | {@link DMAppController#localSignalMap}            |
 * | lrc          | localRefCount           | Local (ref-count signal)             | {@link Signal.RefCountSignal} | No          | No          | {@link DMAppController#localRefCountSignalMap}    |
 * | s            | shared                  | Shared                               | {@link Signal.SettableSignal} | Yes         | Yes         | {@link DMAppController#getSharedSignal}           |
 * | lpd          | localPerDevice          | Local per-device                     | {@link Signal.SettableSignal} | No          | No          | {@link DMAppController#localPerDeviceSignalMap}   |
 * | mpd          | mergedPerDevice         | Merged per-device                    | {@link Signal.SettableSignal} | Yes         | Yes         | {@link DMAppController#getMergedPerDeviceSignal}  |
 * | lpdrc        | localPerDeviceRefCount  | Local per-device (ref-count signal)  | {@link Signal.RefCountSignal} | No          | No          | {@link DMAppController#localPerDeviceRefCountSignalMap}   |
 * | mpdrc        | mergedPerDeviceRefCount | Merged per-device (ref-count signal) | {@link Signal.RefCountSignal} | Yes         | Yes         | {@link DMAppController#getMergedPerDeviceRefCountSignal}  |
 *
 * @param {!string} name Prefix followed by arbitrary string key
 * @param {object=} options Optional options object
 * @param {boolean=} options.nonRefCountedOnly Optional boolean whether to only return non ref-counted signals
 * @param {boolean=} options.unrefFuncNullable Optional boolean whether to the unref property of the return value may be set to null in the case of non-ref counted signals
 * @returns {!DMAppController~GetRefCountedSignalResult} Signal result, if the signal that was requested is not actually ref-counted, calling unref has no effect, however the caller MUST NOT assume that the signal is not ref-counted unless options.nonRefCountedOnly is specified. unref MAY be null if options.unrefFuncNullable is true.
 */
DMAppController.prototype.getSignalByName = function(name, options) {
	const wrap = function(signal) {
		return {
			signal: signal,
			unref: options && options.unrefFuncNullable ? null : function() {},
		};
	};
	const result = /^([^/]+)\/(.+)$/.exec(name);
	if (!result) this.logger.throwError("getSignalByName: Cannot parse signal name: '" + name + "'");

	switch (result[1]) {
		case "l":
		case "local":
			return wrap(this.localSignalMap.getSignal(result[2]));

		case "lrc":
		case "localRefCount":
			return wrap(this.localRefCountSignalMap.getSignal(result[2]));

		case "s":
		case "shared":
			if (options && options.nonRefCountedOnly) this.logger.throwError("getSignalByName: Cannot get shared signal named: '" + name + "' as called with nonRefCountedOnly option");
			return this.getSharedSignal(result[2]);

		case "lpd":
		case "localPerDevice":
			return wrap(this.localPerDeviceSignalMap.getSignal(result[2]));

		case "mpd":
		case "mergedPerDevice":
			if (options && options.nonRefCountedOnly) this.logger.throwError("getSignalByName: Cannot get merged per device signal named: '" + name + "' as called with nonRefCountedOnly option");
			return this.getMergedPerDeviceSignal(result[2]);

		case "lpdrc":
		case "localPerDeviceRefCount":
			return wrap(this.localPerDeviceRefCountSignalMap.getSignal(result[2]));

		case "mpdrc":
		case "mergedPerDeviceRefCount":
			if (options && options.nonRefCountedOnly) this.logger.throwError("getSignalByName: Cannot get merged per device ref-count signal named: '" + name + "' as called with nonRefCountedOnly option");
			return this.getMergedPerDeviceRefCountSignal(result[2]);

		default:
			this.logger.throwError("getSignalByName: Unknown signal name class: '" + result[1] + "' for name: '" + name + "'");
	}
};

/**
 * Set signal value by name
 * The name is comprised of a type prefix, followed by /, followed by the type-specific key
 *
 * Supported signal types include:
 *
 * | Short prefix | Long prefix       | Class                  | Written using                                     |
 * | ------------ | ----------------- | ---------------------- | ------------------------------------------------- |
 * | l            | local             | Local                  | {@link DMAppController#localSignalMap}            |
 * | s            | shared            | Shared                 | {@link DMAppController#setSharedSignal}           |
 * | lpd          | localPerDevice    | Local per-device       | {@link DMAppController#localPerDeviceSignalMap}   |
 *
 * @param {string} name Prefix followed by arbitrary string key
 * @param value Value to write to signal
 */
DMAppController.prototype.setSignalByName = function(name, value) {
	const result = /^([^/]+)\/(.+)$/.exec(name);
	if (!result) this.logger.throwError("setSignalByName: Cannot parse signal name: '" + name + "'");

	switch (result[1]) {
		case "l":
		case "local":
			return this.localSignalMap.getSignal(result[2]).setValue(value);

		case "s":
		case "shared":
			return this.setSharedSignal(result[2], value);

		case "lpd":
		case "localPerDevice":
			return this.localPerDeviceSignalMap.getSignal(result[2]).setValue(value);

		default:
			this.logger.throwError("setSignalByName: Unknown signal name class: '" + result[1] + "' for name: '" + name + "'");
	}
};

/**
 * Write into signal value at path
 * The name is comprised of a type prefix, followed by /, followed by the type-specific key
 *
 * Supported signal types include:
 *
 * | Short prefix | Long prefix       | Class                  | Written using                                     |
 * | ------------ | ----------------- | ---------------------- | ------------------------------------------------- |
 * | l            | local             | Local                  | {@link DMAppController#localSignalMap}            |
 * | s            | shared            | Shared                 | {@link DMAppController#setSharedSignal}           |
 * | lpd          | localPerDevice    | Local per-device       | {@link DMAppController#localPerDeviceSignalMap}   |
 *
 * @param {string} name Prefix followed by arbitrary string key
 * @param {!Array.<string>} path Array of path elements
 * @param value Value to write into signal at given path
 */
DMAppController.prototype.setSignalByNameAtPath = function(name, path, value) {
	const result = /^([^/]+)\/(.+)$/.exec(name);
	if (!result) this.logger.throwError("setSignalByNameAtPath: Cannot parse signal name: '" + name + "'");

	const update = function(signal) {
		signal.setValue(MiscUtil.cloneWithWriteAtPath(signal.getValue(), path, value));
	};

	switch (result[1]) {
		case "l":
		case "local":
			return update(this.localSignalMap.getSignal(result[2]));

		case "s":
		case "shared":
			return this.setSharedSignalAtPath(result[2], path, value);

		case "lpd":
		case "localPerDevice":
			return update(this.localPerDeviceSignalMap.getSignal(result[2]));

		default:
			this.logger.throwError("setSignalByNameAtPath: Unknown signal name class: '" + result[1] + "' for name: '" + name + "'");
	}
};

/**
 * Set signal value to be the evaluation of an expression string evaluated using [expr-eval]{@link https://www.npmjs.com/package/expr-eval}
 *
 * This includes the following extra constants and functions:
 *
 * Constants:
 * * Infinity
 * * NaN
 *
 * Functions:
 * * definedOr(...) Returns the first non-null and non-NaN of its arguments, or the last argument. If there are no arguments, returns null.
 * * member(obj, ...) Starting with the first argument, successively dereference the object member named by the 2nd to nth arguments. Returns null if cannot dereference (not an object).
 * * signal(name) Get the value of the named signal using {@link DMAppController#getSignalByName}. Only non ref-counted signals are permitted (nonRefCountedOnly option). Signal event subscriptions are handled automatically.
 *
 * @param {!Signal.SettableSignal} signal Signal to set (using {@link Signal.SettableSignal#setSignalTransform})
 * @param {!string} expression Expression evaluated using [expr-eval]{@link https://www.npmjs.com/package/expr-eval}
 * @param {object=} vars Optional object defining variables usable in the expression
 */
DMAppController.prototype.setExpressionSignal = function(signal, expression, vars) {
	const self = this;
	const exp = exprParser.parse(expression);
	signal.setSignalTransform([], function(signalSet, subscribeTransient) {
		return self._intlEvaluateExpression(expression, exp, subscribeTransient, vars);
	});
};

/**
 * Return result of the evaluation of an expression string evaluated using [expr-eval]{@link https://www.npmjs.com/package/expr-eval}
 *
 * This includes the following extra constants and functions:
 *
 * Constants:
 * * Infinity
 * * NaN
 *
 * Functions:
 * * definedOr(...) Returns the first non-null and non-NaN of its arguments, or the last argument. If there are no arguments, returns null.
 * * member(obj, ...) Starting with the first argument, successively dereference the object member named by the 2nd to nth arguments. Returns null if cannot dereference (not an object).
 * * signal(name) Get the value of the named signal using {@link DMAppController#getSignalByName}. Only non ref-counted signals are permitted (nonRefCountedOnly option). No subscriptions or event listeners are applied to the signal.
 *
 * @param {!string} expression Expression evaluated using [expr-eval]{@link https://www.npmjs.com/package/expr-eval}
 * @param {object=} vars Optional object defining variables usable in the expression
 * @returns result Result of executing the expression
 */
DMAppController.prototype.evaluateExpression = function(expression, vars) {
	return this._intlEvaluateExpression(expression, exprParser.parse(expression), null, vars);
};

DMAppController.prototype._intlEvaluateExpression = function(expression, parsedExpression, subscribeTransient, vars) {
	const self = this;
	try {
		let params = {
			Infinity: Infinity,
			NaN: NaN,
			definedOr: function() {
				for (let i = 0; i < arguments.length - 1; i++) {
					if (arguments[i] != null && !Number.isNaN(arguments[i])) return arguments[i];
				}
				return arguments.length ? arguments[arguments.length - 1] : null;
			},
			member: function(obj) {
				for (let i = 1; i < arguments.length; i++) {
					if (obj && typeof obj === "object") {
						obj = obj[arguments[i]];
					} else {
						return undefined;
					}
				}
				return obj;
			},
			signal: function(name) {
				if (arguments.length !== 1 || typeof name !== "string") throw new Error("signal: expected 1 string argument");
				const s = self.getSignalByName(name, { nonRefCountedOnly: true });
				if (subscribeTransient) subscribeTransient(s.signal);
				return s.signal.getValue();
			},
		};
		if (vars) $.extend(params, vars);
		return parsedExpression.evaluate(params);
	} catch(e) {
		self.logger.warn("setExpressionSignal: Error evaluating expression: `" + expression + "`, " + e);
		return null;
	}
};

/**
 * Analytics event
 *
 * This issues or queues an analytics event if {@link DMAppController#analyticsEnabled} is true.
 *
 * If an analytics handler is set in {@link DMAppController#setAnalyticsHandler}, the handler is called.
 * Otherwise the event is queued until an analytics handler is set.
 *
 * @param {!string} eventCategory
 * @param {!string} eventAction
 * @param {string=} eventLabel
 * @param {number=} eventValue (non-negative integer)
 */
DMAppController.prototype.analyticsEvent = function(eventCategory, eventAction, eventLabel, eventValue) {
	if (this.analyticsEnabled.getValue()) {
		const args = [].slice.call(arguments);
		if (eventValue != null && (!Number.isSafeInteger(eventValue) || eventValue < 0)) {
			this.logger.warn("eventValue must be positive integer in analyticsEvent:", args);
		}
		if (this._analyticsHandler) {
			this._analyticsHandler.apply(null, args);
		} else {
			this._analyticsQueue.push(args);
		}
	}
};

/**
 * Analytics handler callback
 *
 * @callback DMAppController~AnalyticsHandler
 * @param {!string} eventCategory
 * @param {!string} eventAction
 * @param {string=} eventLabel
 * @param {number=} eventValue (non-negative integer)
 */

/**
 * Set analytics event handler
 *
 * See {@link DMAppController#analyticsEvent}
 *
 * @param {?DMAppController~AnalyticsHandler} key Analytics handler callback, or null
 */
DMAppController.prototype.setAnalyticsHandler = function(handler) {
	this._analyticsHandler = handler;
	if (this._analyticsHandler) {
		for (let i = 0; i < this._analyticsQueue.length; i++) {
			this._analyticsHandler.apply(null, this._analyticsQueue[i]);
		}
		this._analyticsQueue.length = 0;
	}
};

DMAppController.prototype.setupDumpDebugEvents = function(listenerTracker, func) {
	listenerTracker.subscribeTo(this._modeSignal).on("change", func);
	listenerTracker.subscribeTo(this._devDialogLogSignal).on("change", func);
	listenerTracker.subscribeTo(this.localDevGroupErrorSummary).on("change", func);
	listenerTracker.subscribeTo(this.analyticsEnabled).on("change", func);
	for (let prop in this.errorSignals) {
		listenerTracker.subscribeTo(this.errorSignals[prop]).on("change", func);
	}
	listenerTracker.subscribeTo(this).on("_sharedStateDebugChange", func);
};

DMAppController.prototype.dumpDebugInfo = function(dumper) {
	dumper.keyValue("Version", require('__VERSION__'));
	dumper.keyValue("Feature versions", require('./FeatureVersions').dumpString());
	dumper.keyValue("Instance ID", this.instanceId);
	dumper.keyValue("Device ID", this.getDeviceId());
	dumper.keyValue("Session ID", this.sessionId);
	if (this._modeSignal.getValue() !== undefined) {
		dumper.keyValue("Mode Signal", JSON.stringify(this._modeSignal.getValue()));
	}

	dumper.keyValue("Device ID prefix", this.deviceIdPrefix);
	dumper.keyValue("Device ID namespace", this.deviceIdNamespace);
	dumper.keyValue("Make new device ID", !!this.makeNewDeviceId);
	dumper.keyValue("Default log level", Logger.getLevelDescription(this.defaultLogLevel));
	dumper.keyValue("Network log level", Logger.getLevelDescription(this.networkLogLevel));
	dumper.keyValue("Concatenate log arguments", !!this.concatLogArgs);
	dumper.keyValue("Long-form console logging", !!this.longFormConsoleLogging);
	dumper.keyValue("Single instance mode", !!this.singleInstance);
	dumper.keyValue("Show user error message UI", !!this.showUserErrorMessageUI);
	dumper.keyValue("Show dev error message UI", !!this._devDialogLoggingSetup);
	dumper.keyValue("Log errors on window object", !!this.logWindowErrors);
	dumper.keyValue("Have service AJAX credentials", !!this.serviceAjaxCredentials);
	if (this.advDebugMode) dumper.keyValue("Adv debug mode", !!this.advDebugMode);
	const userErrors = [];
	const devErrors = [];
	for (let prop in this.errorSignals) {
		const err = this.errorSignals[prop];
		if (!err.getValue()) continue;
		if (err.modes & ErrorUtil.ErrorMode.DEV) {
			devErrors.push(err.msg);
		}
		if (err.modes & ErrorUtil.ErrorMode.USER) {
			userErrors.push(err.msg + ": (" + this.userErrorTexts[err.msg] + ")");
		}
	}
	if (userErrors.length) dumper.keyValue("User error signals", userErrors.join("\n"));
	if (devErrors.length) dumper.keyValue("Dev error signals", devErrors.join("\n"));
	const devDialogLogs = this._devDialogLogSignal.getValue().map(function(item) {
		return item.methodName + ": " + item.text;
	});
	if (devDialogLogs.length) dumper.keyValue("Dev dialog messages", devDialogLogs.join("\n"));

	const localDevGroupErrs = this.localDevGroupErrorSummary.getValue();
	if (localDevGroupErrs && !$.isEmptyObject(localDevGroupErrs)) {
		const cat = dumper.subcategory("Local device group error summary");
		for (let prop in localDevGroupErrs) {
			const subcat = cat.subcategory(prop);
			const errs = localDevGroupErrs[prop];
			for (let i = 0; i < errs.length; i++) {
				subcat.value(JSON.stringify(errs[i]));
			}
		}
	}
	if (this._sharedStateDebugDumpFuncs.size) {
		const subcat = dumper.subcategory("Shared State", false);
		for (let f of this._sharedStateDebugDumpFuncs.values()) {
			f(subcat);
		}
	}
	dumper.keyValue("Analytics enabled", this.analyticsEnabled.getValue());
	dumper.checkboxOption("Mute all", this.muteAll);
	if (this.initStickyDefaultClockWallclockRelative != null) dumper.keyValue("Sticky def. clock wallclock relative", Number(this.initStickyDefaultClockWallclockRelative));
};

DMAppController.prototype.setupDumpDebugSignalEvents = function(listenerTracker, func) {
	listenerTracker.subscribeTo(this).on("_signalDebugDumpUpdate", func);
};

DMAppController.prototype.dumpDebugSignalInfo = function(dumper) {
	const self = this;
	dumper.stringInput("Prefixed signal name", function(text) {
		const signal = self.getSignalByName(text, { unrefFuncNullable: true }).signal;
		signal.on("change", self.emit.bind(self, "_signalDebugDumpUpdate"));
		self._debugDumpSignals.push({
			name: text,
			signal: signal,
		});
		self.emit("_signalDebugDumpUpdate");
	}, "", "Track signal");
	for (let i = 0; i < self._debugDumpSignals.length; i++) {
		const info = self._debugDumpSignals[i];
		dumper.keyValue(info.name, JSON.stringify(info.signal.getValue(), null, 2));
	}
};

DMAppController.prototype.dumpServiceUrlDebugInfo = function(dumper) {
	for (let prop in DMAppController.serviceUrlPresets) {
		if (nanoEqual(DMAppController.serviceUrlPresets[prop], this._urls)) {
			dumper.keyValue("Preset", prop);
		}
	}
	for (let prop in this._urls) {
		const prop_fmt = prop.replace(/([A-Z])/g, ' $1').replace(/^./, function(str) { return str.toUpperCase(); });
		dumper.keyValue(prop_fmt, this.getUrl(prop));
	}
};

DMAppController.prototype.dumpDebugSummaryPromise = function(dumper) {
	const self = this;
	dumper.componentContainer(self.layout.componentContainer, "Components:", false);

	self.dumpDebugInfo(dumper.subcategory("Controller:", false));
	self.layout.dumpDebugInfo(dumper.subcategory("Layout:", false));

	const clockCat = dumper.subcategory("Clocks:", false);
	const clocks = self.timeline.enumerateClocks();
	for (let i = 0; i < clocks.length; i++) {
		self.timeline.dumpClockInfo(clocks[i].clock, clockCat.subcategory(clocks[i].name, false), true, true);
	}

	if (self.timeline._interContextSyncCtl) self.timeline._interContextSyncCtl.dumpDebugInfo(dumper.subcategory("Inter-Context Sync:", false));
	self.timeline.dumpDebugInfo(dumper.subcategory("Timeline:", false));
	self.layout.dumpDMAppDebugInfo(dumper.subcategory("DMApp:", false));
	self.dumpServiceUrlDebugInfo(dumper.subcategory("Service URLs:", false));
	self.dumpDebugSignalInfo(dumper.subcategory("Signals:", false));
	return Promise.resolve();
};

DMAppController._debugConstructorHooks = [];

try {
	Object.freeze(DMAppController.prototype);
	Object.freeze(DMAppController.serviceUrlPresets);
	for (let prop in DMAppController.serviceUrlPresets) {
		Object.freeze(DMAppController.serviceUrlPresets[prop]);
	}
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppController;
