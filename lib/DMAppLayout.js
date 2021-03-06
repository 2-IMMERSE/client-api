/************************************************************************/
/* FILE:                DMAppLayout.js                                  */
/* DESCRIPTION:         DMApp layout                                    */
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

const Promise = require('promise');
const $ = require("jquery");
const inherits = require('inherits');
const nanoEqual = require('nano-equal');

const SafeEventEmitter = require('./SafeEventEmitter');
const DMAppComponentWrapper = require('./DMAppComponentWrapper');
const DMAppComponentBehaviour = require('./DMAppComponentBehaviour');
const ExecValve = require('./ExecValve');
const waitable = require('./waitable');
const Signal = require('./Signal');
const argCheck = require('./argCheck');
const DMAppLayoutUtil = require('./DMAppLayoutUtil');
const DMAppLayoutIO = require('./DMAppLayoutIO');
const DebugMiscUtil = require('./DebugMiscUtil');
const RefCountedSignalMap = require('./RefCountedSignalMap');

/**
 * Layout service DMApp component RAML
 * @typedef {Object} Layout_RAML_DMAppComponent
 * @see api/types/dmapp-component.raml (and api/layout-service.raml) in the layout service repository.
 */

/**
 * @classdesc
 *
 * Handles Layout functionality.
 * This should not be directly constructed. Use: {@link DMAppController#layout}.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {DMAppController} dMAppController parent controller
 */
function DMAppLayout(dMAppController) {
	Object.defineProperties(this, {
		dMAppController:      { value: dMAppController },
		_componentUrlMap:     { value: new Map() },
		_componentTsMap:      { value: new Map() },
		logger:               { value: dMAppController.createNamedLogger("DMAppLayout") },
		_statusUpdateValve:   { value: new ExecValve() },
		_startedWaitable:     { value: waitable() },
		_contextIdSignal:     { value: new Signal.SettableSignal(undefined) },
		_dmAppIdSignal:       { value: new Signal.SettableSignal(undefined) },
		_interCtxIdSignal:    { value: new Signal.SettableSignal(null) },
		_wsState:             { value: {} },
		_componentUrlTransforms:        { value: [] },
		_componentTypeNameTransforms:   { value: [] },
		_activeDMAppJoins:    { value: new Signal.RefCountSignal() },
		_pendingCrInits:      { value: new Set() },
	});
	let self = this;
	if (dMAppController.advDebugMode) {
		self = DebugMiscUtil.makeObjectNonexistentPropertyTrapProxy(this, this.logger, "DMAppLayout", ['_lastWsUpdateMessageDedup', '_connFailDbg', '_staticLayoutCaps', '_componentSignalMap']);
	}
	Object.defineProperties(this, {
		componentContainer:   { value: new DMAppLayoutUtil.ComponentContainer(this, this.logger) },
		componentDebouncer:   { value: new DMAppLayoutUtil.ComponentDebouncer(self) },
		contextId:            { get: function () { return this._contextIdSignal.getValue(); } },
		dmAppId:              { get: function () { return this._dmAppIdSignal.getValue(); } },
		interContextId:       { get: function () { return this._interCtxIdSignal.getValue(); } },
		contextIdSignal:      { value: new Signal.ConstWrapperSignal(this._contextIdSignal) },
		dmAppIdSignal:        { value: new Signal.ConstWrapperSignal(this._dmAppIdSignal) },
		interContextIdSignal: { value: new Signal.ConstWrapperSignal(this._interCtxIdSignal) },
		layoutRegionCtl:      { value: new DMAppLayoutUtil.DMAppLayoutRegionCtl(this) },
	});
	Object.defineProperties(this, {
		io:                   { value: new DMAppLayoutIO(self, self.logger, { autoRetry: true }) },
	});
	const ctxStatusValveBlockCtlSignal = new Signal.SettableSignal();
	ctxStatusValveBlockCtlSignal.setSignalTransform([this._contextIdSignal, this._dmAppIdSignal], function() {
		return this.contextId != null && this.dmAppId == null;
	}.bind(this));
	ctxStatusValveBlockCtlSignal.addOutputBlockable(this._statusUpdateValve);

	this.postComponentStatuses = true;
	this.batchComponentStatuses = true;
	this.debounceLayoutUpdates = true;
	this.newContextPercentCoords = false;

	this._wsState.debugStatus = "No initial connection yet";

	const style = '.immerse2-layout-component-hidden { display: none !important; }';
	$('<style>' + style + '</style>').appendTo(document.head);

	this.createAndJoinContext = this.io.createAndJoinContext.bind(this.io);
	this.loadDmApp = this.io.loadDmApp.bind(this.io);
	this.tryLeaveAndDestroyContext = this.io.tryLeaveAndDestroyContext.bind(this.io);

	['createdComponent', 'destroyingComponent', 'destroyedComponent'].map(function(ev) {
		self.componentContainer.on(ev, self.emit.bind(self, ev)); // copy container events to main layout
	});

	this.contextObj = undefined;
	this.dmAppObj = undefined;
	return self;
}

inherits(DMAppLayout, SafeEventEmitter);

/** @member {DMAppController} DMAppLayout#dMAppController parent controller */
/** @member {boolean} DMAppLayout#postComponentStatuses Whether to POST component status updates to the Layout service (default: true), this should only be disabled in Special Circumstances */
/** @member {boolean} DMAppLayout#batchComponentStatuses Whether to batch component status updates which are POSTed to the Layout service (default: true) */
/** @member {boolean} DMAppLayout#debounceLayoutUpdates Whether to de-bounce layout updates (default: true) */
/** @member {boolean} DMAppLayout#failedComponentPlaceholderMode Whether to replace failed components with a place-holder (default: false) */
/** @member {Logger} DMAppLayout#logger logger for this instance */
/** @member {DMAppLayoutRegionCtl} DMAppLayout#layoutRegionCtl layout region controller for this instance */
/** @member {DMAppLayoutIO} DMAppLayout#io default layout and related services network IO functionality handler for this instance */
/** @member {boolean} DMAppLayout#newContextPercentCoords whether newly created contexts should be configured with percentCoords=true, (default: false) */
/** @member {ComponentContainer} DMAppLayout#componentContainer root layout component container */

