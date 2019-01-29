/************************************************************************/
/* FILE:                DMAppComponentBehaviour.js                      */
/* DESCRIPTION:         DMApp component behaviour mix-in                */
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
const EnumUtil = require('./EnumUtil');
const Signal = require('./Signal');
const PromiseExecQueue = require('./PromiseExecQueue');
const argCheck = require('./argCheck');
const SafeEventEmitter = require('./SafeEventEmitter');
const StateMapping = require('./StateMapping');
const RetryUtil = require('./RetryUtil');
const DMAppLayoutUtil = require('./DMAppLayoutUtil');
const UpdateUtil = require('./UpdateUtil');
const App2AppMsgBusCtl = require('./App2AppMsgBusCtl');
const DebugMiscUtil = require('./DebugMiscUtil');
const InputUtil = require('./InputUtil');
const dvbcssClocks = require('dvbcss-clocks/src/main');
const ListenerTracker = require('listener-tracker');
const deepFreeze = require('deep-freeze');
const deepEql = require('deep-eql');

/**
 * DMApp Component interface
 *
 * This is the instance interface of a DMApp component, which mixes the {@link DMAppComponentBehaviour} mixin.
 *
 * (All DMApp components must mix-in the {@link DMAppComponentBehaviour} mixin or a derivative thereof).
 *
 * @constructor DMAppComponent
 * @mixes DMAppComponentBehaviour
 * @implements DebugMiscUtil.DebugDumpable
 */

/** @member {!DMAppController} DMAppComponent#dMAppController parent controller */
/** @member {!EventEmitter} DMAppComponent#event event emitter: all listed events are emitted on this */
/** @member {!string} DMAppComponent#dMAppComponentId component ID */
/** @member {!string} DMAppComponent#dMAppComponentTypeName component type name */
/** @member {!DMAppComponentBehaviour.COMPONENT_STATUS} DMAppComponent#dMAppComponentStatus component status */
/** @member {?string} DMAppComponent#layoutInstanceId Layout service instance ID for this component (if applicable) */
/** @member {!Logger} DMAppComponent#logger logger for this instance */
/** @member {?Clock} DMAppComponent#referenceClock reference clock for this component: see {@link DMAppComponentBehaviour.setReferenceClock} */
/** @member {?Clock} DMAppComponent#componentTimelineClock timeline clock for this component, this is relative to the component's start time, and is 0 before the component's start time is defined and reached */
/** @member {!ListenerTracker} DMAppComponent#listenerTracker listener tracker for this component, this is scoped to the component's lifetime */
/** @member {!Promise} DMAppComponent#readyPromise promise fulfilled when the component is ready (both initDMAppComponent and ready called) */
/** @member {!Signal.BlockCountSignal} DMAppComponent#presentableGate BlockCountSignal which can be used to delay the resolution of presentablePromise, if blocked/latched within initDMAppComponent */
/** @member {!Array<Function>} DMAppComponent#destructorFunctions array of functions called at component destruction, when called the value of this is not defined */
/** @member {!Array<DMAppComponent~ParameterChangeCallback>} DMAppComponent#setParameterFunctions array of functions called when component parameters are updated */
/** @member {?String} DMAppComponent#dMAppComponentContextId context ID for this component, may be null */
/** @member {?String} DMAppComponent#dMAppComponentDMAppId DMApp ID for this component, may be null */
/**
 * Promise which is fulfilled after readyPromise is resolved, and presentableGate is ready (or a 5s timeout).
 * The DMApp component state is changed to INITED after this is resolved.
 * @member {!Promise} DMAppComponent#presentablePromise
 */
/**
 * Promise which is fulfilled after readyPromise is resolved, and presentableGate is ready.
 * This has no timeout.
 * @member {!Promise} DMAppComponent#reallyPresentablePromise
 */
/** @member {?Object} DMAppComponent#dMAppComponentInfo component info set by {@link DMAppComponentBehaviour.setComponentInfo} */
/** @member {!Signal.BaseSignal} DMAppComponent#configParameterSignal Configuration component parameters object as set by {@link DMAppComponentBehaviour.setComponentInfo} */
/** @member {!Signal.BaseSignal} DMAppComponent#effectiveParameterSignal Effective component parameters object, by default this is the same as {@link DMAppComponent#configParameterSignal}. See {@link DMAppComponent#addEffectiveParameterSignalOverlay}, {@link DMAppComponent#addEffectiveParameterSignalTransform}, {@link DMAppComponent#setExpectedConfigParameterType}. */
/** @member {?boolean} DMAppComponent#layoutIndependent Set to true to indicate that this component is independent of any layout service context/DMApp, this prevents the element being removed by DMAppLayout, this is for debug/testing purposes */
/** @member {?boolean} DMAppComponent#noElementDomAttachmentCtl Set to true to disable attachment/detachment of the component's element to/from the DOM, this is for debug/testing purposes */
/** @member {?object} DMAppComponent#dMAppPriorities Current DMAppComponentPriority priorities */
/** @member {!Signal.BlockCountSignal} DMAppComponent#softStopped When blocked, this component is soft-stopped. This is where the component is hidden and not running, but does not affect the component's DMApp component status. */
/** @member {!Signal.BlockCountSignal} DMAppComponent#visibilityBlockSignal When blocked, this component is invisible. This is where the component is hidden (detached from DOM), but does not affect the component's DMApp component status. This has no effect if {@link DMAppComponent#noElementDomAttachmentCtl} is true. */
/** @member {!Signal.BlockCountSignal} DMAppComponent#visibilityBlockSignalNonInherited When blocked, this component is invisible. This is where the component is hidden (detached from DOM), but does not affect the component's DMApp component status. This has no effect if {@link DMAppComponent#noElementDomAttachmentCtl} is true. */
/** @member {!number} DMAppComponent#sequenceNumber Sequence number of this component, this can be assumed to be unique per-device. */
/** @member {!Signal.BlockCountSignal} DMAppComponent#applyLayoutBlockSignal When blocked, component layout changes (i.e. calls to {@link DMAppComponent#setLayout}) are blocked. */

/**
 * Component parameters change callback
 *
 * @callback DMAppComponent~ParameterChangeCallback
 *
 * @param {Object} params The current component parameters
 * @param {Object} oldParams The previous component parameters
 */

/**
 * DMApp component destruction event.
 *
 * @event DMAppComponent#destroy
 */

/**
 * DMApp component start/stop time change event.
 *
 * @event DMAppComponent#startStopTimeChange
 */
/**
 * DMApp component start time change event.
 *
 * @event DMAppComponent#startTimeChange
 */
/**
 * DMApp component stop time change event.
 *
 * @event DMAppComponent#stopTimeChange
 */
/**
 * DMApp component info update event.
 *
 * @event DMAppComponent#componentInfoUpdate
 */

/**
 * DMApp component component visibility change event.
 *
 * @event DMAppComponent#visibilityChange
 */

/**
 * DMApp component is running state change event.
 *
 * @event DMAppComponent#isRunningChange
 * @type {boolean}
 */

/**
 * DMApp component running state change event.
 *
 * @event DMAppComponent#runningStateChange
 * @type {DMAppComponentBehaviour.RUNNING_STATE}
 */

 /**
 * DMApp component element has just been attached to the DOM tree
 *
 * @event DMAppComponent#elementAttached
 */

 /**
 * DMApp component element has just been detached from the DOM tree
 *
 * @event DMAppComponent#elementDetached
 */

/**
 * DMApp component reference clock change event.
 *
 * @event DMAppComponent#referenceClockChange
 * @type {object}
 * @property {Clock} oldReferenceClock old reference clock
 * @property {Clock} newReferenceClock new reference clock
 */

/**
 * DMApp component status change event.
 *
 * @event DMAppComponent#dMAppComponentStatusChange
 * @type {object}
 * @property {DMAppComponentBehaviour.COMPONENT_STATUS} oldStatus old status
 * @property {DMAppComponentBehaviour.COMPONENT_STATUS} newStatus new status
 */
/**
 * DMApp component status change event.
 *
 * @event DMAppComponent#dMAppComponentStatusDurationChange
 * @type {object}
 * @property {?number} oldDuration old status
 * @property {?number} newDuration new status
 * @property {boolean} force force update
 */

const expectedTypeHandlers = [
	{
		name: "boolean",
		handler: function(self, k, v) {
			if (typeof v === "boolean") return v;
			if (v == null) return v;
			if (v === "true") return true;
			if (v === "false") return false;
			self.logger.warn("Parameter: " + k + ", expected boolean, got: ", v);
			return !!v;
		},
	},
	{
		name: "number",
		handler: function(self, k, v) {
			if (typeof v === "number") return v;
			if (v == null) return v;
			const num = Number(v);
			if (!Number.isNaN(num)) return num;
			self.logger.warn("Parameter: " + k + ", expected number, got: ", v);
			return null;
		},
	},
	{
		name: "time",
		handler: function(self, k, v) {
			if (v == null) return v;
			const parsed = InputUtil.parseTime(v, null, true);
			if (parsed != null) return parsed;
			self.logger.warn("Parameter: " + k + ", expected time/number, got: ", v);
			return null;
		},
	},
	{
		name: "string",
		handler: function(self, k, v) {
			if (typeof v === "string") return v;
			if (v == null) return v;
			self.logger.warn("Parameter: " + k + ", expected string, got: ", v);
			return null;
		},
	},
	{
		name: "object",
		handler: function(self, k, v) {
			if (typeof v === "object") return v;
			if (v == null) return v;
			if (typeof v === "string") {
				try {
					const obj = JSON.parse(v);
					if (obj && typeof obj === "object") return obj;
				} catch (e) {
					/* swallow */
				}
			}
			self.logger.warn("Parameter: " + k + ", expected object, got: ", v);
			return null;
		},
	},
	{
		name: "array",
		handler: function(self, k, v) {
			if (Array.isArray(v)) return v;
			if (v == null) return v;
			if (typeof v === "string") {
				try {
					const obj = JSON.parse(v);
					if (Array.isArray(obj)) return obj;
				} catch (e) {
					/* swallow */
				}
			}
			self.logger.warn("Parameter: " + k + ", expected array, got: ", v);
			return null;
		},
	},
];
const expectedTypeHandlerMap = new Map();
for (let i = 0; i < expectedTypeHandlers.length; i++) {
	expectedTypeHandlerMap.set(expectedTypeHandlers[i].name, expectedTypeHandlers[i]);
}

let DMAppComponentBehaviourSequenceNumber = 0;

const DMAppComponentBehaviourComponentElementColumnModeInfo = new WeakMap();

/**
 * DMApp component behaviour.
 * All DMApp components MUST mix-in this behaviour, or another behaviour which mixes this behaviour.
 * This is typically done using Polymer's behaviour mechanism, however use of Polymer is not required.
 * If this behaviour is not applied to a HTML element, {@link DMAppComponentBehaviour.getComponentElement} must
 * be overridden to return a valid HTML element, or null/undefined.
 *
 * @see {@link DMAppComponent} for the corresponding instance interface
 * @implements DebugMiscUtil.DebugDumpable
 *
 * @mixin
 */