/** @member {?string} DMAppLayout#contextId current Context ID */
/** @member {Signal.BaseSignal.<?string>} DMAppLayout#contextIdSignal current Context ID (read-only signal) */
/** @member {?Object} DMAppLayout#contextObj current Context object */
/** @member {?string} DMAppLayout#dmAppId current DMApp ID */
/** @member {Signal.BaseSignal.<?string>} DMAppLayout#dmAppIdSignal current DMApp ID (read-only signal) */
/** @member {?Object} DMAppLayout#dmAppObj current DMApp object */
/** @member {?string} DMAppLayout#interContextId current inter-context ID */
/** @member {Signal.BaseSignal.<?string>} DMAppLayout#interContextIdSignal current inter-context ID (read-only signal) */

/**
 * Component constructor factory, this is nominally user-replaceable.
 * Any replacement must match the original behaviour.
 *
 * @prop {Function} build Construct component and forwards arguments to initDMAppComponent
 */
DMAppLayout.prototype.componentFactory = {
	build: function(aux, dMAppController, id, typeName, config) /* -> DMAppComponent */ {
		const origTypeName = typeName;
		const filters = dMAppController.layout._componentTypeNameTransforms;
		for (let i = 0; i < filters.length; i++) {
			typeName = filters[i](typeName);
		}
		if (typeName !== origTypeName) {
			dMAppController.layout.logger.info("componentFactory.build: filter transform: " + origTypeName + " --> " + typeName);
		}
		let component;
		const constructor = dMAppController.dMAppComponentTypes[typeName];
		if (constructor) {
			try {
				component = new constructor(dMAppController);
			} catch(e) {
				if (e instanceof TypeError && e.message.match(/This constructor should be called without arguments/i)) {
					component = new constructor();
				} else {
					throw e;
				}
			}
			if (!dMAppController.layout.looksLikeValidComponent(component)) {
				dMAppController.layout.logger.throwError("componentFactory: Failed to construct component type: '" +
						typeName + "' as return value of constructor doesn't look like a component");
			}
		} else {
			if (/^[-0-9a-z]+$/i.test(typeName) && /[0-9a-z]-+[0-9a-z]/i.test(typeName)) {
				// This looks like a custom element name
				const elem = document.createElement(typeName);
				if (dMAppController.layout.looksLikeValidComponent(elem)) {
					component = elem;
				} else if (elem.constructor !== window.HTMLElement && elem.constructor !== window.HTMLUnknownElement) {
					component = new DMAppComponentWrapper(elem, dMAppController);
				} else {
					dMAppController.layout.logger.throwError("componentFactory: Failed to construct component type: '" +
							typeName + "' as no constructor is defined, and it doesn't look like a registered custom element");
				}
			} else {
				dMAppController.layout.logger.throwError("componentFactory: Failed to construct component type: '" +
						typeName + "' as no constructor is defined, and it doesn't look like a custom element");
			}
		}
		if (typeName !== origTypeName) {
			Object.defineProperty(component, '_originalDMAppComponentTypeName', { value: origTypeName });
		}
		if (aux.componentContainer) {
			aux.componentContainer.emit("_preComponentInit", {
				id: id,
				typeName: typeName,
				component: component,
			});
		}
		component.initDMAppComponentEx.apply(component, arguments);
		return component;
	},
};

/**
 * Check whether the input looks like a valid {@link DMAppComponent}
 *
 * @param component Candidate component to check
 * @returns {boolean} True if it looks a valid {@link DMAppComponent}
 */
DMAppLayout.prototype.looksLikeValidComponent = function(component) {
	if (!component) return false;
	try {
		for (let prop in DMAppComponentBehaviour) {
			if (!component[prop] || typeof component[prop] !== typeof DMAppComponentBehaviour[prop]) {
				return false;
			}
		}
	} catch(e) {
		return false;
	}
	return true;
};

/**
 * Orientation controller, this is stubbed and user-replaceable
 * @prop {Function} getOrientation Get  current orientation string
 * @prop {Function} getAvailableOrientations Get array enumeration of orientation strings
 */
DMAppLayout.prototype.orientationController = {

	getOrientation: function() /* -> Promise<orientation string> */ {
		return "portrait";
	},

	getAvailableOrientations: function() /* -> Promise<array of orientation strings> */ {
		return ["portrait", "landscape"];
	},

};

/** Get Layout capabilities
 * @returns {Caps}
 */
DMAppLayout.prototype.getLayoutCaps = function() {
	/* globals AudioContext */
	/* TODO: fill these in with correct caps */
	const self = this;

	if (!self._staticLayoutCaps) {
		let maxChannelCount = 0;
		try {
			const context = new AudioContext();
			maxChannelCount = context.destination.maxChannelCount;
		} catch (e) {
			self.logger.info("Failed to get number of audio channels");
			try {
				const audio = new Audio();
				if (typeof audio.canPlayType === "function") {
					maxChannelCount = 1;
				}
			} catch (e) {

			}
		}

		Object.defineProperty(self, '_staticLayoutCaps', { value: {
			audioChannels: maxChannelCount,
			concurrentVideo: 0,
			orientations: self.orientationController.getAvailableOrientations(),
			communalDevice: false,
			deviceType: 'generic',
			touchInteraction: (('ontouchstart' in window) || (navigator.MaxTouchPoints > 0)),
		}});
	}

	let root_elem = self.layoutRegionCtl.getNamedLayoutRegionElement(null);
	if (root_elem === document.body) root_elem = window;

	let caps = {
		displayWidth: Math.round($(root_elem).width()),
		displayHeight: Math.round($(root_elem).height()),
	};
	$.extend(caps, self._staticLayoutCaps);
	if (self._capsOverride) {
		$.extend(caps, self._capsOverride);
	}
	return caps;
};

DMAppLayout.prototype._getProps = function() /* -> Promise<{ caps: Caps, deviceId: device ID string, orientation: orientation string }> */ {
	return Promise.resolve({ caps: this.getLayoutCaps(), deviceId: this.dMAppController.getDeviceId(), orientation: this.orientationController.getOrientation() });
};

DMAppLayout.prototype._executeLayoutMsg = function(id, type, body) {
	const self = this;
	this.logger.debug("Executing layout message: " + id + ", type: " + type + ", body: ", body);

	const timestamp = body.timestamp;

	const devErr = function(prop, msg) {
		if (!self[prop]) {
			self[prop] = true;
			self.dMAppController.devDialogLogger.warn(msg + " This message will only be shown once. See log for further detail.");
		}
	};

	const checkBody = function(msg) {
		if (!msg || typeof msg !== "object") {
			self.logger.warn(type + " message body is missing or not an object, ignoring. Message body: ", msg);
			devErr('_haveLoggedDevLogMsgFieldMissingErr', "Websockets push message body is missing or not an object.");
			return false;
		}
		if (!msg.contextId || !msg.DMAppId) {
			self.logger.warn("contextId or DMAppID missing in " + type + " message body. This may result in undefined behaviour. Message body: ", msg);
			devErr('_haveLoggedDevLogMsgFieldMissingErr', "contextId or DMAppID field missing in websockets push message body. This may result in undefined behaviour.");
		}
		return true;
	};

	if (type !== "update") delete this._lastWsUpdateMessageDedup;
	if (type === "create") {
		for (let i = 0; i < body.components.length; i++) {
			if (!checkBody(body.components[i])) continue;
			this._handleComponentInfo(body.components[i], timestamp, { creationOk: true, requirePrefix: true, fromService: true });
		}
	} else if (type === "update") {
		if (nanoEqual(this._lastWsUpdateMessageDedup, body)) {
			this.logger.warn("Received a duplicate layout update: ignoring");
			return;
		}
		this._lastWsUpdateMessageDedup = body;
		for (let i = 0; i < body.components.length; i++) {
			if (!checkBody(body.components[i])) continue;
			this._handleComponentInfo(body.components[i], timestamp, { requirePrefix: true, fromService: true });
		}
	} else if (type === "destroy") {
		for (let i = 0; i < body.components.length; i++) {
			if (!checkBody(body.components[i])) continue;
			const idPrefix = '/' + body.components[i].contextId + '/' + body.components[i].DMAppId + '/';
			const res = this._handleComponentUpdateIntl(body.components[i], timestamp, idPrefix);
			if (!res.ok) continue;
			const cr = res.cr;
			if (cr && (cr.failed || body.components[i].stopTime == null)) {
				// component has failed, or no stop time was given, so we can destroy it immediately
				this.logger.info("Layout destroy message: requesting immediate destruction for: " + idPrefix + body.components[i].componentId);
				this.requestRemoveDMAppComponentById(idPrefix + body.components[i].componentId);
			} else if (cr && !cr.failed) {
				cr.enqueue(function(comp) {
					cr.setComponentInfo($.extend({}, comp.dMAppComponentInfo, { stopTime: body.components[i].stopTime }), res.timestamp);
					comp.setSelfDestructOnStop(true);
					comp.setSelfDestructBeforeStart(true);
				}).catch(this.logger.deferredConcat('warn', "Failed to set component self destruction on stop"));
			}
		}
	} else {
		this.logger.warn("Unexpected layout message type, ignoring: " + id + ", type: " + type + ", body: ", body);
	}
};

DMAppLayout.prototype._handleLayoutMsg = function(msg) {
	for (const type in msg) {
		const body = msg[type];
		if (!body || typeof body !== 'object') {
			this.logger.warn(type + " message is not an object ignoring: ", msg);
			continue;
		}
		const id = body.messageId;
		if (id == null) {
			this.logger.warn(type + " message does not have an id field, ignoring: ", msg);
			continue;
		}
		if (!body.components || !Array.isArray(body.components)) {
			this.logger.warn(type + " message components field is missing or not an array, ignoring: ", msg);
			continue;
		}
		if (body.deviceId !== this.dMAppController.getDeviceId()) continue;
		this._executeLayoutMsg(id, type, body);
	}
};

DMAppLayout.prototype._shouldApplyRestLayout = function() /* -> bool */ {
	return true;
};

/**
 * Context change event.
 *
 * @event DMAppLayout#contextChange
 * @type {object}
 * @property {?string} previousContextId Previous Context ID
 * @property {?Object} previousContext Previous Context object
 * @property {?string} newContextId New Context ID
 * @property {?Object} newContext New Context object
 */

DMAppLayout.prototype._checkUpdateComponentTimestamp = function(componentId, timestamp, name) {
	if (timestamp === Infinity) return true;
	if (!name) name = "update";
	if (timestamp == null) {
		this.logger.warn("Received " + name + " for component: '" + componentId + "' with no timestamp: ignoring");
		return false;
	}
	const prevTs = this._componentTsMap.get(componentId);
	if (prevTs == null || timestamp >= prevTs) {
		this._componentTsMap.set(componentId, timestamp);
		return true;
	} else {
		this.logger.debug("Received " + name + " for component: '" + componentId + "' with timestamp prior to previous: ignoring: delta: " + (timestamp - prevTs));
		return false;
	}
};