const DMAppComponentBehaviour = {

	/**
	 * Get component name.
	 * This method SHOULD NOT be overridden.
	 * @return {string}
	 */
	getName: function() {
		return this.dMAppComponentNamePrefix + this.dMAppComponentTypeName + ":" + this.dMAppComponentId + this.dMAppComponentNamePostfix;
	},

	initDMAppComponentEx: function(aux, dMAppController, id, typeName, config) /* -> void */ {
		const self = this;
		Object.defineProperties(self, {
			destructorFunctions:      { value: [] },
			event:                    { value: new SafeEventEmitter() },
			dMAppController:          { value: dMAppController },
			rootLayout:               { value: aux.rootLayout || null },
			dMAppComponentId:         { value: config && config.componentId ? config.componentId : id },
			dMAppComponentFullId:     { value: id },
			dMAppComponentTypeName:   { value: typeName },
			dMAppComponentNamePrefix: { value: aux.componentNamePrefix || '' },
			dMAppComponentStatus:     { configurable: true, value: self.COMPONENT_STATUS.UNINITED },
			layoutInstanceId:         { writable: true, value: null },
			componentTimelineClock:   { value: new dvbcssClocks.CorrelatedClock() },
			listenerTracker:          { value: ListenerTracker.createTracker() },
			setParameterFunctions:    { value: [] },
			dMAppComponentContextId:  { value: config && config.contextId ? config.contextId : null },
			dMAppComponentDMAppId:    { value: config && config.dmAppId ? config.dmAppId : null },
			configParameterSignal:    { value: new Signal.SettableSignal({}, { autoFreeze: true }) },
			_parameterSignal:         { value: new Signal.SettableSignal({}, { autoFreeze: true }) },
			_parameterBlockSignal:    { value: new Signal.BlockCountSignal() },
			_parameterOverlays:       { value: [] },
			_configLayoutSignal:      { value: new Signal.SettableSignal({}, { autoFreeze: true }) },
			_effectiveLayoutSignal:   { value: new Signal.SettableSignal({}, { autoFreeze: true }) },
			_layoutOverlays:          { value: [] },
			softStopped:              { value: new Signal.BlockCountSignal() },
			sequenceNumber:           { value: DMAppComponentBehaviourSequenceNumber++ },
			applyLayoutBlockSignal:   { value: new Signal.BlockCountSignal() },
			visibilityBlockSignal:    { value: new Signal.BlockCountSignal() },
			visibilityBlockSignalNonInherited: { value: new Signal.BlockCountSignal() },
		});
		{
			let namePostfix = '';
			if (dMAppController.advDebugMode && aux.componentContainer) {
				let rev = aux.componentContainer._shortIdRevNums.get(this.dMAppComponentId) || 0;
				aux.componentContainer._shortIdRevNums.set(this.dMAppComponentId, rev + 1);
				if (rev) namePostfix = '[' + rev + ']';
			}
			Object.defineProperty(self, 'dMAppComponentNamePostfix', { value: namePostfix });
		}

		Object.defineProperties(self, {
			effectiveParameterSignal: { value: new Signal.ConstWrapperSignal(self._parameterSignal) },
			logger:                   { value: dMAppController.createNamedLogger(self.getName()) },
			_initing:                 { value: true },
		});
		if (aux.importInfo) {
			Object.defineProperty(self, '_componentImportInfo', { value: aux.importInfo });
		}
		if (aux.revision != null) {
			self.dMAppComponentRevision = aux.revision;
		}
		let configSignalCopy;
		if (config) {
			if (config.parameters instanceof Signal.BaseSignal) {
				if (aux.applyConfig) {
					configSignalCopy = config.parameters;
				} else {
					self.logger.warn("Signal config params supplied, but not going to be applied");
				}
				config.parameters = config.parameters.getValue();
			}
			deepFreeze(config);
			if (config.layoutIndependent) this.layoutIndependent = true;
			if (config.noElementDomAttachmentCtl) this.noElementDomAttachmentCtl = true;
		}
		this.event.setSafeEventEmitterLogger(this.logger, "component event emitter");
		if (dMAppController.advDebugMode) {
			try {
				Promise.enableSynchronous();
			} catch (e) {
				self.logger.warn("Promise.enableSynchronous failed: ", e);
			}
			self.logger.addMessageTransform(function(args) {
				args.unshift(self._getFlagString() + ": ");
				return args;
			});
		}
		if (aux.componentContainer) {
			Object.defineProperty(self, '_parentComponentContainer', { value: aux.componentContainer });
			aux.componentContainer.registerDMAppComponent(this.dMAppComponentFullId, this);
		} else {
			self.logger.warn("No component container supplied");
		}
		if (aux.trackSoftStopped) self.softStopped.registerBlockerSignal(aux.trackSoftStopped, self.listenerTracker);
		if (aux.trackVisibilityBlockSignal) self.visibilityBlockSignal.registerBlockerSignal(aux.trackVisibilityBlockSignal, self.listenerTracker);

		if (config && config.layout && config.layout.instanceId) self.layoutInstanceId = config.layout.instanceId;
		if (aux.layoutInstanceId) self.layoutInstanceId = aux.layoutInstanceId;

		self._effectiveLayoutSignal.setSignalCopy(self._configLayoutSignal);
		self._effectiveLayoutSignal.on('change', function() {
			self.setLayout(self._effectiveLayoutSignal.getValue());
		});

		self.logger.info("Component being constructed (initDMAppComponent)");
		self._runningState = self.RUNNING_STATE.INACTIVE;
		self.selfDestructOnStop = true;
		self.selfDestructBeforeStart = false;
		self._durationEstimate = 0;
		self._readyPromiseInit("init");
		self.readyPromise.then(function() {
			Object.defineProperty(self, '_inited', { value: true });
		});
		self.presentablePromise.then(function() {
			if (self.dMAppComponentStatus < self.COMPONENT_STATUS.INITED) self.setDMAppComponentStatus(self.COMPONENT_STATUS.INITED);
			self._startStopStateCtl();
		});

		self.listenerTracker.subscribeTo(self.effectiveParameterSignal).on("change", self._effectiveParamChange.bind(self));
		self._parameterSignal.setSignalCopy(self.configParameterSignal);
		self._parameterSignal.setUpdateBlockSignal(self._parameterBlockSignal);
		self.effectiveParameterSignal.on("newListener", function(event, listener) {
			if (event === "change") self._haveWarnedNoParamHandler = true;
		});

		self._clockChangeEventListener = function() {
			self._startStopStateCtl();
			self.event.emit("_clockChange");
		};
		self.softStopped.on("toggle", self._clockChangeEventListener);
		self.setReferenceClock(self.dMAppController.timeline.defaultClock);

		self.applyLayoutBlockSignal.on("fall", function() {
			if (!self._layoutDebouncing) self._intlSetLayout();
		});

		self.visibilityBlockSignal.on("toggle", function() {
			self._setVisibility(self.isRunning());
		});
		self.visibilityBlockSignalNonInherited.on("toggle", function() {
			self._setVisibility(self.isRunning());
		});

		self.setExpectedConfigParameterType('string', '__writeTimingSignal', '__notRunnableBeforeTime', '__elementClass', '__componentTimelineClockSource');

		self.initDMAppComponent.apply(self, [].slice.call(arguments, 1));

		const elem = this.getComponentElement();
		if (elem) $(elem).addClass('immerse2-layout-component-hidden');
		if (elem) {
			self.listenerTracker.subscribeTo(dMAppController.layout.layoutRegionCtl).on('layoutRegionChange', self._elementDomAttachmentCtl.bind(self));
		} else {
			// No element, so it will never become "ready", so trigger ready now
			self.ready();
		}

		if (aux.applyConfig && config) self.setComponentInfo(config);
		if (configSignalCopy) {
			self.configParameterSignal.setSignalCopy(configSignalCopy);
			self.configParameterSignal.makeConst();
		}
		if (aux.ignoreComponentInfoStartStop) {
			Object.defineProperty(self, '_ignoreComponentInfoStartStop', { value: true });
		}
	},

	/**
	 * Initialise the current component.
	 * If this method is overridden, the parent implementation MUST be called.
	 * The call of the parent implementation SHOULD be placed at the start of the overriding method.
	 * This method SHOULD NOT be called directly.
	 *
	 * @param {DMAppController} dMAppController
	 * @param {string} id component ID
	 * @param {string} typeName component type name
	 * @param {Object} config initial config
	 * @param {Object=} config.parameters optional initial parameters, see {@link DMAppComponentBehaviour.setParameters}
	 * @param {Object=} config.layout optional initial layout, see {@link DMAppComponentBehaviour.setLayout}
	 * @param {String=} config.contextId optional context ID for this component
	 * @param {String=} config.dmAppId optional DMApp ID for this component
	 */
	initDMAppComponent: function(dMAppController, id, typeName, config) /* -> void */ {
		Object.defineProperty(this, '_initing2', { value: true });
	},

	/**
	 * Called (typically but not necessarily by Polymer) when the Element is ready.
	 * If this method is overridden, the parent implementation MUST be called.
	 *
	 * This method SHOULD NOT be called directly.
	 */
	ready: function() {
		this._readyPromiseInit("ready");
	},

	_readyPromiseInit: function(mode) {
		const self = this;
		if (self.readyPromise && self._readyPromiseFulfill) {
			if (self._readyPromiseSetupBy !== mode) {
				delete self._readyPromiseReject;
				self._readyPromiseFulfill();
			}
		} else {
			self._readyPromiseSetupBy = mode;
			self.readyPromise = new Promise(function (fulfill, reject) {
				self._readyPromiseFulfill = fulfill;
				self._readyPromiseReject = reject;
			});
			self.presentableGate = new Signal.BlockCountSignal();
			self.presentablePromise = new Promise(function (fulfill, reject) {
				self._presentablePromiseFulfill = fulfill;
				self._presentablePromiseReject = reject;
			});
			self.reallyPresentablePromise = new Promise(function (fulfill, reject) {
				self._reallyPresentablePromiseFulfill = fulfill;
				self._reallyPresentablePromiseReject = reject;
			});
			self.readyPromise.then(function() {
				// Resolve the 'presentable' promise when the gate is ready, or after a timeout of 5s
				self.presentableGate.awaitEqual(0, function() {
					self._presentablePromiseFulfill(null);
					self._reallyPresentablePromiseFulfill(null);
				});
				window.setTimeout(self._presentablePromiseFulfill.bind(null, null), 5000);
			});
		}
	},

	deinitDMAppComponentEx: function() /* -> void */ {
		this.logger.info("Component being destructed (deinitDMAppComponent)");
		if (!this._destructing) this.logger.throwError("deinitDMAppComponentEx() called inappropriately");

		this._recalculateRunningStateIntl(false);

		try {
			this.deinitDMAppComponent();
			if (!this._destructing2) this.logger.error("deinitDMAppComponent() override failed to properly call parent destructor");
		} catch(e) {
			this.logger.error("Failed to execute deinitDMAppComponent() override, exception thrown: ", e);
		}

		const elem = this.getComponentElement();
		if (elem != null) $(elem).remove();
		while (this.destructorFunctions.length > 0) {
			// Execute in reverse order, handle inserts/removals whilst iterating
			const f = this.destructorFunctions.pop();
			try {
				f();
			} catch(e) {
				this.logger.error("Failed to execute a destructor function in deinitDMAppComponent: ", e);
			}
		}
		if (this._readyPromiseReject) {
			this._readyPromiseReject(this.getName() + ":deinitDMAppComponent(): component is deiniting");
		}
		if (this._presentablePromiseReject) {
			this._presentablePromiseReject(this.getName() + ":deinitDMAppComponent(): component is deiniting");
		}
		if (this._reallyPresentablePromiseReject) {
			this._reallyPresentablePromiseReject(this.getName() + ":deinitDMAppComponent(): component is deiniting");
		}
		this._removeTimeVisibilityEventHandlers();
		this._removeReferenceClockEventHandlers();
		this.event.emit("destroy");
		this.event.removeAllListeners();
		this.listenerTracker.removeAllListeners();
		if (this._parentComponentContainer) {
			this._parentComponentContainer.unregisterDMAppComponent(this.dMAppComponentFullId);
		}
		if (this._releaseApp2AppCallbackName) this._releaseApp2AppCallbackName();
		Object.defineProperty(this, '_destructed', { value: true });
	},

	/**
	 * Deinitialise the current component.
	 * If this method is overridden, the parent implementation MUST be called.
	 * The call of the parent implementation SHOULD be placed at the end of the overriding method.
	 * After this method has executed, the component SHALL be in the destructed state.
	 * This method SHOULD NOT be called directly.
	 * @fires DMAppComponent#destroy
	 */
	deinitDMAppComponent: function() /* -> void */ {
		if (!this._destructing) this.logger.throwError("deinitDMAppComponent() called inappropriately");
		Object.defineProperty(this, '_destructing2', { value: true });
	},

	_getFlagString: function() {
		let out = '';

		out += 'iad'[this._runningState] || '?';

		if (this._startStopState === "waiting") {
			out += 'w';
		} else if (this._startStopState === "started") {
			out += 's';
		} else if (this._startStopState === "stopped") {
			out += 't';
		} else {
			out += '?';
		}

		out += 'uirs'[this.dMAppComponentStatus] || '?';

		if (this._durationEstimate === 0) {
			out += '0';
		} else if (this._durationEstimate > 0) {
			out += 'd';
		} else if (this._durationEstimate == null) {
			out += 'n';
		} else {
			out += '?';
		}

		out += '/';

		const flag = function(c, v) {
			if (v) out += c;
		};
		const sflag = function(c, s) {
			if (s) flag(c, s.getValue());
		};
		flag('i', !this._initing2);
		flag('d', this._destructing);
		flag('G', this._destructed);
		flag('l', this.layoutIndependent);
		flag('n', this.noElementDomAttachmentCtl);
		sflag('s', this.softStopped);
		sflag('b', this._parameterBlockSignal);
		flag('q', this._layoutDebouncing);
		sflag('y', this.applyLayoutBlockSignal);
		flag('z', !this.selfDestructOnStop);
		flag('E', this.selfDestructBeforeStart);
		sflag('p', this.presentableGate);
		flag('u', this.getComponentElement() && !this.getComponentElement().parentNode);
		flag('a', this.getComponentElement() && this.getComponentElement().parentNode);
		flag('x', this._exitTransitionSignal && this._exitTransitionSignal.getValue());
		flag('A', this.dMAppStartTime != null);
		flag('B', this.dMAppStopTime != null);
		flag('v', this._currentVisbility);
		sflag('C', this.visibilityBlockSignal);
		sflag('D', this.visibilityBlockSignalNonInherited);
		flag('m', this._masqueradeDestroyed);

		const pflag = function(c, p) {
			if (p && p.getState) {
				let state = p.getState();
				if (state === 0) {
					out += c;
				} else if (state === 2) {
					out += c.toUpperCase();
				}
			}
		};
		pflag('h', this.readyPromise);
		pflag('j', this.presentablePromise);
		pflag('k', this.reallyPresentablePromise);

		return out;
	},

	/**
	 * Serialise the current component state.
	 * The default implementation returns an empty object.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * @abstract
	 * @return {Promise<Object>}
	 */
	serialiseDMAppComponentState: function() /* -> Promise<state object> */ {
		/* default state: empty object */
		return Promise.resolve({});
	},

	/**
	 * Deserialise the current component state.
	 * The default implementation rejects non-empty objects.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * @abstract
	 * @param {Object} data
	 * @return {Promise}
	 */
	deserialiseDMAppComponentState: function(data) /* -> Promise<> */ {
		if ($.isEmptyObject(data)) {
			/* empty state: as produced by default state serialisation */
			return Promise.resolve();
		} else {
			const msg = "deserialiseDMAppComponentState default implementation could not deserialise non-empty state";
			this.logger.error(msg);
			return Promise.reject(this.getName() + ": " + msg);
		}
	},

	/**
	 * Called when the component parameters change.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * This method SHOULD NOT be called directly by component authors.
	 *
	 * @abstract
	 * @param {Object} params The current component parameters
	 * @param {Object} oldParams The previous component parameters
	 */
	setParameters : function(params, oldParams) /* -> void */ {
		// do nothing
	},

	/**
	 * Called to set the component layout.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * This method should not generally be called directly by component authors in the case of top-level, remote service controlled components.
	 *
	 * @abstract
	 * @param {Object} layout
	 */
	setLayout: function (layout) /* -> void */ {
		if (this._destructing) return;
		const regionId = layout.regionId || null;
		const region = this.dMAppController.layout.layoutRegionCtl.getNamedLayoutRegionInfo(regionId);
		const elem = this.getComponentElement();
		if (!elem) {
			if (Object.keys(layout).length > (layout.instanceId != null ? 1 : 0)) {
				if (layout.regionId) {
					if (region && region.suppressElementlessComponentWarning) return;
				}
				this.logger.warn("Ignoring layout specification for component without an element");
			}
			return;
		}

		const je = $(elem);
		const unitConv = function(val) {
			if (typeof val === "number") {
				return val + "px";
			} else {
				return val;
			}
		};

		let needElementReattach = false;
		if (region.columnMode) {
			je.css("position", "");
			je.css("left", "");
			je.css("top", "");
			je.css("width", "");
			je.css("height", "");
			let info = DMAppComponentBehaviourComponentElementColumnModeInfo.get(elem);
			if (!info) {
				info = {};
				DMAppComponentBehaviourComponentElementColumnModeInfo.set(elem, info);
			}
			let ok = false;
			if (layout.position && typeof layout.position.x === "number" && typeof layout.position.y === "number") {
				if (layout.position.x === 0 && layout.size.width === 1) {
					ok = true;
					if (layout.position.y !== info.y) {
						info.y = layout.position.y;
						needElementReattach = true;
					}
				} else if (layout.position.x < 0 || layout.position.y < 0) {
					// soft-removed, do nothing
					ok = true;
					delete info.y;
				}
			}
			if (!ok) {
				this.logger.warn("Ignoring invalid layout specification for component in column mode region: ", layout);
			}
		} else {
			DMAppComponentBehaviourComponentElementColumnModeInfo.delete(elem);
			const adjust = function(x, y) {
				const ok = (typeof x === "number" && typeof y === "number");
				return {
					x: ok && region.clientAdjustXExpr ? region.clientAdjustXExpr.evaluate({ x: x, y: y }) : x,
					y: ok && region.clientAdjustYExpr ? region.clientAdjustYExpr.evaluate({ x: x, y: y }) : y,
				};
			};
			if (layout.position) {
				const position = adjust(layout.position.x, layout.position.y);
				je.css("position", "absolute");
				je.css("left", unitConv(position.x));
				je.css("top", unitConv(position.y));
			}
			if (layout.size) {
				const size = adjust(layout.size.width, layout.size.height);
				je.css("width", unitConv(size.x));
				je.css("height", unitConv(size.y));
			}
		}
		/* zdepth is always -1 for now, so ignore it */
		//if (layout.zdepth != null) {
		//	je.css("z-index", layout.zdepth);
		//}
		if (layout.visible != null) {
			je.css("visibility", layout.visible ? "inherit" : "hidden");
		}
		if (layout._class != null) {
			if (Array.isArray(layout._class)) {
				je.addClass.apply(je, layout._class);
			} else {
				je.addClass(layout._class);
			}
		}

		if (this._layoutRegionId !== regionId || needElementReattach) {
			this._layoutRegionId = regionId;
			this._elementDomAttachmentCtl();
		}
	},

	/**
	 * Called to set the component start/stop times.
	 * If this method is overridden, the parent implementation MUST be called.
	 * Called by {@link DMAppComponentBehaviour.setComponentInfo}.
	 *
	 * This method should not generally be called directly by component authors in the case of top-level, remote service controlled components.
	 *
	 * @fires DMAppComponent#startTimeChange
	 * @fires DMAppComponent#stopTimeChange
	 * @fires DMAppComponent#startStopTimeChange
	 *
	 * @param {Object} info
	 */
	setComponentStartStop: function(startTime, stopTime) /* -> void */ {
		const prevStartTime = this.dMAppStartTime;
		const prevStopTime = this.dMAppStopTime;
		this.dMAppStartTime = startTime;
		this.dMAppStopTime = stopTime;
		if (prevStartTime !== this.dMAppStartTime || prevStopTime !== this.dMAppStopTime) {
			const msg = "Start/stop times changed from: " + prevStartTime + " -> " + prevStopTime + ", to: " +
					this.dMAppStartTime + " -> " + this.dMAppStopTime + ", " + this._clockInfo();
			if (!this.layoutIndependent && this.rootLayout && ((this.dMAppStartTime == null && prevStartTime != null) || (this.dMAppStopTime == null && prevStopTime != null))) {
				this.logger.warn(msg + ", this change looks problematic");
				if (this.dMAppController.advDebugMode) this.dMAppController.devDialogLogger.warn(this.getName() + ": " + msg + ", this change looks problematic");
			} else {
				this.logger.debug(msg);
			}

			this._startStopStateCtl();
			this.event.emit("startStopTimeChange");
			this._writeTimingSignal();
		}
		if (prevStartTime !== this.dMAppStartTime) {
			this.event.emit("startTimeChange");
		}
		if (prevStopTime !== this.dMAppStopTime) {
			this.event.emit("stopTimeChange");
		}
		if (this.rootLayout && this.dMAppStartTime != null) {
			this.rootLayout._startedWaitable.signal();
		}
	},

	_intlSetLayout: function() {
		if (this.applyLayoutBlockSignal.isBlocked()) return;
		if (this.dMAppComponentInfo && this.dMAppComponentInfo.layout) this._configLayoutSignal.setValue(this.dMAppComponentInfo.layout);
	},

	/**
	 * Called to set the component info.
	 * If this method is overridden, the parent implementation MUST be called.
	 * This sets the value of {@link DMAppComponent#dMAppComponentInfo} to info.
	 * Calls {@link DMAppComponentBehaviour.setComponentStartStop}
	 *
	 * This method should not generally be called directly by component authors in the case of top-level, remote service controlled components.
	 *
	 * @fires DMAppComponent#startTimeChange
	 * @fires DMAppComponent#stopTimeChange
	 * @fires DMAppComponent#startStopTimeChange
	 *
	 * @param {Object} info
	 */
	setComponentInfo: function(info) /* -> void */ {
		const self = this;
		deepFreeze(info);
		if (info.config && info.config.revision != null) {
			if (info.config.revision != null && this.dMAppComponentRevision != null && info.config.revision < this.dMAppComponentRevision) {
				this.logger.debug("Ignoring component info update due to revision less than current: " + info.config.revision + " < " + this.dMAppComponentRevision);
				return;
			}
			const oldRevision = this.dMAppComponentRevision;
			this.dMAppComponentRevision = info.config.revision;
			if (oldRevision !== this.dMAppComponentRevision) {
				this.logger.debug("Sending extra status update due to revision number change: " + oldRevision + " --> " + this.dMAppComponentRevision);
				this._emitDMAppComponentStatusChange();
				const cr = this._getComponentRef();
				if (cr) cr.setRevisionNumber(this.dMAppComponentRevision);
			}
		}

		this.dMAppComponentInfo = info;
		this.logger.debug("Received updated component info: ", info);
		this.dMAppPriorities = info.priorities;

		if (!this._ignoreComponentInfoStartStop) this.setComponentStartStop(info.startTime, info.stopTime);
		this._setLayoutSoftStoppedState();
		this.softStopped.setBlockerRegistered(DMAppComponentBehaviour.setComponentInfo, !!info.softStopped);
		this.visibilityBlockSignal.setBlockerRegistered(DMAppComponentBehaviour.setComponentInfo, !!info.visibilityBlocked);
		this.visibilityBlockSignalNonInherited.setBlockerRegistered(DMAppComponentBehaviour.setComponentInfo, !!info.visibilityBlockedNonInherited);

		if (info.layout) {
			if (info.layout.instanceId) this.layoutInstanceId = info.layout.instanceId;
			if (this.rootLayout && this.rootLayout.debounceLayoutUpdates) {
				this._layoutDebouncing = true;
				this.rootLayout.componentDebouncer.debounce(this.dMAppComponentFullId, "layout", function() {
					self._intlSetLayout();
					self._layoutDebouncing = false;
					self._startStopStateCtl();
				});
			} else {
				this._intlSetLayout();
			}
		}

		if (info.parameters && typeof info.parameters === "object") {
			this.configParameterSignal.setValue(info.parameters);
			if (!this._haveWarnedNoParamHandler && this.setParameterFunctions.length === 0 && this.setParameters === DMAppComponentBehaviour.setParameters) {
				if (!$.isEmptyObject(info.parameters)) {
					const list = [];
					for (let prop in info.parameters) {
						list.push(prop);
					}
					this.logger.warn("Component parameters are defined: (" + list.join(", ") + "), but there is no implementation of setParameters() and there are no handlers in setParameterFunctions");
					this._haveWarnedNoParamHandler = true;
				}
			}
		}
		this.event.emit("componentInfoUpdate");
	},

	_writeTimingSignal: function() {
		const params = this.effectiveParameterSignal.getValue();
		if (!params || !params.__writeTimingSignal) return;
		try {
			const value = {
				startTime: this.dMAppStartTime,
				stopTime: this.dMAppStopTime,
				durationEstimate: this._durationEstimate,
				estimatedEndTime: (this.dMAppStartTime != null && this._durationEstimate != null) ? this.dMAppStartTime + this._durationEstimate : NaN,
			};
			this.dMAppController.setSignalByName(params.__writeTimingSignal, value);
			this.logger.debug("Writing timing signal: " + params.__writeTimingSignal + " --> ", value);
		} catch (e) {
			this.logger.error("Failed to write timing signal: ", e);
		}
	},

	_makeRefClockTimeThresholdSignal: function(update) {
		const signal = new Signal.SettableSignal(null);
		this.destructorFunctions.push(function() {
			signal.scuttle();
		});

		let timerHandleDestructor = null;
		const check = function() {
			if (timerHandleDestructor) {
				timerHandleDestructor();
				timerHandleDestructor = null;
			}
			if (this._destructed) return;

			let threshold = signal.getValue();
			if (threshold == null || Number.isNaN(threshold)) threshold = null;

			const clock = this.referenceClock;
			if (!clock) {
				update(null, threshold);
				return;
			}
			if (!clock.isAvailable()) {
				// do nothing
				return;
			}

			const now = clock.now() / clock.getTickRate();
			update(now, threshold);
			if (threshold != null && Number.isFinite(threshold)) {
				const handle = clock.setAtTime(function() {
					timerHandleDestructor = null;
					check();
				}, clock.getTickRate() * threshold);
				timerHandleDestructor = clock.clearTimeout.bind(clock, handle);
			}
		}.bind(this);
		signal.on("change", check);
		this.event.on("_clockChange", check);
		return signal;
	},

	_releaseRefCountSignalOnPromise: function(obj) {
		if (obj.info) {
			obj.info.signal.unregisterReference(obj);
			obj.info.unref();
			delete obj.info;
		}
	},

	_acquireRefCountSignalOnPromise: function(promise, key, value) {
		if (value != null) {
			let obj = this[key];
			if (!obj) {
				obj = this[key] = {};
				this.destructorFunctions.push(this._releaseRefCountSignalOnPromise.bind(this, obj));
			}
			if (value !== obj.prevValue) {
				try {
					const self = this;
					self._releaseRefCountSignalOnPromise(obj);
					obj.prevValue = value;
					const info = self.dMAppController.getSignalByName(value);
					obj.info = info;
					promise.then(function() {
						if (obj.info === info) {
							obj.info.signal.registerReference(obj);
						}
					});
				} catch(e) {
					this.logger.error("Exception thrown in a parameter ref count signal on promise handler: ", key, value, e);
				}
			}
		} else if (this[key]) {
			this._releaseRefCountSignalOnPromise(this[key]);
		}
	},

	_effectiveParamChange: function(event) {
		if (event.newValue && typeof event.newValue === "object") {
			if (event.newValue.__writeTimingSignal) this._writeTimingSignal();
			if (event.newValue.__notRunnableBeforeTime) {
				if (!this._notRunnableBeforeTime) {
					const setBlocked = this.softStopped.setBlockerRegistered.bind(this.softStopped, DMAppComponentBehaviour._effectiveParamChange);
					this._notRunnableBeforeTime = this._makeRefClockTimeThresholdSignal(function(now, threshold) {
						if (now == null || threshold == null) {
							setBlocked(false);
						} else {
							setBlocked(now < threshold);
						}
					});
					this._notRunnableBeforeTime.on("change", function(info) {
						this.logger.debug("Not runnable before time changed from: " + info.oldValue + ", to: " + info.newValue + ", expression: " + this._notRunnableBeforeTimeStr, this._clockInfo());
					}.bind(this));
				}
				if (this._notRunnableBeforeTimeStr !== event.newValue.__notRunnableBeforeTime) {
					this._notRunnableBeforeTimeStr = event.newValue.__notRunnableBeforeTime;
					this.dMAppController.setExpressionSignal(this._notRunnableBeforeTime, event.newValue.__notRunnableBeforeTime);
				}
			} else if (this._notRunnableBeforeTime) {
				this._notRunnableBeforeTime.setValue(null);
			}
			if (event.newValue.__elementClass && event.newValue.__elementClass !== this._prevElementClassParam) {
				this._prevElementClassParam = event.newValue.__elementClass;
				const elem = this.getComponentElement();
				if (elem) {
					elem.classList.add.apply(elem.classList, event.newValue.__elementClass.split(/\s*,\s*/));
				} else {
					this.logger.warn("Ignoring attempt to set element class using '__elementClass' parameter on elementless component");
				}
			}
			if (event.newValue.__componentTimelineClockSource && event.newValue.__componentTimelineClockSource !== this.__prevComponentTimelineClockSource) {
				this.__prevComponentTimelineClockSource = event.newValue.__componentTimelineClockSource;
				this._handleComponentTimelineClock();
			}
			if (event.newValue.__acquireApp2AppCallbackName != null) {
				if (event.newValue.__acquireApp2AppCallbackName !== this.__prevAcquireApp2AppCallbackName) {
					if (this._releaseApp2AppCallbackName) this._releaseApp2AppCallbackName();
					this.__prevAcquireApp2AppCallbackName = event.newValue.__acquireApp2AppCallbackName;
					try {
						const cbId = this.dMAppController.app2appMsgBusCtl.createNamedCallback(event.newValue.__acquireApp2AppCallbackName, this.getApp2AppRecvHandler());
						this._releaseApp2AppCallbackName = function() {
							this.dMAppController.app2appMsgBusCtl.removeCallback(cbId);
							delete this._releaseApp2AppCallbackName;
						}.bind(this);
					} catch(e) {
						this.logger.error("Exception thrown in a parameter __acquireApp2AppCallbackName handler: ", e);
					}
				}
			} else if (this._releaseApp2AppCallbackName) {
				this._releaseApp2AppCallbackName();
				this.__prevAcquireApp2AppCallbackName = null;
			}
			this._acquireRefCountSignalOnPromise(this.presentablePromise, "__acquireRefCountSignalOnPresentableState", event.newValue.__acquireRefCountSignalOnPresentable);
			this._acquireRefCountSignalOnPromise(this.reallyPresentablePromise, "__acquireRefCountSignalOnReallyPresentableState", event.newValue.__acquireRefCountSignalOnReallyPresentable);
		}
		try {
			this.setParameters(event.newValue, event.oldValue);
		} catch(e) {
			this.logger.error("Exception thrown in setParameters: ", e);
		}
		const cachedLength = this.setParameterFunctions.length;
		for (let i = 0; i < this.setParameterFunctions.length; i++) {
			try {
				this.setParameterFunctions[i].call(this, event.newValue, event.oldValue);
			} catch(e) {
				this.logger.error("Exception thrown in a setParameterFunctions function: ", e);
			}
		}
		if (cachedLength !== this.setParameterFunctions.length) {
			this.logger.error("setParameterFunctions length changed during iteration: ", cachedLength, " --> ", this.setParameterFunctions.length);
		}
	},

	_setVisibility: function(visibility) {
		if (this.visibilityBlockSignal.isBlocked()) visibility = false;
		if (this.visibilityBlockSignalNonInherited.isBlocked()) visibility = false;
		if (this._currentVisbility !== visibility) {
			const elem = this.getComponentElement();
			if (!elem) return;
			this.logger.debug("Changing visibility from " + this._currentVisbility + " to " + visibility, this._clockInfo());
			this._currentVisbility = visibility;
			if (visibility) {
				$(elem).removeClass('immerse2-layout-component-hidden');
			} else {
				$(elem).addClass('immerse2-layout-component-hidden');
			}
			this._elementDomAttachmentCtl();
			this.event.emit("visibilityChange");
		}
	},

	_elementDomAttachmentCtl: function() {
		if (this._destructing) return;
		if (this.noElementDomAttachmentCtl) {
			this.softStopped.unregisterBlocker(DMAppComponentBehaviour._elementDomAttachmentCtl);
			return;
		}

		const regionInfo = this.dMAppController.layout.layoutRegionCtl.getNamedLayoutRegionInfo(this._layoutRegionId);
		const softStopRegionFlag = (regionInfo && regionInfo.softStopComponentsOnZeroSize && !(regionInfo.width > 0 && regionInfo.height > 0));
		this.softStopped.setBlockerRegistered(DMAppComponentBehaviour._elementDomAttachmentCtl, softStopRegionFlag);

		const elem = this.getComponentElement();
		if (!elem) return;
		if (this._currentVisbility) {
			const parent = regionInfo ? regionInfo.element : null;
			if (regionInfo && regionInfo.columnMode && parent) {
				const elemInfo = DMAppComponentBehaviourComponentElementColumnModeInfo.get(elem);
				if (elemInfo && elemInfo.y != null) {
					const prevParent = elem.parentNode;
					let node = parent.firstChild;
					let beforeNode = null;
					while (node) {
						const nodeInfo = DMAppComponentBehaviourComponentElementColumnModeInfo.get(node);
						if (nodeInfo && nodeInfo.y > elemInfo.y) {
							beforeNode = node;
							break;
						}
						node = node.nextSibling;
					}
					parent.insertBefore(elem, beforeNode);
					if (prevParent !== parent) this.event.emit("elementAttached");
				} else if (elem.parentNode != null) {
					$(elem).remove();
					this.event.emit("elementDetached");
				}
			} else if (parent !== elem.parentNode) {
				if (parent) {
					parent.appendChild(elem);
					this.event.emit("elementAttached");
				} else if (elem.parentNode != null) {
					$(elem).remove();
					this.event.emit("elementDetached");
				}
			}
		} else if (elem.parentNode != null) {
			$(elem).remove();
			this.event.emit("elementDetached");
		}
	},

	_removeTimeVisibilityEventHandlers: function() /* -> void */ {
		if (this._startTimeHandle) {
			this._startTimeClock.clearTimeout(this._startTimeHandle);
			delete this._startTimeHandle;
			delete this._startTimeClock;
		}
		if (this._stopTimeHandle) {
			this._stopTimeClock.clearTimeout(this._stopTimeHandle);
			delete this._stopTimeHandle;
			delete this._stopTimeClock;
		}
	},

	/**
	 * This method is called to request destruction of the component.
	 * The implementation of the method is not obligated to destroy the component.
	 * The default implementation destroys the component immediately.
	 * If this method is overridden, the parent implementation SHOULD only be called if the component is to be destroyed immediately.
	 */
	requestDestruction: function() {
		this._selfDestruct();
	},

	_selfDestruct: function() /* -> void */ {
		if (this._destructing) {
			this.logger.warn("_selfDestruct called when component is already destructing/destructed, ignoring");
			return;
		}
		if (this._parentComponentContainer) this._parentComponentContainer.removeDMAppComponentById(this.dMAppComponentFullId);
	},

	_getComponentRef: function() {
		if (this._parentComponentContainer) {
			return this._parentComponentContainer.getComponentRefById(this.dMAppComponentFullId);
		} else {
			return null;
		}
	},

	/**
	 * Masquerade component destruction.
	 *
	 * The component is not destroyed, however external services (layout, timeline, etc.) are informed that it is in a way indistinguishable from normal destruction.
	 */
	masqueradeDestroyed: function() /* -> void */ {
		if (this._masqueradeDestroyed) return;
		Object.defineProperties(this, {
			_masqueradeDestroyed:    { value: true },
		});
		const cr = this._getComponentRef();
		if (cr) cr.markMasqueradeDestroyed();
	},

	/**
	 * Returns the component's exit transition in progress signal.
	 * When the returned signal has a non-zero ref count, the running state (see {@link DMAppComponent#getRunningState}) is held in the [DEACTIVATING]{@link DMAppComponentBehaviour.RUNNING_STATE} state.
	 * This method SHOULD NOT be overridden.
	 *
	 * @returns {!Signal.RefCountSignal}
	 */
	getExitTransitionSignal: function() {
		if (!this._exitTransitionSignal) {
			Object.defineProperties(this, {
				_exitTransitionSignal: { value: new Signal.RefCountSignal() },
			});
			this._exitTransitionSignal.on("toggle", this._clockChangeEventListener);
		}
		return this._exitTransitionSignal;
	},

	/**
	 * Set whether the component should request its destruction (using {@link DMAppComponent#requestDestruction}) when it is or transitions to the stopped state.
	 * This method SHOULD NOT be overridden.
	 * If this method is not called the default is true.
	 *
	 * @param {boolean} enabled
	 */
	setSelfDestructOnStop: function(enabled) /* -> void */ {
		this.selfDestructOnStop = enabled;
		if (enabled && this._startStopState === "stopped") {
			this.logger.info("setSelfDestructOnStop called when component stopped, requesting self destruct");
			try {
				this.requestDestruction();
			} catch(e) {
				this.logger.error("requestDestruction() failed in setSelfDestructOnStop(): ", e);
			}
		}
	},

	/**
	 * Set whether the component should request its destruction (using {@link DMAppComponent#requestDestruction}) when it is or transitions to the waiting (before start) state.
	 * This method SHOULD NOT be overridden.
	 * If this method is not called the default is false.
	 *
	 * @param {boolean} enabled
	 */
	setSelfDestructBeforeStart: function(enabled) /* -> void */ {
		this.selfDestructBeforeStart = enabled;
		if (enabled && this._startStopState === "waiting") {
			this.logger.info("setSelfDestructBeforeStart called when component waiting, requesting self destruct");
			try {
				this.requestDestruction();
			} catch(e) {
				this.logger.error("requestDestruction() failed in setSelfDestructBeforeStart(): ", e);
			}
		}
	},

	RUNNING_STATE: EnumUtil.createConstEnum(
			/**
			 * Running state types: see {@link DMAppComponent#getRunningState}
			 *
			 * @readonly
			 * @alias RUNNING_STATE
			 * @memberof! DMAppComponentBehaviour
			 * @enum {number}
			 */
			{
				/** Not running */
				INACTIVE: 0,
				/** Running (i.e. started, not yet stopped, and not soft-stopped) */
				ACTIVE: 1,
				/** Transitioning from ACTIVE to INACTIVE, use {@link DMAppComponent#getExitTransitionSignal} to hold in this state */
				DEACTIVATING: 2,
			}, 'DMAppComponentBehaviour.RUNNING_STATE'),

	/**
	 * Return whether the component is in a [ACTIVE]{@link DMAppComponentBehaviour.RUNNING_STATE} (i.e. started, not yet stopped, and not soft-stopped) or [DEACTIVATING]{@link DMAppComponentBehaviour.RUNNING_STATE} state.
	 * This method SHOULD NOT be overridden.
	 *
	 * @returns {boolean}
	 */
	isRunning: function() /* -> bool */ {
		return this._runningState !== this.RUNNING_STATE.INACTIVE;
	},

	/**
	 * Return the component's running state.
	 * This method SHOULD NOT be overridden.
	 *
	 * @returns {DMAppComponentBehaviour.RUNNING_STATE}
	 */
	getRunningState: function() /* -> bool */ {
		return this._runningState;
	},

	_getLayoutSoftStoppedBlockSignal: function() {
		if (!this._layoutSoftStoppedBlockSignal) this._layoutSoftStoppedBlockSignal = new Signal.BlockCountSignal();
		return this._layoutSoftStoppedBlockSignal;
	},

	_setLayoutSoftStoppedState: function() {
		let softStopped = false;
		if (this.dMAppComponentInfo && this.dMAppComponentInfo.layout && this.dMAppComponentInfo.layout.size) {
			if (this.dMAppComponentInfo.layout.size.width < 0 && this.dMAppComponentInfo.layout.size.height < 0) {
				// negative dimensions indicates the component is effectively stopped due to being soft-removed at layout service due to a component priority change
				softStopped = true;
			}
		}
		const blocked = softStopped && this._startStopState !== "waiting";
		this.softStopped.setBlockerRegistered(DMAppComponentBehaviour._setLayoutSoftStoppedState, blocked);
		if (blocked || this._layoutSoftStoppedBlockSignal) (this._getLayoutSoftStoppedBlockSignal()).setBlockerRegistered(DMAppComponentBehaviour._setLayoutSoftStoppedState, blocked);
	},

	_recalculateRunningStateIntl: function(transitionOut) {
		let newState = (transitionOut && this._runningState !== this.RUNNING_STATE.INACTIVE) ? this.RUNNING_STATE.DEACTIVATING : this.RUNNING_STATE.INACTIVE;
		if ((this._startStopState === "started") && !this.softStopped.isBlocked()) {
			newState = this.RUNNING_STATE.ACTIVE;
		}
		if (this._exitTransitionSignal && this._exitTransitionSignal.getValue()) {
			newState = this.RUNNING_STATE.DEACTIVATING;
		}
		if (this._destructing) {
			newState = this.RUNNING_STATE.INACTIVE;
		}
		const oldIsRunning = this.isRunning();
		if (this._runningState !== newState) {
			this._runningState = newState;
			this.logger.debug("Running state change to: " + EnumUtil.enumToString(this.RUNNING_STATE, this._runningState));
			this.event.emit("runningStateChange", this._runningState);
			const newIsRunning = this.isRunning();
			if (newIsRunning !== oldIsRunning) {
				this.event.emit("isRunningChange", newIsRunning);
			}
		}
	},

	_setStartStopState: function(value) /* -> void */ {
		const statusChange = (this._startStopState !== value);

		if (statusChange) {
			this._startStopState = value;
			this._setLayoutSoftStoppedState();
			this._handleComponentTimelineClock();
		}

		if (statusChange) {
			this._recalculateRunningStateIntl(true);

			if (value === "started") {
				this.setDMAppComponentStatus(this.COMPONENT_STATUS.RUNNING);
			} else if (value === "stopped") {
				if (this.selfDestructOnStop) {
					this.logger.debug("component status -> stopped, requesting self destruct");
					try {
						this.requestDestruction();
					} catch(e) {
						this.logger.error("requestDestruction() failed in _setStartStopState(): ", e);
					}
					if (this._destructed) return;
				} else {
					this.setDMAppComponentStatus(this.COMPONENT_STATUS.STOPPED);
				}
			} else if (value === "waiting") {
				if (this.selfDestructBeforeStart) {
					this.logger.debug("component status -> waiting, requesting self destruct");
					try {
						this.requestDestruction();
					} catch(e) {
						this.logger.error("requestDestruction() failed in _setStartStopState(): ", e);
					}
					if (this._destructed) return;
				}
			}
		}

		this._recalculateRunningStateIntl(false);
		this._setVisibility(this.isRunning());
	},

	_startStopStateCtl: function(immediate) /* -> void */ {
		if (this._destructed) return;

		this._removeTimeVisibilityEventHandlers();

		this._handleComponentTimelineClock();

		if (this._layoutDebouncing && !immediate) return;

		if (immediate) {
			if (this._startStopStateCtlTimeout) {
				window.clearTimeout(this._startStopStateCtlTimeout);
				delete this._startStopStateCtlTimeout;
			}
			this._startStopStateCtlIntl();
		} else if (!this._startStopStateCtlTimeout) {
			this._startStopStateCtlTimeout = window.setTimeout(function() {
				delete this._startStopStateCtlTimeout;
				if (!this._layoutDebouncing) this._startStopStateCtlIntl();
			}.bind(this), 0);
		}
	},

	/* to be called by _startStopStateCtl ONLY */
	_startStopStateCtlIntl: function()  {
		const self = this;
		if (this.dMAppStopTime != null && this.dMAppStartTime == null && this.rootLayout && this.layoutInstanceId) {
			// handle this is an an immediate destruction request
			self._setStartStopState("stopped");
			return;
		}
		if ((this.dMAppStopTime === null && this.dMAppStartTime === null) || self.dMAppComponentStatus < self.COMPONENT_STATUS.INITED) {
			self._setStartStopState("waiting");
			return;
		} else if (this.dMAppStopTime === undefined && this.dMAppStartTime === undefined) {
			self._setStartStopState("started");
			return;
		}

		const clock = this.referenceClock;
		if (!clock) {
			self._setStartStopState("started");
			return;
		}
		if (!clock.isAvailable()) {
			// do nothing
			return;
		}

		const now = clock.now() / clock.getTickRate();

		if (this.dMAppStopTime != null) {
			if (now >= this.dMAppStopTime) {
				self._setVisibility(false);
				self._setStartStopState("stopped");
				return;
			} else {
				this._stopTimeHandle = clock.setAtTime(function() {
					delete self._stopTimeHandle;
					delete self._stopTimeClock;
					self._startStopStateCtl(true);
				}, clock.getTickRate() * this.dMAppStopTime);
				this._stopTimeClock = clock;
			}
		}

		if (this.dMAppStartTime != null) {
			if (now < this.dMAppStartTime) {
				self._setVisibility(false);
				self._setStartStopState("waiting");
				this._startTimeHandle = clock.setAtTime(function() {
					delete self._startTimeHandle;
					delete self._startTimeClock;
					self._startStopStateCtl(true);
				}, clock.getTickRate() * this.dMAppStartTime);
				this._startTimeClock = clock;
				return;
			}
		}

		self._setStartStopState("started");
	},

	_removeReferenceClockEventHandlers: function() /* -> void */ {
		if (this.referenceClock) {
			this.referenceClock.removeListener('change', this._clockChangeEventListener);
			this.referenceClock.removeListener('available', this._clockChangeEventListener);
			this.referenceClock.removeListener('unavailable', this._clockChangeEventListener);
		}
	},

	/**
	 * Set the reference clock for this component.
	 * See {@link DMAppComponent#referenceClock}
	 * The default reference clock if this method is not called is: {@link DMAppTimeline#defaultClock}
	 * @fires DMAppComponent#referenceClockChange
	 *
	 * @param {Clock} clock MUST be a member clock or a clock from {@link DMAppTimeline#getRegisteredClock}, or a clock derived from a member/registered clock using {@link DMAppTimeline#createOffsettedClock}/{@link DMAppTimeline#createCorrelatedClock}/{@link DMAppTimeline#setCorrelatedClockParent}
	 */
	setReferenceClock: function(clock) /* -> void */ {
		if (this.referenceClock === clock) return;

		this._removeReferenceClockEventHandlers();

		const oldReferenceClock = this.referenceClock;

		// Use this instead of simple assignment to prevent accidental assignments
		Object.defineProperty(this, "referenceClock", {
			writable: false, configurable: true, value: clock,
		});

		if (oldReferenceClock) {
			this.event.emit("referenceClockChange", {
				oldReferenceClock: oldReferenceClock,
				newReferenceClock: this.referenceClock,
			});
		}

		if (this.referenceClock) {
			this.referenceClock.on('change', this._clockChangeEventListener);
			this.referenceClock.on('available', this._clockChangeEventListener);
			this.referenceClock.on('unavailable', this._clockChangeEventListener);
		}

		this._startStopStateCtl();
		this._handleComponentTimelineClock();
	},

	_handleComponentTimelineClock: function() {
		const params = this.effectiveParameterSignal.getValue();
		if (params.__componentTimelineClockSource && params.__componentTimelineClockSource !== "normal") {
			try {
				const src = this.dMAppController.timeline.getClockByName(params.__componentTimelineClockSource);
				if (src) {
					this.dMAppController.timeline.setCorrelatedClockParent(src, this.componentTimelineClock, 0, 0, 1, "ComponentTimeline(" + params.__componentTimelineClockSource + ")");
					this.componentTimelineClock.availabilityFlag = true;
				} else {
					this.componentTimelineClock.availabilityFlag = false;
				}
				this._componentTimelineIndependent = true;
			} catch (e) {
				this.logger.error("Failed to get __componentTimelineClockSource clock: '" + params.__componentTimelineClockSource + "', ", e);
				this.componentTimelineClock.availabilityFlag = false;
			}
			return;
		}

		delete this._componentTimelineIndependent;
		if (this.referenceClock == null) {
			this.componentTimelineClock.availabilityFlag = false;
			return;
		}
		const now = this.referenceClock.now() / this.referenceClock.getTickRate();
		const start = this.dMAppStartTime || 0;
		const running = (this.dMAppStartTime != null && now >= this.dMAppStartTime) || (this.dMAppStopTime === undefined && this.dMAppStartTime === undefined);
		this.dMAppController.timeline.setCorrelatedClockParent(this.referenceClock, this.componentTimelineClock, start, 0, running ? 1 : 0, "ComponentTimeline");
		this.componentTimelineClock.availabilityFlag = true;
	},

	COMPONENT_STATUS: EnumUtil.createConstEnum(
			/**
			 * Component status types: see {@link DMAppComponent#dMAppComponentStatus}
			 *
			 * @readonly
			 * @alias COMPONENT_STATUS
			 * @memberof! DMAppComponentBehaviour
			 * @enum {number}
			 */
			{
				/** Component has been created but does not yet consider itself initialised */
				UNINITED: 0,

				/** Component considers itself initialised, this is reported to the layout/timeline services as an "inited" status if appropriate */
				INITED: 1,

				/** Component has been started (usually by reaching a start time set by the services), this is reported to the layout/timeline services as a "started" status if appropriate */
				RUNNING: 2,

				/** Component has been stopped (usually by reaching a stop time set by the services), this state is only reached if {@link DMAppComponent#setSelfDestructOnStop} is false (the default is true) */
				STOPPED: 3,
			}, 'DMAppComponentBehaviour.COMPONENT_STATUS'),

	/**
	 * Set component duration estimate sent to timeline service. This defaults to 0.
	 * This may be set to null/undefined to send the absence of an estimate.
	 * If a duration is to be determined in future, this should be set to null before the
	 * first status update is sent.
	 *
	 * @param {?number} duration estimate
	 * @param {boolean} force force update, update even if duration already set
	 * @returns {Promise}
	 */
	setTimelineDurationEstimate: function(estimate, force) {
		if (!force && this._durationEstimate != null) return Promise.resolve();
		if (this._durationEstimate === estimate) return Promise.resolve();
		const oldDuration = this._durationEstimate;
		this._durationEstimate = estimate;
		this.event.emit("dMAppComponentStatusDurationChange", Object.freeze({
			oldDuration: oldDuration,
			newDuration: estimate,
			force: force,
		}));
		this._writeTimingSignal();
		return this._emitDMAppComponentStatusChange();
	},

	/**
	 * Set component duration estimate sent to timeline service, as the current reference clock time.
	 *
	 * @param {boolean} force force update, update even if duration already set
	 * @returns {Promise}
	 */
	setTimelineDurationEndedNow: function(force) {
		const clock = this.referenceClock;
		if (clock && clock.isAvailable() && this.dMAppStartTime != null) {
			return this.setTimelineDurationEstimate((clock.now() / clock.getTickRate()) - this.dMAppStartTime, force);
		} else {
			return this.setTimelineDurationEstimate(0, force);
		}
	},

	/**
	 * Set the status for this component.
	 * See {@link DMAppComponent#dMAppComponentStatus}.
	 *
	 * @private
	 *
	 * @param {DMAppComponentBehaviour.COMPONENT_STATUS} status
	 * @returns {Promise}
	 */
	setDMAppComponentStatus: function(status) /* -> Promise<> */ {
		const self = this;
		if (!parseInt(status) || status < self.COMPONENT_STATUS.UNINITED || status > self.COMPONENT_STATUS.STOPPED) {
			self.logger.throwError("Invalid component status: '" + status + "', passed to setDMAppComponentStatus");
		}
		const oldStatus = this.dMAppComponentStatus;
		if (status === oldStatus) return;

		// Use this instead of simple assignment to prevent accidental assignment accidents
		Object.defineProperty(this, "dMAppComponentStatus", {
			writable: false, enumerable: true, configurable: true, value: status,
		});
		this.event.emit("dMAppComponentStatusChange", Object.freeze({
			oldStatus: oldStatus,
			newStatus: status,
		}));

		return self._emitDMAppComponentStatusChange();
	},

	_emitDMAppComponentStatusChange: function() {
		if (this.rootLayout && !this.layoutIndependent && !this._masqueradeDestroyed && !this._destructed && this.dMAppComponentContextId && this.dMAppComponentDMAppId) {
			const str = this.stringifyDMAppComponentStatus(this.dMAppComponentStatus);
			if (str) {
				const obj = {
					status: str,
				};
				if (this._durationEstimate != null) {
					obj.duration = this._durationEstimate;
				}
				if (this.dMAppComponentRevision != null) {
					obj.revision = this.dMAppComponentRevision;
				}
				return this.rootLayout.io.postDMAppComponentStatus(this, obj);
			}
		}
		return Promise.resolve();
	},

	/**
	 * Convert a component status into a string.
	 *
	 * @param {DMAppComponentBehaviour.COMPONENT_STATUS} status
	 * @returns {string}
	 */
	stringifyDMAppComponentStatus: function(status) {
		return ['', 'inited', 'started', ''][status];
	},

	/**
	 * Get component element.
	 *
	 * If this behaviour is not applied to the component element, this method MUST be overridden,
	 * otherwise this method MAY be overridden if necessary.
	 * @return {?Element}
	 */
	getComponentElement: function() {
		return this;
	},

	/**
	 * Setup app2app message receiver
	 *
	 * The app2app message receiver is created and setup on first use
	 *
	 * If this method is overridden, the parent implementation SHOULD be called.
	 *
	 * @param {!App2AppMsgBusCtl.App2AppMsgBusRecvHandler} recvHandler The new message receiver for this component
	 */
	setupApp2AppRecvHandler: function(recvHandler) {
		const self = this;
		recvHandler.setSubHandler('dumpDebug', function() {
			const app2app = self.dMAppController.app2appMsgBusCtl;
			const prefix = 'cds' + self.sequenceNumber + '-';

			if (!self._removeSetupApp2AppRecvHandlerDumpDebugCallback) {
				self._removeSetupApp2AppRecvHandlerDumpDebugCallback = function() {
					for (let cbId of app2app._cbIdMap.keys()) {
						if (cbId.startsWith('%' + prefix)) app2app._cbIdMap.delete(cbId);
					}
				};
				self.destructorFunctions.push(self._removeSetupApp2AppRecvHandlerDumpDebugCallback);
			}
			self._removeSetupApp2AppRecvHandlerDumpDebugCallback();

			const data = [];
			const dumper = new DebugMiscUtil.SerialisationDumper(data, DebugMiscUtil.MakeApp2AppCallbackSerialisationDumperDynHandler(function(name, callback) {
				return app2app.createNamedCallback(prefix + name, callback);
			}));
			self.dumpDebugInfo(dumper);
			return data;
		});

		const subComponentHandler = new App2AppMsgBusCtl.App2AppMsgBusRecvHandler();
		Object.defineProperties(subComponentHandler, {
			getList:              { value: function() {
				const list = self._childComponentContainer ? self._childComponentContainer.getComponentIdList() : [];
				list.push.apply(list, App2AppMsgBusCtl.App2AppMsgBusRecvHandler.prototype.getList.call(this));
				return list;
			} },
			getSubHandler:        { value: function(id) {
				let handler = App2AppMsgBusCtl.App2AppMsgBusRecvHandler.prototype.getSubHandler.call(this, id);
				if (handler) return handler;
				if (self._childComponentContainer) {
					const component = self._childComponentContainer.getComponentById(id);
					if (component) return component.getApp2AppRecvHandler();
				}
				return null;
			} },
		});
		recvHandler.setSubHandler('child', subComponentHandler);

		recvHandler.setSubHandler('selfDestructImmediate', function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
			self.logger.warn("Manual immediate self-destruct requested by " + fromDeviceId + ", " + fromComponentId);
			self._selfDestruct();
		});

		recvHandler.setSubHandler('selfDestruct', function(msgBody, toComponentId, fromDeviceId, fromComponentId) {
			self.logger.warn("Manual self-destruct requested by " + fromDeviceId + ", " + fromComponentId);
			self.requestDestruction();
		});
	},

	/**
	 * Get app2app message receiver for this component
	 *
	 * The app2app message receiver is created and setup on first use
	 *
	 * This method SHOULD NOT be overridden
	 *
	 * @returns {!App2AppMsgBusCtl.App2AppMsgBusRecvHandler} The message receiver for this component
	 */
	getApp2AppRecvHandler: function() {
		if (this._app2appMsgRecvHandler) return this._app2appMsgRecvHandler;

		Object.defineProperty(this, "_app2appMsgRecvHandler", {
			value: new App2AppMsgBusCtl.App2AppMsgBusRecvHandler(),
		});
		this.setupApp2AppRecvHandler(this._app2appMsgRecvHandler);
		return this._app2appMsgRecvHandler;
	},

	/**
	 * Send app2app message
	 *
	 * @param msgBody The message body, this is of an arbitrary type
	 * @param {string} toDeviceId The device ID to send the message to. '@self' and '@master' are special values to address the current device and the master device respectively.
	 * @param {string} toComponentId The component ID to send the message to
	 * @return {Promise} Reply sent back by the receiver, or an error/negative acknowledgment
	 */
	sendApp2AppMsg: function(msgBody, toDeviceId, toComponentId) {
		return this.dMAppController.app2appMsgBusCtl.send(msgBody, toDeviceId, toComponentId, this.dMAppComponentId);
	},

	/**
	 * Create an app2app message receiver callback.
	 * This has a lifetime bounded to be within that of the component.
	 * The callback may be removed before component destruction by using {@link App2AppMsgBusCtl#removeCallback}.
	 *
	 * @param {App2AppRecvMsgCallback} func Message receiver callback
	 * @return {string} callback ID
	 */
	createApp2AppCallback: function(func) {
		const self = this;
		const id = self.dMAppController.app2appMsgBusCtl.createCallback(func);
		self.destructorFunctions.push(function() {
			self.dMAppController.app2appMsgBusCtl.removeCallback(id);
		});
		return id;
	},

	/**
	 * Add parameter signal overlay.
	 * This is added to the set of signals/transforms used to generate {@link DMAppComponent#effectiveParameterSignal}, (by default only {@link DMAppComponent#configParameterSignal} is used).
	 * The signal value is applied using an object extend (by default recursive).
	 *
	 * @param {!string} name Descriptive name for this overlay (for debug/diagnostic purposes)
	 * @param {!Signal.BaseSignal} signal Signal to overlay
	 * @param {!number} priority Non-zero signed number used for ordering of {@link DMAppComponent#configParameterSignal} and overlays. Overlays/transforms are applied in ascending order of priority. {@link DMAppComponent#configParameterSignal} has a priority of 0.
	 * @param {boolean} [recursive=true] optional boolean whether to do a recursive object merge instead of a single-level object merge (default true).
	 */
	addEffectiveParameterSignalOverlay: function(name, signal, priority, recursive) {
		this._addEffectiveParameterOverlayIntl({
			name: name,
			signal: signal,
			recursive: recursive != null ? !!recursive : true,
		}, priority);
	},

	/**
	 * Effective parameter transform callback
	 *
	 * @callback DMAppComponent~TransformCallback
	 * @param {!Object} input Input parameters object, this is modifiable.
	 * @param {!(Signal.BaseSignal|Signal.BaseSignal[]|Object.<string, Signal.BaseSignal>)} signalSet Set of signals being monitored
	 * @param {!Signal.SettableSignal~TransformTransientSubscriptionCallback} subscribeTransient Transiently subscribe to a signal
	 * @returns {!Object} Output parameters object, this may be the same object as the input
	 */

	/**
	 * Add parameter signal transform function.
	 * This is added to the set of signals/transforms used to generate {@link DMAppComponent#effectiveParameterSignal}, (by default only {@link DMAppComponent#configParameterSignal} is used).
	 * The transform function is re-executed whenever one or more of the set of input signals/parameters changes.
	 *
	 * @param {!string} name Descriptive name for this overlay (for debug/diagnostic purposes)
	 * @param {!DMAppComponent~TransformCallback} transform Parameter transform function, the return value is the transformed parameters object
	 * @param {!(Signal.BaseSignal|Signal.BaseSignal[]|Object.<string, Signal.BaseSignal>)} signalSet Set of signals to monitor
	 * @param {!number} priority Non-zero signed number used for ordering of {@link DMAppComponent#configParameterSignal} and overlays. Overlays/transforms are applied in ascending order of priority. {@link DMAppComponent#configParameterSignal} has a priority of 0.
	 */
	addEffectiveParameterSignalTransform: function(name, transform, signalSet, priority) {
		this._addEffectiveParameterOverlayIntl({
			name: name,
			transform: transform,
			signals: signalSet,
			isTransform: true,
		}, priority);
	},

	_addEffectiveParameterOverlayIntl: function(item, priority) {
		this._addEffectiveOverlaySignalOverlay(item, priority, this._parameterOverlays, this.configParameterSignal, "_addEffectiveParameterOverlayIntl", "Config Parameters");
		this._setupEffectiveParameterSignal();
	},

	/**
	 * Add parameter layout overlay.
	 * This is added to the set of signals/transforms used to generate {@link DMAppComponent#_effectiveLayoutSignal}, (by default only {@link DMAppComponent#_configLayoutSignal} is used).
	 * The signal value is applied using an object extend (by default recursive).
	 *
	 * @private
	 *
	 * @param {!string} name Descriptive name for this overlay (for debug/diagnostic purposes)
	 * @param {!Signal.BaseSignal} signal Signal to overlay
	 * @param {!number} priority Non-zero signed number used for ordering of {@link DMAppComponent#_configLayoutSignal} and overlays. Overlays/transforms are applied in ascending order of priority. {@link DMAppComponent#_configLayoutSignal} has a priority of 0.
	 * @param {boolean} [recursive=true] optional boolean whether to do a recursive object merge instead of a single-level object merge (default true).
	 */
	addEffectiveLayoutSignalOverlay: function(name, signal, priority, recursive) {
		this._addEffectiveLayoutOverlayIntl({
			name: name,
			signal: signal,
			recursive: recursive != null ? !!recursive : true,
		}, priority);
	},

	/**
	 * Add layout signal transform function.
	 * This is added to the set of signals/transforms used to generate {@link DMAppComponent#_effectiveLayoutSignal}, (by default only {@link DMAppComponent#_configLayoutSignal} is used).
	 * The transform function is re-executed whenever one or more of the set of input signals/layout changes.
	 *
	 * @private
	 *
	 * @param {!string} name Descriptive name for this overlay (for debug/diagnostic purposes)
	 * @param {!DMAppComponent~TransformCallback} transform Layout transform function, the return value is the transformed layout object
	 * @param {!(Signal.BaseSignal|Signal.BaseSignal[]|Object.<string, Signal.BaseSignal>)} signalSet Set of signals to monitor
	 * @param {!number} priority Non-zero signed number used for ordering of {@link DMAppComponent#_configLayoutSignal} and overlays. Overlays/transforms are applied in ascending order of priority. {@link DMAppComponent#_configLayoutSignal} has a priority of 0.
	 */
	addEffectiveLayoutSignalTransform: function(name, transform, signalSet, priority) {
		this._addEffectiveLayoutOverlayIntl({
			name: name,
			transform: transform,
			signals: signalSet,
			isTransform: true,
		}, priority);
	},

	_addEffectiveLayoutOverlayIntl: function(item, priority) {
		this._addEffectiveOverlaySignalOverlay(item, priority, this._layoutOverlays, this._configLayoutSignal, "_addEffectiveLayoutOverlayIntl", "Config Layout");
		this._setupEffectiveLayoutSignal();
	},

	_addEffectiveOverlaySignalOverlay: function(item, priority, overlays, configSignal, name, configName) {
		if (priority == null) {
			priority = 1;
		} else {
			priority = Number(priority);
		}
		if (Number.isNaN(priority) || priority === 0) {
			this.logger.throwError(name + ", priority must be a non-zero number");
		}
		if (overlays.length === 0) {
			// add config signal
			overlays.push({
				name: configName,
				signal: configSignal,
				priority: 0,
				position: 0,
			});
		}
		item.priority = priority;
		item.position = overlays.length;
		overlays.push(item);
	},

	/**
	 * Filter a config parameters object using type filters defined by {@link DMAppComponent#setExpectedConfigParameterType}.
	 *
	 * @param {!object} params Config parameters object
	 * @return {!object} Filtered parameter object, this may be the same object as params.
	 */
	filterConfigParameterObject: function(params) {
		if (!this._configParameterTypeHandlers) return params;
		const out = {};
		for (let prop in params) {
			const handler = this._configParameterTypeHandlers.get(prop);
			if (handler) {
				out[prop] = handler.handler(this, prop, params[prop]);
			} else {
				out[prop] = params[prop];
			}
		}
		return out;
	},

	/**
	 * Set expected type for keys in {@link DMAppComponent#configParameterSignal}.
	 *
	 * The value of {@link DMAppComponent#configParameterSignal} is filtered using {@link DMAppComponent#filterConfigParameterObject}
	 * before being used to generate {@link DMAppComponent#effectiveParameterSignal}.
	 *
	 * This does not result in {@link DMAppComponent#configParameterSignal} being modified,
	 * but may change the value of {@link DMAppComponent#effectiveParameterSignal}.
	 *
	 * This is intended to be used for basic type validation, and to allow use of non-string parameter types in external documents with limited type support.
	 *
	 * Conversions:
	 * * boolean: this converts the string values: "true" and "false"
	 * * number: this converts strings to numbers
	 * * time: this converts strings to numbers, and also parses strings in mm:ss and hh:mm:ss time formats to a number in seconds
	 * * string: no conversions
	 * * object: this converts JSON strings to objects
	 * * array: this converts JSON strings to arrays
	 *
	 * If the config parameter value is not the expected type and cannot be converted as per the above, a warning is emitted and the value is coerced to the given type or set to null.
	 *
	 * @param {!string} type Type name, known values include: boolean, number, time, string, object, array
	 * @param {...!string} paramKeys Parameter keys to set to this type
	 */
	setExpectedConfigParameterType: function(type) {
		const self = this;
		const handler = expectedTypeHandlerMap.get(type);
		if (!handler) self.logger.throwError("setExpectedParameterType: unknown type: " + type);

		const initing = !self.hasOwnProperty("_configParameterTypeHandlers");
		if (initing) {
			Object.defineProperty(self, '_configParameterTypeHandlers', { value: new Map() });
			for (let i = 0; i < self._parameterOverlays.length; i++) {
				// find and remove config parameters entry
				if (self._parameterOverlays[i].priority === 0) {
					self._parameterOverlays.splice(i, 1);
					break;
				}
			}
		}

		for (let i = 1; i < arguments.length; i++) {
			self._configParameterTypeHandlers.set(arguments[i], handler);
		}

		if (initing) {
			Object.defineProperty(self, '_filteredConfigParameterSignal', {
				value: Signal.SettableSignal.makeWithSignalTransform(true, self.configParameterSignal, function(cfg) {
					return self.filterConfigParameterObject(cfg.getValue());
				})
			});

			self._parameterOverlays.push({
				name: "Config parameters",
				origSignal: self.configParameterSignal,
				signal: self._filteredConfigParameterSignal,
				priority: 0,
				position: 0,
			});

			self._setupEffectiveParameterSignal();
		} else {
			self._filteredConfigParameterSignal.refreshTransform();
			self.event.emit("_effectiveParameterSourceChange");
		}
	},

	_setupEffectiveOverlaySignal: function(overlays, effectiveSignal) {
		overlays.sort(function(a, b) {
			return (a.priority - b.priority) || (a.position - b.position);
		});
		const signals = [];
		for (let i = 0; i < overlays.length; i++) {
			const overlay = overlays[i];
			if (overlay.isTransform) {
				const tSignals = overlay.signals;
				if (tSignals && tSignals.length) {
					signals.push.apply(signals, tSignals);
				}
			} else {
				signals.push(overlay.signal);
			}
		}
		effectiveSignal.setSignalTransform(signals, function(s, subscribeTransient) {
			let params = {};
			for (let i = 0; i < overlays.length; i++) {
				const overlay = overlays[i];
				if (overlay.isTransform) {
					params = overlay.transform(params, overlay.signals, subscribeTransient);
				} else {
					if (overlay.recursive) {
						params = $.extend(true, {}, params, overlay.signal.getValue());
					} else {
						$.extend(params, overlay.signal.getValue());
					}
				}
			}
			return Object.freeze(params);
		});
	},

	_setupEffectiveParameterSignal: function() {
		this._setupEffectiveOverlaySignal(this._parameterOverlays, this._parameterSignal);
		this.event.emit("_effectiveParameterSourceChange");
	},

	_setupEffectiveLayoutSignal: function() {
		this._setupEffectiveOverlaySignal(this._layoutOverlays, this._effectiveLayoutSignal);
		this.event.emit("_effectiveLayoutSourceChange");
	},

	/**
	 * Shared-state mapped element attribute "get" handler function
	 *
	 * @callback SharedStateMappedElementAttributeGetHandler
	 *
	 * @param {SharedState} sharedState Shared state instance, only the getItem method may be used
	 * @param {!string} attributeName Element attribute name
	 * @param {?string} currentValue Current value of the element attribute
	 * @return {?string} Value to assign to the element attribute
	 */
	/**
	 * Shared-state mapped element attribute "get" handler function
	 *
	 * @callback SharedStateMappedElementAttributeSetHandler
	 *
	 * @param {SharedState} sharedState Shared state instance, only the getItem and setItem methods may be used
	 * @param {!string} attributeName Element attribute name
	 * @param {?string} newValue New value of the element attribute
	 */

	/**
	 * Shared-state mapped element attribute descriptor
	 *
	 * Parameter properties 'getter' and 'sharedStateName' may not both be set.
	 * If neither 'getter' nor 'sharedStateName' are set, the attribute named by 'attribName' is mapped to the shared state property of the same name.
	 * If a 'getter' is specified but not a 'setter', the mapping is implictly read-only.
	 *
	 * @typedef {Object} SharedStateMappedElementAttributeDescriptor
	 * @property {!string} attribName Mandatory name of element attribute
	 * @property {?string} sharedStateName Optional shared state name to map attribute to, getter and setter may not be specified if this is set
	 * @property {?SharedStateMappedElementAttributeGetHandler} getter Optional callback function used to set the value of the attribute, sharedStateName may not be specified if this is set
	 * @property {?SharedStateMappedElementAttributeSetHandler} setter Optional callback function called when the value of the attribute is changed, a getter must also be specified if this is set, sharedStateName may not be specified if this is set, readonly may not be true if this is set
	 * @property {?boolean} readonly Optional boolean to specify that the shared state mapping is read-only, a setter may not be specified if this is true
	 */

	/**
	 * Shared-state mapped parameter descriptor
	 *
	 * If 'sharedStateName' is not set, the parameter named by 'paramName' is mapped to the shared state property of the same name.
	 *
	 * @typedef {Object} SharedStateMappedParameterDescriptor
	 * @property {!string} paramName Mandatory name of parameter
	 * @property {?string} sharedStateName Optional shared state name to map parameter from
	 */

	_createSharedStateFromGroupMappingWithRetry: function(groupMappingId, options) {
		const self = this;
		const args = arguments;
		return RetryUtil.retryPromise(
			function() {
				return self.dMAppController.createSharedStateFromGroupMapping.apply(self.dMAppController, args);
			},
			(options && options.parentLogger) ? options.parentLogger : self.logger,
			{
				name: "Component: Create shared state from group mapping",
				baseDelay: 10000,
				maxDelay: 80000,
				retryFailureCallback: function() {
					self.dMAppController.errorSignals.sharedState.raise();
					return !self._destructed;
				},
				preRetryCallback: function() {
					return !self._destructed;
				},
			}
		);
	},

	_setupDynPathSharedStateInstance: function(groupPathFunc, name, debugInfo, sharedStateChangeCallback, blockSignal) {
		const self = this;
		const logger = self.logger.makeChildLogger("SharedStateParameterMapping");
		const promiseExecQueue = new PromiseExecQueue(logger);
		const listenerTracker = ListenerTracker.createTracker();

		let sharedStateUnrefCallback;

		debugInfo.active = false;
		debugInfo.groupPath = null;
		debugInfo.name = name;

		if (!self._sharedStateDebugList) self._sharedStateDebugList = [];
		self._sharedStateDebugList.push(debugInfo);
		self.event.emit("_sharedStateDebugChange");

		const destructor = function() {
			listenerTracker.removeAllListeners();
			if (sharedStateUnrefCallback) {
				sharedStateUnrefCallback();
				sharedStateUnrefCallback = null;
			}
			debugInfo.active = false;
			debugInfo.groupPath = null;
			self.event.emit("_sharedStateDebugChange");
		};

		self.destructorFunctions.push(function() {
			destructor();
			promiseExecQueue.destroy();
		});

		const setup = function() {
			let blockLatch;
			if (blockSignal) blockLatch = blockSignal.latch();
			const p = promiseExecQueue.enqueue(function() {
				destructor();
				promiseExecQueue.cancelAll();
				const groupPath = groupPathFunc();
				if (groupPath && !self._destructed) {
					debugInfo.groupPath = groupPath;
					self.event.emit("_sharedStateDebugChange");
					const path = groupPath.path;
					return self._createSharedStateFromGroupMappingWithRetry(path, {
							parentLogger: logger,
							cached: true,
							returnObject: true,
						}).then(function(info) {
							const ss = info.sharedState;
							if (self._destructed) {
								// component destroyed whilst shared state setup in flight
								info.unref();
								return;
							}
							sharedStateUnrefCallback = info.unref;
							sharedStateChangeCallback(ss, groupPath.propertyPrefix || null, listenerTracker);

							listenerTracker.subscribeTo(ss).on('readystatechange', function() {
								if (blockLatch && ss.readyState === 'open') blockLatch();
								debugInfo.active = (ss.readyState === 'open');
								self.event.emit("_sharedStateDebugChange");
							});
						}).catch(function(err) {
							if (blockLatch) blockLatch();
							debugInfo.error = "Failed to create shared state from mapping: " + path + ", due to: " + JSON.stringify(err);
							self.dMAppController.devDialogLogger.error(self.getName() + ": Failed to create shared state from mapping: " + path + ", due to: ", err);
							return Promise.reject(err);
						});
				} else {
					sharedStateChangeCallback(null, null, listenerTracker);
					if (blockLatch) blockLatch();
				}
			});
			if (blockLatch) p.catch(blockLatch);
		};
		return setup;
	},

	_setupAttributeFlushCtl: function() {
		const self = this;
		if (self._attributeFlushBlock) return;
		Object.defineProperties(self, {
			_attributeFlushBlock: { value: new Signal.BlockCountSignal() },
			_attributeFlushMap:   { value: new Map() },
		});
		self._attributeFlushBlock.on("fall", function() {
			if (!self._attributeFlushMap.size) return;

			self.logger.debug("Flushing " + self._attributeFlushMap.size + " attribute writes: " + Array.from(self._attributeFlushMap.keys()).join(", "));
			const elem = self.getComponentElement();
			for (let [k, v] of self._attributeFlushMap) {
				k = k.toLowerCase();
				if (v != null) {
					elem.setAttribute(k, v);
				} else {
					elem.removeAttribute(k);
				}
			}
			self._attributeFlushMap.clear();
		});
	},

	_bufferedSetAttribute: function(k, v) {
		k = k.toLowerCase();
		if (this._attributeFlushBlock && this._attributeFlushBlock.isBlocked()) {
			this._attributeFlushMap.set(k, v);
		} else if (v != null) {
			this.getComponentElement().setAttribute(k, v);
		} else {
			this.getComponentElement().removeAttribute(k);
		}
	},

	_bufferedGetAttribute: function(k) {
		k = k.toLowerCase();
		if (this._attributeFlushBlock && this._attributeFlushBlock.has(k)) {
			return this._attributeFlushMap.get(k);
		} else {
			this.getComponentElement().getAttribute(k);
		}
	},

	/**
	 * Setup mapping of component element attributes to a shared state mapping descriptor.
	 *
	 * Attribute names are lower-cased.
	 *
	 * @param {Array.<(string|SharedStateMappedElementAttributeDescriptor)>} attributeList List of attribute names and/or descriptors to map
	 * @param {StateMapping.SharedStateMappingBase} stateMapping Shared state mapping descriptor
	 * @param {Object=} options Optional options object
	 * @param {Blockable=} options.blockable Optional blockable to block
	*/
	setupSharedStateElementAttributeMapping: function(attributeList, stateMapping, options) {
		const self = this;
		const logger = self.logger.makeChildLogger("SharedStateElementAttributeMapping");

		argCheck(arguments, 3, logger, "setupSharedStateElementAttributeMapping", options, ['blockable']);
		if (!options) options = {};

		let mutationObserver;
		let sharedState;
		let fullPrefix;
		const debugInfo = {
			attributeList: attributeList,
		};

		if (!self._sharedStateUsedAttribsMap) self._sharedStateUsedAttribsMap = new Map();

		self.destructorFunctions.push(function() {
			sharedState = null;
			if (mutationObserver) {
				mutationObserver.disconnect();
				mutationObserver = null;
			}
		});

		stateMapping.setup(self, logger);

		const attribChangesPending = new Set();
		const attributeLastWriteMap = new Map();

		const attributeMonitorList = [];
		const attributeUsedList = [];
		const attributeReadOnlySet = new Set();
		const attributeToSharedStateCopyMap = new Map();
		const sharedStateToAttributeCopyMap = new Map();
		const attributeGetterMap = new Map();
		const attributeSetterMap = new Map();
		for (let i = 0; i < attributeList.length; i++) {
			const item = attributeList[i];
			if (typeof item === "string") {
				const attribName = item.toLowerCase();
				attributeMonitorList.push(attribName);
				attributeUsedList.push(attribName);
				attributeToSharedStateCopyMap.set(attribName, item);
				sharedStateToAttributeCopyMap.set(item, attribName);
			} else if (typeof item === "object") {
				argCheck([], 0, logger, "Shared state element attribute mapping: attribute definition object", item, ['attribName', 'getter', 'setter', 'sharedStateName', 'readonly']);
				if (!item.attribName || typeof item.attribName !== "string") {
					logger.throwError("Unexpected or missing attribute item attribName value in shared state element attribute mapping: ", item);
				}
				const attribName = item.attribName.toLowerCase();
				attributeUsedList.push(attribName);
				attributeMonitorList.push(attribName);
				const readonly = !!(item.readonly);
				if (readonly) {
					attributeReadOnlySet.add(attribName);
				}
				if (item.getter) {
					if (typeof item.getter !== "function") {
						logger.throwError("Unexpected or missing attribute item getter function in shared state element attribute mapping: ", item);
					}
					attributeGetterMap.set(attribName, item.getter);
				}
				if (item.setter) {
					if (typeof item.setter !== "function") {
						logger.throwError("Unexpected attribute item setter function in shared state element attribute mapping: ", item);
					}
					if (readonly) {
						logger.throwError("Attribute item: 'setter' cannot be specified when attribute item: 'readonly' is true", item);
					}
					attributeSetterMap.set(attribName, item.setter);
				}
				if (item.sharedStateName) {
					if (typeof item.sharedStateName !== "string") {
						logger.throwError("Unexpected attribute item sharedStateName value in shared state element attribute mapping: ", item);
					}
					attributeToSharedStateCopyMap.set(attribName, item.sharedStateName);
					sharedStateToAttributeCopyMap.set(item.sharedStateName, attribName);
				}
				if (item.getter && item.sharedStateName) {
					logger.throwError("No more than one of attribute items: 'getter' and 'sharedStateName' may be specified", item);
				}
				if (item.setter && (!item.getter)) {
					logger.throwError("Attribute item: 'setter' cannot be specified unless attribute item: 'getter' is also specified", item);
				}
				if ((!item.setter) && item.getter) {
					attributeReadOnlySet.add(attribName);
				}
				if (!(item.getter) && !(item.sharedStateName)) {
					const sharedStateName = item.attribName; // no lower-casing
					attributeToSharedStateCopyMap.set(attribName, sharedStateName);
					sharedStateToAttributeCopyMap.set(sharedStateName, attribName);
				}
			} else {
				logger.throwError("Unexpected attribute item in shared state element attribute mapping: ", item);
			}
		}
		for (let i = 0; i < attributeUsedList.length; i++) {
			if (self._sharedStateUsedAttribsMap.has(attributeUsedList[i])) {
				logger.warn("Attempted to use element attribute: '" + attributeUsedList[i] + "' more than once in '" + name + "', previous use in '" + self._sharedStateUsedAttribsMap.get(attributeUsedList[i]) + "'");
			} else {
				self._sharedStateUsedAttribsMap.set(attributeUsedList[i], name);
			}
		}

		const handleAttribChange = function(attrib, value, sharedState) {
			if (attributeReadOnlySet.has(attrib)) {
				const expected = attributeLastWriteMap.get(attrib);
				if (value !== expected) {
					logger.warn("Read-only mapped attribute unexpectedly changed: '" + attrib + "': '" + expected + "' -> '" + value + "'");
				}
				return;
			}
			const sharedStateName = attributeToSharedStateCopyMap.get(attrib);
			if (sharedStateName) {
				if (sharedState.getItem(fullPrefix + sharedStateName) !== value) {
					sharedState.setItem(fullPrefix + sharedStateName, value);
				}
			} else {
				const setter = attributeSetterMap.get(attrib);
				if (setter) {
					const sharedStateProxy = {
						getItem: function(key, options) {
							return sharedState.getItem(fullPrefix + key, options);
						},
						setItem: function(key, value, options) {
							return sharedState.setItem(fullPrefix + key, value, options);
						},
					};
					setter(sharedStateProxy, attrib, value);
				}
			}
		};

		mutationObserver = new MutationObserver(function(mutations) {
			if (sharedState && sharedState.readyState === "open") {
				sharedState.request();
				mutations.forEach(function(mutation) {
					if (mutation.type === 'attributes') {
						const attrib = mutation.attributeName;
						const target = mutation.target;
						const value = target.getAttribute(attrib);
						handleAttribChange(attrib, value, sharedState);
					}
				});
				sharedState.send();
			} else {
				mutations.forEach(function(mutation) {
					if (mutation.type === 'attributes') {
						attribChangesPending.add(mutation.attributeName);
					}
				});
			}
		});

		// Listen for attribute changes
		const config = { attributes: true, attributeFilter: attributeMonitorList };
		const elem = self.getComponentElement();
		if (!elem) {
			logger.error("Component does not have an element");
			return;
		}
		mutationObserver.observe(elem, config);

		logger.debug("Monitoring local element attributes: " + attributeMonitorList.join(", "));

		const prefixSeparator = stateMapping.getPropertyPrefixSeparator();

		const setup = self._setupDynPathSharedStateInstance(stateMapping.getGroupPath.bind(stateMapping), stateMapping.getName(), debugInfo, function(ss, propertyPrefix, listenerTracker) {
			sharedState = ss;
			fullPrefix = propertyPrefix ? propertyPrefix + prefixSeparator : "";
			if (sharedState) {
				const subscriber = listenerTracker.subscribeTo(sharedState);
				// Replicate shared state changes to attribute values
				subscriber.on('change', function(data) {
					const keySplit = data.key.split(prefixSeparator, 2);
					if (keySplit.length === 1 && propertyPrefix) return;
					if (keySplit.length > 1 && (!propertyPrefix || keySplit[0] !== propertyPrefix)) return;
					const key = keySplit[keySplit.length - 1];
					const attrib = sharedStateToAttributeCopyMap.get(key);
					if (attrib) {
						if (data.value !== elem.getAttribute(attrib)) {
							attributeLastWriteMap.set(attrib, data.value);
							self._bufferedSetAttribute(attrib, data.value);
						}
					}
					const sharedStateProxy = {
						getItem: function(key, options) {
							return sharedState.getItem(fullPrefix + key, options);
						},
					};
					for (let [key, value] of attributeGetterMap) {
						const current = elem.getAttribute(key);
						const updated = value(sharedStateProxy, key, current);
						if (updated !== current) {
							attributeLastWriteMap.set(key, updated);
							self._bufferedSetAttribute(key, updated);
						}
					}
				});

				subscriber.on('readystatechange', function() {
					if (ss.readyState === 'open') {
						if (attribChangesPending.size) {
							sharedState.request();
							for (let attrib of attribChangesPending) {
								handleAttribChange(attrib, elem.getAttribute(attrib), sharedState);
							}
							attribChangesPending.clear();
							sharedState.send();
						}
					}
				});
			}
		}, options.blockable);
		stateMapping.setSetupClosure(setup);
	},

	/**
	 * Setup read-only mapping of component parameter overlay from a shared state mapping descriptor.
	 *
	 * @param {Array.<(string|SharedStateMappedParameterDescriptor)>} parameterList List of parameter names and/or descriptors to map
	 * @param {StateMapping.SharedStateMappingBase} stateMapping Shared state mapping descriptor
	*/
	setupSharedStateParameterOverlayMapping: function(parameterList, stateMapping) {
		const self = this;
		const logger = self.logger.makeChildLogger("SharedStateParameterOverlayMapping");
		const debugInfo = {
			parameterList: parameterList,
		};

		stateMapping.setup(self, logger);

		const sharedStateToParameterCopyMap = new Map();
		for (let i = 0; i < parameterList.length; i++) {
			const item = parameterList[i];
			if (typeof item === "string") {
				sharedStateToParameterCopyMap.set(item, item);
			} else if (typeof item === "object") {
				argCheck([], 0, logger, "Shared state parameter overlay mapping: attribute definition object", item, ['paramName', 'sharedStateName']);
				if (!item.paramName || typeof item.paramName !== "string") {
					logger.throwError("Unexpected or missing attribute item attribName value in shared state parameter overlay mapping: ", item);
				}
				if (item.sharedStateName) {
					if (typeof item.sharedStateName !== "string") {
						logger.throwError("Unexpected attribute item sharedStateName value in shared state parameter overlay mapping: ", item);
					}
					sharedStateToParameterCopyMap.set(item.sharedStateName, item.paramName);
				} else {
					sharedStateToParameterCopyMap.set(item.paramName, item.paramName);
				}
			} else {
				logger.throwError("Unexpected attribute item in shared state parameter overlay mapping: ", item);
			}
		}

		const prefixSeparator = stateMapping.getPropertyPrefixSeparator();

		const overlaySignal = new Signal.SettableSignal({});
		const setup = self._setupDynPathSharedStateInstance(stateMapping.getGroupPath.bind(stateMapping), stateMapping.getName(), debugInfo, function(sharedState, propertyPrefix, listenerTracker) {
			if (!sharedState) {
				overlaySignal.setValue({});
			} else {
				const fullPrefix = propertyPrefix ? propertyPrefix + prefixSeparator : "";
				listenerTracker.subscribeTo(sharedState).on('changeset', function() {
					const params = {};
					for (let [shareName, paramName] of sharedStateToParameterCopyMap) {
						const value = sharedState.getItem(fullPrefix + shareName);
						if (value !== undefined) params[paramName] = value;
					}
					overlaySignal.setValue(params);
				});
			}
		}, self._parameterBlockSignal);
		// NB: self._parameterBlockSignal is blocked here to avoid bouncing the component parameters in the interval whilst the shared state object is not yet connected, in particular at init
		stateMapping.setSetupClosure(setup);
		self.addEffectiveParameterSignalOverlay(stateMapping.getName(), overlaySignal, 0.5);
	},

	setupGroupParameterSharedStateElementAttributeMapping: function(attributeList, options) {
		return this.setupSharedStateElementAttributeMapping(attributeList, new StateMapping.ContextGroupParameterSharedStateMapping(options));
	},

	setupContextGlobalSharedStateElementAttributeMapping: function(attributeList, options) {
		return this.setupSharedStateElementAttributeMapping(attributeList, new StateMapping.ContextGlobalSharedStateMapping(options));
	},

	_clockInfo: function() {
		return this.dMAppController.timeline.getClockInfo(this.referenceClock);
	},

	/**
	 * @typedef {Object} DMAppComponent~GetDMAppComponentSignalResult
	 * @prop {!Signal.BaseSignal.<?DMAppComponent>} signal Signal of DMApp component, this has a value of the component instance when the component exists, and null otherwise
	 * @prop {!Function} unref Use this method to signal that the signal instance is no longer required, this will decrement its ref count
	 */

	/**
	 * Get DMApp component signal of the top-level component with the given ID in the same context/DMApp (or lack thereof) as the current component, incrementing its ref count and creating it if it doesn't already exist.
	 *
	 * @param {!string} id DMApp component ID (short/unprefixed)
	 * @return {!DMAppComponent~GetDMAppComponentSignalResult} Signal result, this is scoped to be within the component lifetime
	*/
	getTopLevelDMAppComponentSignalById: function(id) {
		const fullId = (this.dMAppComponentContextId && this.dMAppComponentDMAppId) ? '/' + this.dMAppComponentContextId + '/' + this.dMAppComponentDMAppId + '/' + id : id;
		const info = this.dMAppController.layout.componentContainer.getDMAppComponentSignal(fullId);
		this.destructorFunctions.push(info.unref);
		return info;
	},

	/**
	 * Get DMApp component signal of the child component of this component with the given ID, incrementing its ref count and creating it if it doesn't already exist
	 *
	 * @param {!string} id DMApp component ID (short/unprefixed)
	 * @return {!DMAppComponent~GetDMAppComponentSignalResult} Signal result, this is scoped to be within the component lifetime
	*/
	getChildDMAppComponentSignalById: function(id) {
		const info = this.getChildComponentContainer().getDMAppComponentSignal(id);
		this.destructorFunctions.push(info.unref);
		return info;
	},

	/**
	 * Get child component container for this component (created on first call)
	 *
	 * @return {ComponentContainer}
	*/
	getChildComponentContainer: function() {
		if (!this.hasOwnProperty("_childComponentContainer")) {
			if (this._destructed) this.logger.throwError("Cannot create child component container after destruction");
			Object.defineProperty(this, '_childComponentContainer', { value: new DMAppLayoutUtil.ComponentContainer(null, this.logger) });
			this.destructorFunctions.push(this._childComponentContainer.destroy.bind(this._childComponentContainer));
			this.event.emit('_newChildComponentContainer');
		}
		return this._childComponentContainer;
	},

	/**
	 * Create child component.
	 * The new component is created in the {@link ComponentContainer} returned by {@link DMAppComponent#getChildComponentContainer}.
	 * The new component's lifetime is limited to be within that of its parent (this component).
	 *
	 * @param {?Object} options Optional options object
	 * @param {boolean} [options.propagatePresentable=true] Whether to propagate presentable state from child to parent component
	 * @param {boolean} [options.propagateDuration=false] Whether to copy duration estimate from child to parent component
	 * @param {boolean} [options.propagateExitTransitionInProgress=false] Whether to propagate exit transition in progress state from child to parent component
	 * @param {boolean} [options.inheritStartStop=true] Whether to copy start/stop times from parent to child component
	 * @param {boolean} [options.inheritSoftStopped] Whether to copy soft-stopped state from parent to child component, this defaults to the value of options.inheritStartStop
	 * @param {boolean} [options.inheritVisibilityBlockSignal=false] Whether to copy visibility block signal state from parent to child component
	 * @param {boolean} [options.inheritLayoutInstanceId=true] Whether to copy layout instance ID from parent to child component
	 * @param {boolean} [options.inheritLayoutConfig=false] Whether to copy layout config (excluding instance ID) from parent to child component
	 * @param {?string} url Optional HTML import URL to load before constructing component
	 * @param {!string} id component ID
	 * @param {!string} typeName component type name
	 * @param {?Object} config initial config
	 * @param {(Object|Signal.BaseSignal.<Object>)=} config.parameters optional initial parameters, see {@link DMAppComponent#setParameters}. If this is a signal, changes to the signal are propagated to the child component parameters.
	 * @param {Object=} config.layout optional initial layout, see {@link DMAppComponent#setLayout}
	 * @param {String=} config.contextId optional context ID override for this component (this is only required in Special Circumstances)
	 * @param {String=} config.dmAppId optional DMApp ID override for this component (this is only required in Special Circumstances)
	 * @param {boolean=} [config.noElementDomAttachmentCtl=false] Whether to the set child component's {@link DMAppComponent#noElementDomAttachmentCtl} field.
	 * @return {Promise.<DMAppComponent>} Promise of child component
	*/
	createChildDMAppComponent: function(options, url, id, typeName, config) {
		const self = this;
		const cfg = {
			propagatePresentable: true,
			propagateDuration: false,
			inheritStartStop: true,
			inheritLayoutInstanceId: true,
			inheritLayoutConfig: false,
		};
		if (options) {
			argCheck([], 0, this.logger, "createChildDMAppComponent options", options, ['propagatePresentable', 'propagateDuration', 'propagateExitTransitionInProgress', 'inheritStartStop', 'inheritVisibilityBlockSignal',
					'inheritLayoutInstanceId', 'inheritSoftStopped', 'inheritLayoutConfig']);
			$.extend(cfg, options);
		}
		const aux = {
			applyConfig: true,
			componentContainer: this.getChildComponentContainer(),
			componentNamePrefix: this.getName() + '/',
		};
		{
			const oldCfg = config;
			config = {
				contextId: this.dMAppComponentContextId,
				dmAppId: this.dMAppComponentDMAppId,
			};
			if (oldCfg) $.extend(config, oldCfg);
		}
		if (cfg.inheritStartStop) {
			if (!config) config = {};
			config.startTime = this.dMAppStartTime;
			config.stopTime = this.dMAppStopTime;
			aux.ignoreComponentInfoStartStop = true;
		}
		if (cfg.inheritSoftStopped != null ? cfg.inheritSoftStopped : cfg.inheritStartStop) {
			aux.trackSoftStopped = self.softStopped;
		}
		if (cfg.inheritVisibilityBlockSignal) {
			aux.trackVisibilityBlockSignal = self.visibilityBlockSignal;
		}
		if (cfg.inheritLayoutInstanceId) {
			aux.layoutInstanceId = this.layoutInstanceId;
		}
		if (cfg.inheritLayoutConfig) {
			if (!aux.trackSoftStopped) aux.trackSoftStopped = self._getLayoutSoftStoppedBlockSignal();
		}
		const componentPromise = this.dMAppController.layout._intlCreateDMAppComponentWithUrl.apply(this.dMAppController.layout, [aux, url, id, typeName, config].concat([].slice.call(arguments, 5)));
		if (cfg.propagatePresentable) {
			const latch = this.presentableGate.latch();
			componentPromise.then(function(comp) {
				return comp.presentablePromise;
			}).then(latch, latch);
		}
		if (cfg.propagateDuration) {
			componentPromise.then(function(comp) {
				if (comp._durationEstimate != null) {
					self.setTimelineDurationEstimate(comp._durationEstimate, true);
				}
				comp.event.on("dMAppComponentStatusDurationChange", function(info) {
					self.setTimelineDurationEstimate(info.newDuration, true);
				});
			});
		}
		if (cfg.propagateExitTransitionInProgress) {
			componentPromise.then(function(comp) {
				const signal = comp.getExitTransitionSignal();
				const update = function() {
					self.getExitTransitionSignal().setReferenceRegistered(signal, signal.getValue());
				};
				signal.on('toggle', update);
				if (signal.getValue()) update();
			});
		}
		if (cfg.inheritStartStop) {
			const ssTracker = ListenerTracker.createTracker();
			ssTracker.subscribeTo(self.event).on("startStopTimeChange", UpdateUtil.makeUpdateWhenReadyClosure(componentPromise, function(component) {
				component.setComponentStartStop(self.dMAppStartTime, self.dMAppStopTime);
			}));

			componentPromise.then(function(comp) {
				comp.event.on("destroy", function(info) {
					ssTracker.removeAllListeners();
				});
			}, function() {
				ssTracker.removeAllListeners();
			});
		}
		if (cfg.inheritLayoutConfig) {
			componentPromise.then(function(comp) {
				comp.addEffectiveLayoutSignalOverlay("Inherit parent layout", self._effectiveLayoutSignal, -1);
			});
		}
		return componentPromise;
	},

	/**
	 * Get signal by name, scoped to the lifetime of this component
	 *
	 * This is a wrapper around {@link DMAppController#getSignalByName} which registers the returned unref callback to be executed in this component's destructor.
	 *
	 * @param {!string} name Prefix followed by arbitrary string key
	 * @param {object=} options Optional options object, see {@link DMAppController#getSignalByName}
	 * @returns {!DMAppController~GetRefCountedSignalResult} Signal result, if the signal that was requested is not actually ref-counted, calling unref has no effect, however the caller MUST NOT assume that the signal is not ref-counted unless options.nonRefCountedOnly is specified. unref MAY be null if options.unrefFuncNullable is true.
	 */
	getSignalByNameScoped: function(name, options) {
		const opts = {};
		if (options) {
			$.extend(opts, options);
		}
		opts.unrefFuncNullable = true;
		const info = this.dMAppController.getSignalByName(name, opts);
		if (info.unref) {
			this.destructorFunctions.push(info.unref);
			return info;
		} else if (options && options.unrefFuncNullable) {
			return info;
		} else {
			return {
				signal: info.signal,
				unref: function() {},
			};
		}
	},

	/**
	 * See {@link DebugMiscUtil.DebugDumpable#setupComponentDebugEvents}
	 *
	 * If this method is overridden, the parent implementation SHOULD be called.
	 *
	 * It is generally only necessary to implement this method if {@link DMAppComponent#dumpDebugInfo} is also implemented.
	 *
	 * @implements DebugMiscUtil.DebugDumpable#setupComponentDebugEvents
	 *
	 * @param {ListenerTracker} listenerTracker Listener tracker to subscribe to events on
	 * @param {Function} func Callback function to use for event subscriptions
	*/
	setupComponentDebugEvents: function(listenerTracker, func) {
		const tracker = listenerTracker.subscribeTo(this.event);
		tracker.on("dMAppComponentStatusChange", func);
		tracker.on("dMAppComponentStatusDurationChange", func);
		tracker.on("referenceClockChange", func);
		tracker.on("visibilityChange", func);
		tracker.on("startStopTimeChange", func);
		tracker.on("runningStateChange", func);
		tracker.on("componentInfoUpdate", func);
		tracker.on("_effectiveParameterSourceChange", func);
		tracker.on("_effectiveLayoutSourceChange", func);
		tracker.on("_sharedStateDebugChange", func);
		tracker.on("_newChildComponentContainer", func);
		listenerTracker.subscribeTo(this._effectiveLayoutSignal).on("change", func);

		// Don't trigger _haveWarnedNoParamHandler when adding debug event listener
		const haveWarnedNoParamHandler = this._haveWarnedNoParamHandler;
		listenerTracker.subscribeTo(this.effectiveParameterSignal).on("change", func);
		this._haveWarnedNoParamHandler = haveWarnedNoParamHandler;
		listenerTracker.subscribeTo(this.softStopped).on("toggle", func);
		listenerTracker.subscribeTo(this.visibilityBlockSignal).on("toggle", func);
		listenerTracker.subscribeTo(this.visibilityBlockSignalNonInherited).on("toggle", func);
	},

	_dumpObj: function(cat, data) {
		const items = [];
		try {
			const path = [];
			const traverse = function(obj) {
				for (let prop in obj) {
					path.push(prop);
					if (obj[prop] && typeof obj[prop] === 'object') {
						traverse(obj[prop]);
					} else {
						items.push({ key: path.join("."), value: obj[prop] });
					}
					path.pop();
				}
			};
			traverse(data);
		} catch(e) {
			this.logger.error("Failed to traverse whilst dumping debug info: ", e);
		}
		items.sort(function(a, b) {
			return String.prototype.localeCompare.call(a.key, b.key);
		});
		for (let i = 0; i < items.length; i++) {
			let v = items[i].value;
			if (typeof v !== "number") {
				v = JSON.stringify(v, null, 2);
			}
			cat.keyValue(items[i].key, v);
		}
	},

	/**
	 * See {@link DebugMiscUtil.DebugDumpable#dumpDebugInfo}
	 *
	 * If this method is overridden, the parent implementation SHOULD be called.
	 *
	 * Typically you will also need to implement {@link DMAppComponent#setupComponentDebugEvents}.
	 *
	 * @implements DebugMiscUtil.DebugDumpable#dumpDebugInfo
	 *
	 * @param {DebugMiscUtil.DebugDumper} dumper Dumper to dump to
	*/
	dumpDebugInfo: function(dumper) {
		const cat = dumper.subcategory("DMAppComponentBehaviour");
		let status = EnumUtil.enumToString(this.COMPONENT_STATUS, this.dMAppComponentStatus) +
				" (" + this.stringifyDMAppComponentStatus(this.dMAppComponentStatus) + ")";
		if (this._durationEstimate != null) status += ", duration: " + this._durationEstimate;
		cat.keyValue("DMAppC status", status);
		cat.keyValue("visibility", this._currentVisbility);
		cat.keyValue("visibility block signal", this.visibilityBlockSignal.isBlocked());
		cat.keyValue("visibility block signal (non inherited)", this.visibilityBlockSignalNonInherited.isBlocked());
		cat.keyValue("running state", EnumUtil.enumToString(this.RUNNING_STATE, this.getRunningState()));
		cat.keyValue("is running", this.isRunning());
		if (this._exitTransitionSignal) cat.keyValue("exit transition in progress", !!this._exitTransitionSignal.getValue());
		cat.keyValue("soft stopped", this.softStopped.isBlocked());
		cat.keyValue("ref. clock", this.dMAppController.timeline.getClockName(this.referenceClock));
		cat.keyValue("start time", this.dMAppStartTime);
		cat.keyValue("stop time", this.dMAppStopTime);
		cat.keyValue("Context ID", this.dMAppComponentContextId);
		cat.keyValue("DMApp ID", this.dMAppComponentDMAppId);
		cat.keyValue("Full component ID", this.dMAppComponentFullId);
		cat.keyValue("Layout instance ID", this.layoutInstanceId);
		cat.keyValue("Revision ID", this.dMAppComponentRevision);

		const dumpOverlay = function(overlays, name, postfix) {
			if (overlays.length > 1 || (overlays.length === 1 && overlays[0].origSignal && !deepEql(overlays[0].origSignal.getValue(), overlays[0].signal.getValue()))) {
				const cat = dumper.subcategory(name + " overlay set");
				for (let i = 0; i < overlays.length; i++) {
					const overlay = overlays[i];
					if (overlay.isTransform) {
						cat.value(overlay.priority + ": " + name + " transform: " + overlay.name);
					} else {
						let prefix = '';
						if (overlay.priority !== 0) {
							prefix = overlay.priority + ": " + (overlay.priority < 0 ? "Underlay" : "Overlay") + postfix + ": ";
						}
						if (overlay.origSignal && !deepEql(overlay.origSignal.getValue(), overlay.signal.getValue())) {
							this._dumpObj(cat.subcategory(prefix + overlay.name + " (original)"), overlay.origSignal.getValue());
							this._dumpObj(cat.subcategory(prefix + overlay.name + " (filtered)"), overlay.signal.getValue());
						} else {
							this._dumpObj(cat.subcategory(prefix + overlay.name), overlay.signal.getValue());
						}
					}
				}
			}
		}.bind(this);

		dumpOverlay(this._parameterOverlays, "Parameter", " parameters");
		if (this.effectiveParameterSignal.getValue() && !$.isEmptyObject(this.effectiveParameterSignal.getValue())) {
			this._dumpObj(dumper.subcategory("Parameters"), this.effectiveParameterSignal.getValue());
		}

		dumpOverlay(this._layoutOverlays, "Layout", " layout");
		if (this._effectiveLayoutSignal.getValue() && !$.isEmptyObject(this._effectiveLayoutSignal.getValue())) {
			this._dumpObj(dumper.subcategory("Layout"), this._effectiveLayoutSignal.getValue());
		}

		if (this._sharedStateDebugList) {
			const sscat = dumper.subcategory("Shared State");
			for (let i = 0; i < this._sharedStateDebugList.length; i++) {
				const info = this._sharedStateDebugList[i];
				const itemcat = sscat.subcategory(info.name);
				if (info.error) itemcat.keyValue("Error", info.error);
				itemcat.keyValue("Active", info.active);
				if (info.groupPath) {
					itemcat.keyValue("Group path", info.groupPath.path);
					itemcat.keyValue("Group property prefix", info.groupPath.propertyPrefix);
				}
				if (info.attributeList) {
					itemcat.keyValue("Attributes", info.attributeList.map(function(attrib) {
						if (attrib && typeof attrib === "object") {
							const list = [];
							if (attrib.getter) list.push("getter");
							if (attrib.setter) list.push("setter");
							if (attrib.sharedStateName) list.push("sharedStateName = " + attrib.sharedStateName);
							return attrib.attribName + " [" + list.join(", ") + "]";
						} else {
							return attrib;
						}
					}).join(", "));
				}
				if (info.parameterList) {
					itemcat.keyValue("Parameters", info.parameterList.map(function(attrib) {
						if (attrib && typeof attrib === "object") {
							const list = [];
							if (attrib.sharedStateName) list.push("sharedStateName = " + attrib.sharedStateName);
							return attrib.paramName + " [" + list.join(", ") + "]";
						} else {
							return attrib;
						}
					}).join(", "));
				}
			}
		}
		if (this._componentImportInfo) {
			const ciicat = dumper.subcategory("HTML Import");
			ciicat.keyValue("URL", this._componentImportInfo.url);
			if (this._componentImportInfo.orig_url) ciicat.keyValue("Original URL", this._componentImportInfo.orig_url);
		}
		if (this.layoutIndependent || this.noElementDomAttachmentCtl || this._originalDMAppComponentTypeName || this._masqueradeDestroyed || this.applyLayoutBlockSignal.isBlocked()) {
			const cat = dumper.subcategory("Misc");
			if (this.layoutIndependent) cat.keyValue("layout independent", this.layoutIndependent);
			if (this._masqueradeDestroyed) cat.keyValue("masquerade destroyed", this._masqueradeDestroyed);
			if (this.applyLayoutBlockSignal.isBlocked()) cat.keyValue("layout apply blocked", this.applyLayoutBlockSignal.isBlocked());
			if (this.noElementDomAttachmentCtl) cat.keyValue("no DOM auto attach/detach", this.noElementDomAttachmentCtl);
			if (this._originalDMAppComponentTypeName) cat.keyValue("original type name", this._originalDMAppComponentTypeName);
		}
		if (this.hasOwnProperty("_childComponentContainer")) {
			dumper.componentContainer(this._childComponentContainer, "Child components");
		}
		{
			const self = this;
			const dscat = dumper.subcategory("Debug Special", false);
			dscat.button("Self-destruct", function() {
				self.logger.warn("Manual self-destruct requested");
				self.requestDestruction();
			});
			if (self.requestDestruction !== DMAppComponentBehaviour.requestDestruction) {
				dscat.button("Self-destruct immediately", function() {
					self.logger.warn("Manual immediate self-destruct requested");
					self._selfDestruct();
				});
			}
			if (self.rootLayout) {
				dscat.button("Self-destruct and re-init", function() {
					self.logger.warn("Manual self-destruct and re-init requested");

					const args = [
						{
							importInfo: self._componentImportInfo,
							componentNamePrefix: self.dMAppComponentNamePrefix,
							applyConfig: true,
							componentContainer: self._parentComponentContainer,
						},
						self.dMAppComponentFullId,
						self.dMAppComponentTypeName,
						{
							layoutIndependent: self.layoutIndependent,
							noElementDomAttachmentCtl: self.noElementDomAttachmentCtl,
							layout: self.dMAppComponentInfo ? self.dMAppComponentInfo.layout : null,
							parameters: self.dMAppComponentInfo ? self.dMAppComponentInfo.parameters : null,
							componentId: self.dMAppComponentId,
							contextId: self.dMAppComponentContextId,
							dmAppId: self.dMAppComponentDMAppId,
						},
					];
					self.layoutIndependent = true;
					self._selfDestruct();
					self.rootLayout._intlCreateDMAppComponent.apply(self.rootLayout, args);
				});
			}
			dscat.button("Show in console", function() {
				/* global console */
				window._comp_ = self;
				console.info("Debug: Show in console: " + self.dMAppComponentFullId + ": window._comp_ = ", self);
			});

			if (!self._debugDumpSetSoftStopped) {
				self._debugDumpSetSoftStopped = new Signal.SettableSignal(false, { boolean: true });
				self._debugDumpSetSoftStopped.on('toggle', function() {
					self.softStopped.setBlockerRegistered(self._debugDumpSetSoftStopped, self._debugDumpSetSoftStopped.getValue());
				}, self.listenerTracker);
			}
			dscat.checkboxOption("Set soft-stopped", self._debugDumpSetSoftStopped);

			const dsovcat = dscat.subcategory("Special Overrides", false);
			dsovcat.multiInput("Manual parameter override", [
				{ type: "string", label: "Key" },
				{ type: "string", label: "Value" },
				{ type: "number", label: "Level", initial: 20 },
				{ type: "multiChoice", label: "Mode", initial: "typeFilter", choiceList: [
							{ name: "Type filtered", value: "typeFilter" },
							{ name: "Unfiltered String", value: "string" },
							{ name: "JSON", value: "json" },
							{ name: "Delete", value: "delete" },
						] },
			], self._handleManualParamOverrideCb.bind(self));
		}
	},

	_handleManualParamOverrideCb: function(values) {
		const self = this;
		const key = values[0];
		const value = values[1];
		const level = Number(values[2]);
		const type = values[3];
		self.logger.warn("Manual parameter override: ", JSON.stringify(values));

		if (!level || !key || !type) return;

		if (!self._manualParamOverrideMap) {
			self._manualParamOverrideMap = new Map();
		}
		let signal = self._manualParamOverrideMap.get(level);
		if (!signal) {
			if (type === "delete") return;
			signal = new Signal.SettableSignal({});
			self._manualParamOverrideMap.set(level, signal);
			self.addEffectiveParameterSignalOverlay("Debug: Manual override", signal, level);
		}

		const keyParts = key.split('.');
		const signalValue = $.extend(true, {}, signal.getValue());
		let base = signalValue;
		const newParams = {};
		let newBase = newParams;
		for (let i = 0; i < keyParts.length - 1; i++) {
			const k = keyParts[i];
			if (base[k] && typeof base[k] === "object") {
				base = base[k];
			} else if (type === "delete") {
				return;
			} else {
				base[k] = {};
				base = base[k];
			}
			newBase[k] = {};
			newBase = newBase[k];
		}
		const k = keyParts[keyParts.length - 1];
		delete base[k];
		switch (type) {
			case 'typeFilter':
				newBase[k] = value;
				$.extend(true, signalValue, self.filterConfigParameterObject(newParams));
				break;

			case 'string':
				newBase[k] = value;
				$.extend(true, signalValue, newParams);
				break;

			case 'json':
				newBase[k] = JSON.parse(value);
				$.extend(true, signalValue, newParams);
				break;
		}
		signal.setValue(signalValue);
	},

};

try {
	Object.freeze(DMAppComponentBehaviour);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppComponentBehaviour;