DMAppLayout.prototype._isComponentForCurrentDevice = function(c, fixup_layout) /* -> bool */ {
	if (c.deviceId && c.deviceId !== this.dMAppController.getDeviceId()) return false;

	if (Array.isArray(c.layout)) {
		for (let i = 0; i < c.layout.length; i++) {
			if (c.layout[i] === null) {
				if (fixup_layout) c.layout = null;
				this.logger.warn("Received null layout for component: " + c.componentId + ", assuming that it is for this device");
				return true;
			}
			if (!c.layout[i] || typeof c.layout[i] !== "object") {
				this.logger.warn("Received unexpected inner layout type for component: " + c.componentId + ", ignoring");
				continue;
			}
			if (c.layout[i].instanceId && !c.layout[i].deviceId) {
				// Assuming that layout is for this device
				if (fixup_layout) c.layout = c.layout[i];
				return true;
			}
			if (c.layout[i].deviceId === this.dMAppController.getDeviceId()) {
				if (fixup_layout) c.layout = c.layout[i];
				return true;
			}
		}
		return false;
	}
	return true;
};

DMAppLayout.prototype._handleComponentUpdateIntl = function(c, timestamp, idPrefix) /* -> { cr: ComponentRef, timestamp: timestamp } or null/undef */ {
	if (!this._isComponentForCurrentDevice(c, true)) return { ok: false };

	if (c.layout && c.layout.timestamp) {
		if (!timestamp) {
			timestamp = c.layout.timestamp;
		}
		delete c.layout.timestamp;
	}

	const path = idPrefix ? (idPrefix + c.componentId) : c.componentId;
	let cr = this.componentContainer.getComponentRefById(path);
	if (cr && cr.masqueradeDestroyed) cr = null;

	if (!this._checkUpdateComponentTimestamp(path, timestamp)) return { ok: false, cr: cr, creatable: true };

	return { ok: true, cr: cr, timestamp: timestamp };
};

DMAppLayout.prototype._handleComponentInfo = function(c, timestamp, options) /* -> ComponentRef */ {
	const self = this;
	if (!options) options = {};
	argCheck(arguments, 3, self.logger, "_handleComponentInfo", options, ['contextId', 'dmAppId', 'creationOk', 'requirePrefix', 'fromService']);
	let contextId = options.contextId;
	let dmAppId = options.dmAppId;
	if (!contextId && c.contextId) contextId = c.contextId;
	if (!dmAppId && c.DMAppId) dmAppId = c.DMAppId;
	const idPrefix = (contextId && dmAppId) ? '/' + contextId + '/' + dmAppId + '/' : '';
	if (options.requirePrefix && !idPrefix) {
		self.logger.deferredConcat('error', "Failed to determine component ID prefix in _handleComponentInfo in case where ID prefix marked as required. Arguments: ").apply(null, arguments);
		return;
	}
	const id = idPrefix + c.componentId;
	const type = c.config ? c.config.class : null;
	if (c.startTime === undefined && options.fromService) c.startTime = null;
	if (c.stopTime === undefined && options.fromService) c.stopTime = null;
	const res = this._handleComponentUpdateIntl(c, timestamp, idPrefix);
	let cr = res.cr;
	timestamp = res.timestamp;

	if (!res.ok) {
		if (res.creatable && options.creationOk && cr && cr.speculative) {
			this.logger.debug("Despeculatively creating component: " + c.componentId + " of type " + type);
			cr.markCreating();
			this._constructComponentCreateIntl(cr, c, type, timestamp);
		}
		return;
	}

	const setupCr = function(cr) {
		cr.contextId = contextId || null;
		cr.dmAppId = dmAppId || null;
		cr.componentId = c.componentId;
	};
	if (cr) setupCr(cr);

	const makeNewCr = function() {
		if (self.componentContainer.hasComponentId(id)) {
			self.logger.info("Removing component: " + c.componentId + " for immediate replacement by a newly created component");
			self.removeDMAppComponentById(id);
		}
		cr = self._makeComponentRef(id);
	};

	const enqueueSetComponentInfo = function(crp) {
		crp.enqueue(
			function(comp) {
				crp.setComponentInfo(c, timestamp);
			},
			"_handleComponentInfo: setComponentInfo"
		).catch(self.logger.deferredConcat('error', "Failed to set component info"));
	};

	if (cr && cr.failed) {
		return cr;
	}

	if (cr && cr.creating) {
		enqueueSetComponentInfo(cr);
	} else if (options.creationOk && type) {
		this.logger.debug("Creating component: " + c.componentId + " of type " + type);
		if (!cr) {
			makeNewCr();
			setupCr(cr);
		}
		cr.markCreating();
		this._constructComponentCreateIntl(cr, c, type, timestamp);
	} else if (type) {
		if (!cr) {
			makeNewCr();
			setupCr(cr);
			cr.markSpeculative();
		}
		enqueueSetComponentInfo(cr);
		self.logger.debug("Speculative component update request for not yet existent component: " + c.componentId + " of type " + type, c);
	}
	return cr;
};

DMAppLayout.prototype._constructComponentCreateIntl = function(cr, c, type, timestamp, aux) {
	const self = this;
	if (!aux) aux = {};
	if (c.config.revision != null) {
		aux.revision = c.config.revision;
		cr.setRevisionNumber(c.config.revision);
	}
	if (c.config.url) {
		this.io.loadComponentFromUrl(c.config.url).then(function(load_info) {
			if (cr.destroyed) {
				self.logger.debug("Aborting component construction after HTML loaded, as ComponentRef destroyed: " + c.componentId + " of type " + type);
				return;
			}
			aux.importInfo = load_info;
			self._constructComponentIntl(cr, c, type, timestamp, load_info, aux);
		}).catch(function(err) {
			const reason = "Failed to load URL required to create DMApp component: ";
			self.logger.error(reason, err);
			self._componentConstructionFailure(cr, c, type, timestamp, reason + err);
		});
	} else {
		this._constructComponentIntl(cr, c, type, timestamp, null, aux);
	}
};

DMAppLayout.prototype._constructComponentIntl = function(cr, c, type, timestamp, extra_obj, aux) {
	try {
		const config = {
			layout: c.layout,
			parameters: c.parameters,
			componentId: c.componentId,
		};
		if (cr.contextId) config.contextId = cr.contextId;
		if (cr.dmAppId) config.dmAppId = cr.dmAppId;
		if (extra_obj) $.extend(config, extra_obj);
		const component = this._intlCreateDMAppComponent(aux || {}, cr.id, type, config);
		cr.setComponentInfo(c, timestamp);
		return component;
	} catch (e) {
		const reason = "Failed to create component: '" + c.componentId + "' ('" + cr.id + "') of type '" + type + "'. " + e + " (" + e.stack + ")";
		this.logger.error(reason);
		this._componentConstructionFailure(cr, c, type, timestamp, reason, extra_obj);
	}
	return null;
};

DMAppLayout.prototype._componentConstructionFailure = function(cr, c, type, timestamp, reason, extra_obj) {
	if (this.failedComponentPlaceholderMode && !(extra_obj && extra_obj.hasOwnProperty("fallbackType"))) {
		this._constructComponentIntl(cr, c, "Placeholder", timestamp, { fallbackType: type, fallbackReason: reason });
	} else {
		cr.markFailed(reason);
	}
};

DMAppLayout.prototype._resetLayoutComponents = function(components, timestamp, contextId, dmAppId, requirePrefix, fromService) /* -> void */ {
	const incomingComponentMap = {};
	const idPrefix = (contextId && dmAppId) ? '/' + contextId + '/' + dmAppId + '/' : '';
	for (let i = 0; i < components.length; i++) {
		const c = components[i];
		if (this._isComponentForCurrentDevice(c)) {
			incomingComponentMap[idPrefix + c.componentId] = c;
		}
	}

	/* removed no longer present components */
	for (let [prop, cr] of this.componentContainer.getComponentMap()) {
		if (!incomingComponentMap.hasOwnProperty(prop)) {
			if (cr.isLayoutIndependent()) continue;

			if (this._checkUpdateComponentTimestamp(prop, timestamp, "full-layout implicit destruction update")) {
				this.logger.debug("Erasing component: " + prop);
				this.requestRemoveDMAppComponentById(prop);
			}
		}
	}

	const crs = [];
	for (let i = 0; i < components.length; i++) {
		const c = components[i];
		const cr = this._handleComponentInfo(c, timestamp, { creationOk: true, contextId: contextId, dmAppId: dmAppId, requirePrefix: requirePrefix, fromService: fromService });
		if (cr) crs.push(cr);
	}
	delete this._lastWsUpdateMessageDedup;
	return crs;
};

/**
 * Testing: Load full layout from Layout RAML DMAppComponent component array
 *
 * This method may not be used when connected to a Context/DMApp.
 * Existing components which are not layout-independent are destroyed if not in
 * the component array.
 *
 * @param {Array.<Layout_RAML_DMAppComponent>} components
 */
DMAppLayout.prototype.testResetLayoutComponents = function(components) /* -> void */ {
	if (this.contextId != null) {
		this.logger.throwError("Cannot test reset layout components, part of a context");
	}
	if (this.dmAppId != null) {
		this.logger.throwError("Cannot test reset layout components, DMApp loaded");
	}
	this._resetLayoutComponents(components, Infinity, null);
};

/**
 * Testing: Load component from Layout RAML DMAppComponent component object
 *
 * This method may not be used when connected to a Context/DMApp.
 *
 * @param {Layout_RAML_DMAppComponent} component
 * @param {Object=} options Optional options object
 * @param {boolean=} options.promise Return a promise of the component
 * @returns {(?DMAppComponent|Promise.<DMAppComponent>)} If options.promise is true, returns a promise of the component, otherwise returns the component if it was created immediately or already exists
 */
DMAppLayout.prototype.testCreateLayoutComponent = function(component, options) /* -> void */ {
	argCheck(arguments, 2, this.logger, "testCreateLayoutComponent", options, ['promise']);
	if (this.contextId != null) {
		this.logger.throwError("Cannot test load layout component, part of a context");
	}
	if (this.dmAppId != null) {
		this.logger.throwError("Cannot test load layout component, DMApp loaded");
	}
	const cr = this._handleComponentInfo(component, Infinity, { creationOk: true });
	if (options && options.promise) {
		return cr ? cr.getComponentPromise() : Promise.reject("No component created");
	}
	return cr ? cr.getComponent() : null;
};

/**
 * DMApp change event.
 *
 * @event DMAppLayout#dmAppChange
 * @type {object}
 * @property {?string} previousDMAppId Previous DMApp ID
 * @property {?string} newDMAppId New DMApp ID
 */

DMAppLayout.prototype._handleDmAppId = function(dmAppId) /* -> void */ {
	const previousDMAppId = this.dmAppId;
	if (previousDMAppId !== dmAppId) {
		this._dmAppIdSignal.setValue(dmAppId);
		this.emit('dmAppChange', Object.freeze({
			previousDMAppId: previousDMAppId,
			newDMAppId: this.dmAppId,
		}));
	}
};

DMAppLayout.prototype._handleDmApp = function(dmApp, expectedContextId) /* -> void */ {
	if (dmApp) {
		if (dmApp.DMAppId == null) throw new Error("DMApp has no DMAppId");
		this.dmAppObj = dmApp;
		this._handleDmAppId(dmApp.DMAppId);
		this.dMAppController.errorSignals.contextEjection.clear();
		if (expectedContextId && expectedContextId !== dmApp.contextId) {
			const msg = "Unexpected context ID returned in result of DMApp load operation, got '" + dmApp.contextId + "' instead of '" + expectedContextId + "'";
			this.logger.warn(msg);
			this.dMAppController.devDialogLogger.warn(msg + ". This may result in undefined behaviour.");
		}
	} else {
		this.dmAppObj = undefined;
		this._handleDmAppId(undefined);
	}

	if (this._shouldApplyRestLayout()) {
		const timestamp = dmApp ? dmApp.timestamp : Infinity;
		if (timestamp == null) {
			this.logger.warn("Received REST layout update without a timestamp, this may be racy");
		}
		if (dmApp) {
			this._resetLayoutComponents(dmApp.components, timestamp, dmApp.contextId, dmApp.DMAppId, true, true);
		} else {
			this._resetLayoutComponents([], timestamp, null);
		}
	} else {
		this.logger.info("_shouldApplyRestLayout() returned false, ignoring REST layout update");
	}
};

DMAppLayout.prototype._makeComponentRef = function(id, nameSuffix) /* -> ComponentRef */ {
	return this.componentContainer.makeComponentRef(id, nameSuffix);
};

/**
 * Created component event.
 *
 * @event DMAppLayout#createdComponent
 * @type {object}
 * @property {DMAppComponent} component
 */

/**
 * Locally create a DMApp component, arguments are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * NB: This method is for Special Circumstances and not for creating locally-scoped components within a DMApp.
 * For locally-scoped components, use {@link DMAppComponent#createChildDMAppComponent} instead.
 *
 * @param id This and subsequent parameters are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * @returns {DMAppComponent} DMApp component element
 */
DMAppLayout.prototype.createDMAppComponent = function(id) /* -> DMAppComponent */ {
	const args = [].slice.call(arguments);
	args.unshift({ applyConfig: true });
	return this._intlCreateDMAppComponent.apply(this, args);
};

/**
 * Locally create a DMApp component, arguments are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * @private
 *
 * @param {Object} aux Auxiliary info to pass to componentFactory
 * @param id This and subsequent parameters are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * @returns {DMAppComponent} DMApp component element
 */
DMAppLayout.prototype._intlCreateDMAppComponent = function(aux, id, typeName, config) /* -> DMAppComponent */ {
	const args = [].slice.call(arguments, 1);
	if (!aux.componentContainer) aux.componentContainer = this.componentContainer;
	if (aux.componentContainer === this.componentContainer) {
		aux.rootLayout = this;
	}
	const cr = aux.componentContainer.makeComponentRef(id, "(createDMAppComponent)");
	cr.markCreating();
	if (config && config.revision != null) cr.setRevisionNumber(config.revision);
	try {
		cr.execQueue.block();
		const component = this.componentFactory.build.apply(this.componentFactory, [aux, this.dMAppController].concat(args));
		if (!component._initing || !component._initing2) this.logger.throwError("Component: is not initing as expected (init): " + args.join(", "));
		if (!cr.getComponent()) this.logger.throwError("Component: is not initing as expected (ref): " + args.join(", "));
		aux.componentContainer.registerDMAppComponentPost(id, component);
		cr.execQueue.unblock();
		return component;
	} catch (e) {
		cr.execQueue.unblock();
		throw e;
	}
};

/**
 * Locally create a DMApp component, arguments starting with 'id', are forwarded to initDMAppComponent with the DMAppController prepended.
 * This first loads the specified HTML import URL if specified.
 *
 * @private
 *
 * @param {Object} aux Auxiliary info to pass to componentFactory (this is modified)
 * @param {?string} url Optional HTML import URL to load before constructing component
 * @param id This and subsequent parameters are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * @returns {Promise<DMAppComponent>} DMApp component element
 */
DMAppLayout.prototype._intlCreateDMAppComponentWithUrl = function(aux, url, id, typeName, config) /* -> Promise<DMAppComponent> */ {
	const self = this;
	const initArgs = [].slice.call(arguments, 2);
	const cr = aux.componentContainer.makeComponentRef(id, "(createDMAppComponentWithUrl)");
	cr.markCreating();
	if (config && config.revision != null) cr.setRevisionNumber(config.revision);
	if (url) {
		const p = self.io.loadComponentFromUrl(url).then(function(load_info) {
			if (cr.destroyed) {
				self.logger.throwError("Aborting component construction after HTML loaded, as ComponentRef destroyed: " + id + " of type " + typeName);
			}
			aux.importInfo = load_info;
			return self._intlCreateDMAppComponent.apply(self, [aux].concat(initArgs));
		});
		p.catch(function(err) {
			const reason = "Failed to load URL required to create DMApp component: ";
			self.logger.error(reason, err);
			cr.markFailed(reason + err);
		});
		return p;
	} else {
		return Promise.resolve(self._intlCreateDMAppComponent.apply(self, [aux].concat(initArgs)));
	}
};

/**
 * Locally create a DMApp component, arguments starting with 'id', are forwarded to initDMAppComponent with the DMAppController prepended.
 * This first loads the specified HTML import URL if specified.
 *
 * NB: This method is for Special Circumstances and not for creating locally-scoped components within a DMApp.
 * For locally-scoped components, use {@link DMAppComponent#createChildDMAppComponent} instead.
 *
 * @param {?string} url Optional HTML import URL to load before constructing component
 * @param id This and subsequent parameters are forwarded to initDMAppComponent with the DMAppController prepended.
 *
 * @returns {Promise<DMAppComponent>} DMApp component element
 */
DMAppLayout.prototype.createDMAppComponentWithUrl = function(url, id) /* -> Promise<DMAppComponent> */ {
	return this._intlCreateDMAppComponentWithUrl.apply(this, [{ applyConfig: true }].concat([].slice.call(arguments)));
};

/**
 * Destroying component event.
 *
 * @event DMAppLayout#destroyingComponent
 * @type {object}
 * @property {DMAppComponent} component
 */
/**
 * Destroyed component event.
 *
 * @event DMAppLayout#destroyedComponent
 * @type {object}
 * @property {string} componentId
 */

/**
 * Locally remove a DMApp component
 * @param {string} id DMApp component ID (full/prefixed)
 * @return {boolean} true if component actually removed
 */
DMAppLayout.prototype.removeDMAppComponentById = function(id) /* -> void */ {
	return this.componentContainer.removeDMAppComponentById(id);
};

/**
 * Locally request that a DMApp component remove itself, the component may choose to ignore or defer this request.
 * If the component has not been instantiated, {@link DMAppLayout#removeDMAppComponentById} is called instead.
 * @param {string} id DMApp component ID (full/prefixed)
 */
DMAppLayout.prototype.requestRemoveDMAppComponentById = function(id) /* -> void */ {
	this.componentContainer.requestRemoveDMAppComponentById(id);
};

/**
 * Get a local DMApp component by ID if it exists and is created
 * @param {string} id DMApp component ID (either short or full/prefixed)
 * @returns {?DMAppComponent} DMApp component element
 */
DMAppLayout.prototype.getDMAppComponentById = function(id) /* -> DMAppComponent */ {
	let cr = this.componentContainer.getComponentRefById(id);
	if (!cr) {
		if (this.contextId && this.dmAppId) {
			cr = this.componentContainer.getComponentRefById('/' + this.contextId + '/' + this.dmAppId + '/' + id);
		} else if (this.contextId) {
			// context ID but no DMApp ID, scan component list
			for (let cr_iter of this.componentContainer.getComponentMap().values()) {
				const comp = cr_iter.getComponent();
				if (comp && comp.dMAppComponentContextId === this.contextId && comp.dMAppComponentId === id) return comp;
			}
		}
	}
	if (!cr) return null;
	return cr.getComponent() || null;
};

/**
 * Get DMApp component signal of the component with the given ID (relative to the current context/dmapp or lack thereof),
 * incrementing its ref count and creating it if it doesn't already exist.
 * Wherever possible {@link DMAppComponent#getTopLevelDMAppComponentSignalById} should be used instead, as it has fewer edge cases for typical component use cases.
 * The semantics of the returned signal are equivalent to the instantaneous value of {@link DMAppLayout#getDMAppComponentById} for the same ID.
 *
 * @param {!string} id DMApp component ID
 * @return {!RefCountedSignalMap~GetSignalResult} Signal result, the signal value has a value of the component instance when the component exists, and null otherwise
*/
DMAppLayout.prototype.getCtxStateTopLevelDMAppComponentSignal = function(id) /* -> DMAppComponent */ {
	const self = this;
	if (!self._componentSignalMap) {
		Object.defineProperty(self, '_componentSignalMap', { value: new RefCountedSignalMap() });
		self._componentSignalMap.on('newSignal', function(info) {
			info.signal.setEqualityComparator(function(a, b) {
				return a === b;
			});
			info.signal.setValue(self.getDMAppComponentById(id));
		});
		const setSignalState = function(id) {
			const signal = self._componentSignalMap.getExistingSignal(id);
			if (signal) signal.setValue(self.getDMAppComponentById(id));
		};
		self.on("createdComponent", function(info) {
			setSignalState(info.component.dMAppComponentId);
			if (info.component.dMAppComponentFullId !== info.component.dMAppComponentId) {
				setSignalState(info.component.dMAppComponentFullId);
			}
		});
		self.on("destroyedComponent", function(info) {
			const idInfo = self._getDmAppComponentInfoFromString(info.componentId);
			setSignalState(info.componentId);
			if (idInfo.shortId !== info.componentId) {
				setSignalState(idInfo.shortId);
			}
		});
		const refreshAll = function() {
			for (let [id, info] of self._componentSignalMap.getEntries()) {
				info.signal.setValue(self.getDMAppComponentById(id));
			}
		};
		self.on("contextChange", refreshAll);
		self.on("dmAppChange", refreshAll);
	}
	const info = self._componentSignalMap.getSignal(id);
	return {
		signal: new Signal.ConstWrapperSignal(info.signal),
		unref: info.unref,
	};
};

/**
 * Get Object set of local DMApp components which exist and are created
 * @returns {Object.<string, DMAppComponent>} Object with component ID keys and component values
 */
DMAppLayout.prototype.getDMAppComponents = function() {
	return this.componentContainer.getComponents();
};

/**
 * Get Array set of IDs of local DMApp components which exist and are created
 * @returns {Array.<string>} Array of component IDs
 */
DMAppLayout.prototype.getDMAppComponentIdList = function() {
	return this.componentContainer.getComponentIdList();
};

/**
 * Get Array set of short IDs of local DMApp components which exist and are created
 * @returns {Array.<string>} Array of component IDs
 */
DMAppLayout.prototype.getDMAppComponentShortIdList = function() {
	const out = [];
	const components = this.componentContainer.getComponents();
	for (let prop in components) {
		out.push(components[prop].dMAppComponentId);
	}
	return out;
};

DMAppLayout.prototype._getDmAppComponentInfoFromString = function(dmAppComponentId) {
	const result = dmAppComponentId.match(/^\/([^/]+)\/([^/]+)\/(.+)$/);
	if (result) {
		return {
			contextId: result[1],
			dmAppId: result[2],
			shortId: result[3],
			fullId: dmAppComponentId,
		};
	} else {
		return {
			contextId: this.contextId,
			dmAppId: this.dmAppId,
			shortId: dmAppComponentId,
			fullId: '/' + this.contextId + '/' + this.dmAppId + '/' + dmAppComponentId,
		};
	}
};

DMAppLayout.prototype._getDmAppComponentInfo = function(dmAppComponent) /* -> { shortId: string, fullId: string, contextId: string, dmAppId: string } */ {
	let contextId, dmAppId, shortId, fullId;
	let nonRoot = false;
	let layoutIndependent = false;

	if (dmAppComponent == null) {
		throw new Error("dmAppComponent is null/undefined");
	} else if (typeof dmAppComponent === "string") {
		if (this.dMAppController.advDebugMode) this.logger.warn("Calling _getDmAppComponentUrl on string: " + dmAppComponent);
		return this._getDmAppComponentInfoFromString(dmAppComponent);
	} else if (dmAppComponent instanceof DMAppLayoutUtil.ComponentRef) {
		contextId = dmAppComponent.contextId;
		dmAppId = dmAppComponent.dmAppId;
		shortId = dmAppComponent.componentId || dmAppComponent.id;
		fullId = dmAppComponent.id;
		nonRoot = !dmAppComponent.rootLayout;
		layoutIndependent = dmAppComponent.isLayoutIndependent();
	} else {
		contextId = dmAppComponent.dMAppComponentContextId;
		dmAppId = dmAppComponent.dMAppComponentDMAppId;
		shortId = dmAppComponent.dMAppComponentId;
		fullId = dmAppComponent.dMAppComponentFullId;
		nonRoot = !dmAppComponent.rootLayout;
		layoutIndependent = dmAppComponent.layoutIndependent;
	}

	return {
		contextId: contextId,
		dmAppId: dmAppId,
		shortId: shortId,
		fullId: fullId,
		nonRoot: nonRoot,
		layoutIndependent: layoutIndependent,
	};
};

DMAppLayout.prototype._getDmAppComponentShortId = function(dmAppComponent) /* -> ID string */ {
	return this._getDmAppComponentInfo(dmAppComponent).shortId;
};

DMAppLayout.prototype.setupComponentDebugEvents = function(listenerTracker, func) {
	const tracker = listenerTracker.subscribeTo(this);
	tracker.on("_websocketDebugStatusChange", func);
	tracker.on("contextChange", func);
	tracker.on("dmAppChange", func);
	const regionTracker = listenerTracker.subscribeTo(this.layoutRegionCtl);
	regionTracker.on("layoutRegionChange", func);
	listenerTracker.subscribeTo(this._interCtxIdSignal).on("change", func);
};

DMAppLayout.prototype.dumpDebugInfo = function(dumper) {
	const capCat = dumper.subcategory("Layout capabilities");
	const caps = this.getLayoutCaps();
	for (let prop in caps) {
		capCat.keyValue(prop, caps[prop]);
	}

	const dumpElement = function(elem) {
		try {
			let txt = elem.nodeName;
			if (elem.id) txt += ", id = '" + elem.id + "'";
			if (elem.className) txt += ", class = '" + elem.className + "'";
			return txt;
		} catch(e) {
			return String(elem);
		}
	};
	const regionCat = dumper.subcategory("Regions");
	regionCat.keyValue("<root region>", dumpElement(this.layoutRegionCtl.getNamedLayoutRegionElement(null)));
	const regions = this.layoutRegionCtl._getRegionList();
	for (let i = 0; i < regions.length; i++) {
		const cat = regionCat.subcategory(regions[i].regionId, false);
		cat.keyValue("Element", dumpElement(this.layoutRegionCtl.getNamedLayoutRegionElement(regions[i].regionId)));
		cat.keyValue("Display width", regions[i].displayWidth);
		cat.keyValue("Display height", regions[i].displayHeight);
		cat.keyValue("Resizable", regions[i].resizable);
	}

	dumper.keyValue("Websocket status", this._wsState.debugStatus);
	dumper.keyValue("Context ID", this.contextId);
	dumper.keyValue("DMApp ID", this.dmAppId);
	dumper.keyValue("Inter-context ID", this.interContextId);
	dumper.keyValue("Post component statuses", this.postComponentStatuses);
	dumper.keyValue("Debounce layout updates", this.debounceLayoutUpdates);
	dumper.keyValue("New contexts use percent coords", this.newContextPercentCoords);
};

DMAppLayout.prototype.setupDMAppDebugEvents = function(listenerTracker, func) {
	listenerTracker.subscribeTo(this).on("dmAppChange", func);
};

DMAppLayout.prototype.dumpDMAppDebugInfo = function(dumper) {
	const dmAppObj = this.dmAppObj;
	if (dmAppObj) {
		dumper.keyValue("DMApp ID", dmAppObj.DMAppId);
		dumper.keyValue("Context ID", dmAppObj.contextId);
		dumper.keyValue("Timeline doc URL", dmAppObj.spec.timelineDocUrl);
		dumper.keyValue("Layout doc URL", dmAppObj.spec.layoutReqsUrl);
		dumper.keyValue("Timeline service URL", dmAppObj.spec.timelineServiceUrl);
	} else {
		dumper.value("No DMApp");
	}
};

try {
	Object.freeze(DMAppLayout.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppLayout;
