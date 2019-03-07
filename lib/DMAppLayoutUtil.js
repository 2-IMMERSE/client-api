/************************************************************************/
/* FILE:                DMAppLayoutUtil.js                              */
/* DESCRIPTION:         DMApp layout utilities                          */
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
const exprParser = require('expr-eval').Parser;

const SafeEventEmitter = require('./SafeEventEmitter');
const PromiseExecQueue = require('./PromiseExecQueue');
const waitable = require('./waitable');
const Signal = require('./Signal');
const argCheck = require('./argCheck');
const MiscUtil = require('./MiscUtil');
const RefCountedSignalMap = require('./RefCountedSignalMap');

/**
 * Region definition object
 *
 * Element and elementSelector may not both be specified
 *
 * @typedef {Object} DMAppLayoutRegionCtl~RegionInfo
 * @prop {!(Array.<string>|string)} id Region ID (passed to layout service), an array MAY ONLY be used in calls to {@link DMAppLayoutRegionCtl#addLayoutRegions} to create multiple identical regions with different names
 * @prop {Element} element Region element node
 * @prop {string} elementSelector Region element CSS selector string. This may be used instead of element.
 * @prop {number|string} width Nominal region width. If a number: value in px, if a percentage: relative to window.innerWidth. If omitted the element's clientWidth property is used. (passed to layout service)
 * @prop {number|string} height Nominal region height. If a number: value in px, if a percentage: relative to window.innerHeight. If omitted the element's clientHeight property is used. (passed to layout service)
 * @prop {boolean} resizable Whether region is nominally resizeable (passed to layout service) (default true)
 * @prop {boolean} softStopComponentsOnZeroSize Whether components in this region are soft-stopped when either of the region's dimensions are <= 0 (default false)
 * @prop {boolean} suppressElementlessComponentWarning Whether to suppress warnings about attempts to place components without an element in this region (default false)
 * @prop {boolean} suppressFailedComponentPlaceholders Whether to suppress placeholder components which would otherwise be instantiated when a component fails to be loaded (default false)
 * @prop {boolean} columnMode Whether component coordinates in this region should be used for linear component ordering, instead of for component size/position (default false)
 * @prop {string} adjustWidth Optional expression used to adjust width values prior to sending to the layout service, evaluated using [expr-eval](https://www.npmjs.com/package/expr-eval) with input variables 'w' and 'h'
 * @prop {string} adjustHeight Optional expression used to adjust height values prior to sending to the layout service, evaluated using [expr-eval](https://www.npmjs.com/package/expr-eval) with input variables 'w' and 'h'
 * @prop {string} clientAdjustX Optional expression used to adjust x values (width and x offset) received from the layout service, evaluated using [expr-eval](https://www.npmjs.com/package/expr-eval) with input variables 'x' and 'y'
 * @prop {string} clientAdjustY Optional expression used to adjust y values (height and y offset) received from the layout service, evaluated using [expr-eval](https://www.npmjs.com/package/expr-eval) with input variables 'x' and 'y'
 */

/**
 * @classdesc
 *
 * Handles Layout Region List functionality.
 * This should not be directly constructed. Use: {@link DMAppLayout#layoutRegionCtl}.
 *
 * @extends EventEmitter
 *
 * @constructor
 * @param {DMAppLayout} layout parent DMAppLayout
 */

function DMAppLayoutRegionCtl(layout) {
	const self = this;
	Object.defineProperties(this, {
		parentLayout:         { value: layout },
		_regionList:          { value: new Map() },
		_blockSignal:         { value: new Signal.BlockCountSignal() },
		_pendingSignal:       { value: new Signal.SettableSignal(false, { boolean: true }) },
		_flushSignal:         { value: new Signal.SettableSignal(false, { boolean: true }) },
		logger:               { value: layout.logger.makeChildLogger("DMAppLayoutRegionCtl") },
		_rootRegion:          { value: { } },
	});
	Object.defineProperties(this._rootRegion, {
		id:                   { value: null },
		element:              { value: document.body, writable: true },
	});
	this._flushSignal.on("rise", this._flushLayoutRegionList.bind(this));
	this._flushSignal.setSignalTransform({ blocked: this._blockSignal, pending: this._pendingSignal, ctx: this.parentLayout._contextIdSignal }, function(params) {
		return params.pending.getValue() && !params.blocked.getValue() && params.ctx.getValue();
	});
	this.setSafeEventEmitterLogger(this.logger, "DMAppLayoutRegionCtl");
	const handler = self.checkRegionChanges.bind(self);
	window.addEventListener("resize", function() {
		self.checkRegionChanges();
		if (/Apple/.test(window.navigator.vendor)) {
			window.setTimeout(handler, 0);
			window.setTimeout(handler, 100);
		}
	});
	if (/Apple/.test(window.navigator.vendor)) {
		window.setInterval(handler, 1000);
	}
}
inherits(DMAppLayoutRegionCtl, SafeEventEmitter);

/**
 * Check layout region DOM elements for changes, and send updates to the layout service if necessary
 */
DMAppLayoutRegionCtl.prototype.checkRegionChanges = function() {
	let need_flush = false;
	for (let r of this._regionList.values()) {
		if (!(r.updateWidth || r.updateHeight)) continue;
		let w = r.origWidth;
		let h = r.origHeight;
		if (r.updateWidth) {
			w = r.origWidth = r.element.clientWidth;
		}
		if (r.updateHeight) {
			h = r.origHeight = r.element.clientHeight;
		}
		if (r.adjustWidthExpr) w = Math.round(r.adjustWidthExpr.evaluate({ w: r.origWidth, h: r.origHeight }));
		if (r.adjustHeightExpr) h = Math.round(r.adjustHeightExpr.evaluate({ w: r.origWidth, h: r.origHeight }));
		if (w !== r.width) {
			r.width = w;
			need_flush = true;
		}
		if (h !== r.height) {
			r.height = h;
			need_flush = true;
		}
	}
	if (need_flush) this._layoutRegionChange(true);
};

DMAppLayoutRegionCtl.prototype._flushLayoutRegionList = function() {
	const deviceId = this.parentLayout.dMAppController.getDeviceId();
	this.parentLayout.dMAppController.ajaxPromiseNX({
		method: "PUT",
		data: JSON.stringify(this._getRegionList(true)),
		contentType: "application/json; charset=utf-8",
		url: this.parentLayout.dMAppController._getUrl('layoutService') + "/context/" + this.parentLayout.contextId + "/devices/" + deviceId + "/region?reqDeviceId=" + deviceId,
	}).addBlockObject(this._blockSignal).setTitle("Flush layout region list change").enableAutoRetry(true).exec();
};

/**
 * Layout region change event.
 *
 * @event DMAppLayoutRegionCtl#layoutRegionChange
 */

DMAppLayoutRegionCtl.prototype._layoutRegionChange = function(setChangeFlag) {
	this._blockSignal.block();
	if (setChangeFlag) {
		this._pendingSignal.setValue(true);
	}
	this.emit("layoutRegionChange");
	this._blockSignal.unblock();
};

DMAppLayoutRegionCtl.prototype._getRegionList = function(clearChangeFlag) {
	const result = [];
	for (let item of this._regionList.values()) {
		result.push({
			regionId: item.id,
			displayWidth: item.width,
			displayHeight: item.height,
			resizable: (item.resizable != null) ? (!!item.resizable) : true,
		});
	}
	if (clearChangeFlag) this._pendingSignal.setValue(false);
	return result;
};

/**
 * Set root layout region DOM element
 *
 * @param {?Element} element Element, the default is document.body
 */
DMAppLayoutRegionCtl.prototype.setRootLayoutRegionElement = function(element) {
	this._rootRegion.element = element || document.body;
	this._layoutRegionChange();
};

const dimensionRe = /^(.+)%$/;
DMAppLayoutRegionCtl.prototype._fixupDimensionProp = function(obj, prop, percentageBase) {
	const input = obj[prop];
	let res = dimensionRe.exec(input);
	if (res) {
		obj[prop] = Math.round(res[1] * percentageBase / 100);
	}
};

/**
 * Add layout regions
 *
 * @param {...DMAppLayoutRegionCtl~RegionInfo} region Region info
 */
DMAppLayoutRegionCtl.prototype.addLayoutRegions = function() {
	const addRegion = function(info) {
		if (info.elementSelector) {
			if (info.element) {
				this.logger.warn("addLayoutRegions: element and elementSelector are both specified, not more than one may be used at once");
			} else {
				info.element = document.querySelector(info.elementSelector);
				if (!info.element) this.logger.warn("addLayoutRegions: elementSelector: '" + info.elementSelector + "' failed to return an element");
			}
			delete info.elementSelector;
		}
		if (info.columnMode) {
			if ((info.width != null && info.width !== 1) || info.adjustWidth != null) {
				delete info.adjustWidth;
				this.logger.warn("addLayoutRegions: ignoring invalid width value due to use of columnMode");
			}
			info.width = 1;
		} else if (info.width == null && info.element) {
			info.width = info.element.clientWidth;
			info.updateWidth = true;
		} else {
			this._fixupDimensionProp(info, 'width', window.innerWidth);
			delete info.updateWidth;
		}
		if (info.height == null && info.element) {
			info.height = info.element.clientHeight;
			info.updateHeight = true;
		} else {
			this._fixupDimensionProp(info, 'height', window.innerHeight);
			delete info.updateHeight;
		}
		info.origWidth = info.width;
		info.origHeight = info.height;
		if (info.adjustWidth != null) {
			info.adjustWidthExpr = exprParser.parse(info.adjustWidth);
			info.width = Math.round(info.adjustWidthExpr.evaluate({ w: info.origWidth, h: info.origHeight }));
		} else {
			delete info.adjustWidthExpr;
		}
		if (info.adjustHeight != null) {
			info.adjustHeightExpr = exprParser.parse(info.adjustHeight);
			info.height = Math.round(info.adjustHeightExpr.evaluate({ w: info.origWidth, h: info.origHeight }));
		} else {
			delete info.adjustHeightExpr;
		}
		if (info.clientAdjustX != null) {
			info.clientAdjustXExpr = exprParser.parse(info.clientAdjustX);
		} else {
			delete info.clientAdjustXExpr;
		}
		if (info.clientAdjustY != null) {
			info.clientAdjustYExpr = exprParser.parse(info.clientAdjustY);
		} else {
			delete info.clientAdjustYExpr;
		}
		this._regionList.set(info.id, info);
	}.bind(this);

	for (let i = 0; i < arguments.length; i++) {
		const info = arguments[i];
		argCheck([], 0, this.logger, "addLayoutRegions: (" + i + ")", info, [
				'element', 'elementSelector', 'id', 'width', 'height', 'resizable', 'softStopComponentsOnZeroSize',
				'suppressElementlessComponentWarning', 'suppressFailedComponentPlaceholders', 'columnMode', 'adjustWidth', 'adjustHeight',
				'clientAdjustX', 'clientAdjustY']);
		if (info.id == null) this.logger.throwError("addLayoutRegions: (" + i + "), region with no ID given");
		if (Array.isArray(info.id)) {
			for (let j = 0; j < info.id.length; j++) {
				if (!info.id[j] || typeof info.id[j] !== "string")  this.logger.throwError("addLayoutRegions: (" + i + ", " + j + "), region with invalid or missing ID: '", info.id[j]);
				addRegion($.extend({}, info, { id: info.id[j] }));
			}
		} else if (info.id && typeof info.id === "string") {
			addRegion($.extend({}, info));
		} else {
			this.logger.throwError("addLayoutRegions: (" + i + "), region with invalid ID: '", info.id);
		}
	}
	this._layoutRegionChange(true);
	if (/Apple/.test(window.navigator.vendor)) {
		const handler = this.checkRegionChanges.bind(this);
		window.setTimeout(handler, 0);
		window.setTimeout(handler, 100);
	}
};

/**
 * Remove layout regions by IDs
 *
 * @param {...string} regionId Region IDs to remove
 */
DMAppLayoutRegionCtl.prototype.removeLayoutRegions = function() {
	for (let i = 0; i < arguments.length; i++) {
		this._regionList.delete(arguments[i]);
	}
	this._layoutRegionChange(true);
};

/**
 * Get named layout region DOM element
 *
 * @param {?string} regionId Region ID, this may be null/undef/falsey to indicate the top-level region
 * @returns {?Element} This may be null if no suitable region element could be found
 */
DMAppLayoutRegionCtl.prototype.getNamedLayoutRegionElement = function(regionId) {
	if (!regionId) return this._rootRegion.element;

	const region = this._regionList.get(regionId);
	if (region) {
		return region.element;
	} else {
		this.logger.warn("Request for non-existent layout region with ID: '" + regionId + "'");
		return null;
	}
};

/**
 * Get named layout region information
 *
 * @param {?string} regionId Region ID, this may be null/undef/falsey to indicate the top-level region
 * @returns {?DMAppLayoutRegionCtl~RegionInfo} This may be null if no suitable region element could be found
 */
DMAppLayoutRegionCtl.prototype.getNamedLayoutRegionInfo = function(regionId) {
	if (!regionId) {
		return MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper(this._rootRegion);
	}

	const region = this._regionList.get(regionId);
	if (region) {
		return MiscUtil.makeSingleLevelReadOnlyObjectAccessWrapper(region);
	} else {
		this.logger.warn("Request for non-existent layout region with ID: '" + regionId + "'");
		return null;
	}
};

/**
 * Destroying component event.
 *
 * @event ComponentContainer#destroyingComponent
 * @type {object}
 * @property {DMAppComponent} component
 */
/**
 * Destroyed component event.
 *
 * @event ComponentContainer#destroyedComponent
 * @type {object}
 * @property {string} componentId
 */
/**
 * Created component event.
 *
 * @event ComponentContainer#createdComponent
 * @type {object}
 * @property {DMAppComponent} component
 */

/**
 * Component container
 * @constructor
 * @param {DMAppLayout} rootLayout Layout, iff this container is for the root layout
 * @param {Logger} logger
 */
function ComponentContainer(rootLayout, logger) {
	Object.defineProperties(this, {
		_dmAppComponentMap:   { value: new Map() },
		rootLayout:           { value: rootLayout },
		logger:               { value: logger },
		_shortIdRevNums:      { value: new Map() },
	});
}

inherits(ComponentContainer, SafeEventEmitter);

/**
 * Register a created component.
 * This MUST be called ONLY by {@link DMAppComponentBehaviour.initDMAppComponent}
 * @private
 */
ComponentContainer.prototype.registerDMAppComponent = function(id, component) /* -> void */ {
	if (this.destroyed) this.logger.throwError("ComponentContainer: registerDMAppComponent() may not be called after destroy()");
	const cr = this.makeComponentRef(id, "(registerDMAppComponent)");
	cr.markCreating();
	cr.setComponent(component);
};

/**
 * Register a created component.
 * This MUST be called ONLY by {@link DMAppComponentBehaviour._intlCreateDMAppComponent}
 * @private
 */
ComponentContainer.prototype.registerDMAppComponentPost = function(id, component) /* -> void */ {
	if (this._componentSignalMap) {
		const signal = this._componentSignalMap.getExistingSignal(id);
		if (signal) signal.setValue(component);
	}
	this.emit("createdComponent", {
		component: component,
	});
};

/**
 * Unregister a deleted component.
 * This MUST be called ONLY by {@link DMAppComponentBehaviour.deinitDMAppComponent}
 * @private
 */
ComponentContainer.prototype.unregisterDMAppComponent = function(id) /* -> void */ {
	const cr = this._dmAppComponentMap.get(id);
	if (cr) {
		cr.destroy("unregisterDMAppComponent");
		this._dmAppComponentMap.delete(id);
	}
	if (this._componentSignalMap) {
		const signal = this._componentSignalMap.getExistingSignal(id);
		if (signal) signal.setValue(null);
	}
};


/**
 * Get DMApp component signal of the component with the given ID, incrementing its ref count and creating it if it doesn't already exist
 *
 * @param {!string} id DMApp component ID
 * @return {!RefCountedSignalMap~GetSignalResult} Signal result, the signal value has a value of the component instance when the component exists, and null otherwise
*/
ComponentContainer.prototype.getDMAppComponentSignal = function(id) /* -> void */ {
	const self = this;
	if (!self._componentSignalMap) {
		Object.defineProperty(self, '_componentSignalMap', { value: new RefCountedSignalMap() });
		self._componentSignalMap.on('newSignal', function(info) {
			info.signal.setEqualityComparator(function(a, b) {
				return a === b;
			});
			info.signal.setValue(self.getComponentById(id) || null);
		});
	}
	const info = self._componentSignalMap.getSignal(id);
	return {
		signal: new Signal.ConstWrapperSignal(info.signal),
		unref: info.unref,
	};
};

/**
 * Locally remove a DMApp component
 * @param {string} id DMApp component ID
 * @return {boolean} true if component actually removed
 */
ComponentContainer.prototype.removeDMAppComponentById = function(id) /* -> void */ {
	const cr = this._dmAppComponentMap.get(id);
	if (!cr) return false;
	const component = cr.getComponent();
	if (component) {
		try {
			$(component).remove();
		} catch (e) {
			this.logger.error("Failed to remove DMApp component: " + id + ", ", e);
		}
		this.emit("destroyingComponent", {
			component: component,
		});
		Object.defineProperty(component, '_destructing', { value: true });
		component.deinitDMAppComponentEx();
		if (!component._destructed) this.logger.error("Component is not destructing as expected: " + component.getName());
	}
	cr.destroy("removeDMAppComponentById");
	this._dmAppComponentMap.delete(id);
	this.emit("destroyedComponent", {
		componentId: id,
	});
	return true;
};

/**
 * Locally request that a DMApp component remove itself, the component may choose to ignore or defer this request.
 * If the component has not been instantiated, {@link ComponentContainer#removeDMAppComponentById} is called instead.
 * @param {string} id DMApp component ID
 */
ComponentContainer.prototype.requestRemoveDMAppComponentById = function(id) /* -> void */ {
	const component = this.getComponentById(id);
	if (component) {
		try {
			component.requestDestruction();
		} catch(e) {
			this.logger.error("Component '" + id + "' requestDestruction() failed in ComponentContainer.requestRemoveDMAppComponentById() for id: ", e);
		}
	} else {
		this.removeDMAppComponentById(id);
	}
};

/**
 * Get or make a local DMApp component ref by ID
 * @private
 * @param {string} id DMApp component ID
 * @returns {?ComponentRef} DMApp component ref
 */
ComponentContainer.prototype.makeComponentRef = function(id, nameSuffix) {
	if (this.destroyed) this.logger.throwError("ComponentContainer: makeComponentRef() may not be called after destroy()");
	let cr = this._dmAppComponentMap.get(id);
	if (!cr) {
		cr = new ComponentRef(this, this.rootLayout, id, nameSuffix);
		this._dmAppComponentMap.set(id, cr);
		this.emit("_createdCR", {
			cr: cr,
		});
	}
	return cr;
};

/**
 * Get a local DMApp component ref by ID if it exists and is created
 * @private
 * @param {string} id DMApp component ID
 * @returns {?ComponentRef} DMApp component ref
 */
ComponentContainer.prototype.getComponentRefById = function(id) {
	return this._dmAppComponentMap.get(id);
};

/**
 * Get raw map of local DMApp component refs by ID
 * @private
 * @returns {?Map.<string, ComponentRef>} DMApp component ref map
 */
ComponentContainer.prototype.getComponentMap = function() {
	return this._dmAppComponentMap;
};

/**
 * Get a local DMApp component by ID if it exists and is created
 * @param {string} id DMApp component ID
 * @returns {?DMAppComponent} DMApp component element
 */
ComponentContainer.prototype.getComponentById = function(id) {
	const cr = this._dmAppComponentMap.get(id);
	if (!cr) return null;
	return cr.getComponent() || null;
};

/**
 * Test whether a local DMApp component exists or is pending creation with the given ID
 * @param {string} id DMApp component ID
 * @returns {boolean} Whether a component exists or is pending creation with the given ID
 */
ComponentContainer.prototype.hasComponentId = function(id) {
	return this._dmAppComponentMap.has(id);
};

/**
 * Remove all components
 */
ComponentContainer.prototype.removeAllComponents = function() {
	for (let id of this._dmAppComponentMap.keys()) {
		this.removeDMAppComponentById(id);
	}
};

/**
 * Destroy component container.
 * This removes all components.
 * After calling this method, components MAY NOT be added.
 */
ComponentContainer.prototype.destroy = function() {
	if (this.destroyed) return;
	this.removeAllComponents();
	Object.defineProperty(this, 'destroyed',       { value: true });
};

/**
 * Get Object set of local DMApp components which exists and are created
 * @returns {Object.<string, DMAppComponent>} Object with component ID keys and component values
 */
ComponentContainer.prototype.getComponents = function() {
	const out = {};
	for (let [id, cr] of this._dmAppComponentMap) {
		const component = cr.getComponent();
		if (component) {
			out[id] = component;
		}
	}
	return out;
};

/**
 * Get Array set of IDs of local DMApp components which exists and are created
 * @returns {Array.<string>} Array of component IDs
 */
ComponentContainer.prototype.getComponentIdList = function() {
	const out = [];
	for (let [id, cr] of this._dmAppComponentMap) {
		if (cr.getComponent()) {
			out.push(id);
		}
	}
	return out;
};

/**
 * Get Array set of IDs of local DMApp components, including those whose creation is pending
 * @returns {Array.<string>} Array of component IDs
 */
ComponentContainer.prototype.getAllComponentIdList = function() {
	return Array.from(this._dmAppComponentMap.keys());
};

/**
 * Remove {@link ComponentRef} with given ID.
 * This does not destroy or otherwise modify the {@link ComponentRef}.
 * @private
 * @returns {boolean} True if component ref deleted
 */
ComponentContainer.prototype.deleteComponentRefById = function(id) {
	return this._dmAppComponentMap.delete(id);
};


function ComponentRef(parentContainer, rootLayout, id, nameSuffix) {
	let name = "ComponentRef: " + id;
	if (nameSuffix) name += ": " + nameSuffix;
	Object.defineProperty(this, 'id',              { value: id });
	Object.defineProperty(this, 'name',            { value: name });
	Object.defineProperty(this, 'parentContainer', { value: parentContainer });
	Object.defineProperty(this, 'logger',          { value: parentContainer.logger.makeChildLogger(name) });
	Object.defineProperty(this, 'execQueue',       { value: new PromiseExecQueue(this.logger.makeChildLogger("(exec queue)")) });
	Object.defineProperty(this, 'componentPromise',{ value: waitable() });
	Object.defineProperty(this, 'rootLayout',      { value: rootLayout });
	this.execQueue.block();
	if (rootLayout) {
		Object.defineProperty(this, 'statusUpdateQueue',{ value: new PromiseExecQueue(this.logger.makeChildLogger("(status update queue)")) });
		this.statusUpdateQueue.setExecValve(rootLayout._statusUpdateValve);
		rootLayout._pendingCrInits.add(this);
	}
	this.creating = false;
	this.speculative = false;
	this.contextId = null;
	this.dmAppId = null;
	this.componentId = null;
	this.revision = undefined;
}

inherits(ComponentRef, SafeEventEmitter);

ComponentRef.prototype.markSpeculative = function() {
	const self = this;
	if (self.creating) {
		self.logger.throwError("Cannot mark ComponentRef as speculative if it is marked creating");
	}
	self.speculative = true;
	if (!self.speculativeTimer) {
		self.speculativeTimer = window.setTimeout(function() {
			self.logger.warn("Ignoring component update request(s) for non-existent component: " + self.id + ", component not created within timeout.");
			self.destroy("speculative timeout");
			self.parentContainer.deleteComponentRefById(self.id);
		}, 10000);
	}
	self.emit("change");
};

ComponentRef.prototype.markCreating = function() {
	if (this.speculativeTimer) {
		window.clearTimeout(this.speculativeTimer);
		delete this.speculativeTimer;
	}
	this.speculative = false;
	this.creating = true;
	this.emit("change");
};

ComponentRef.prototype.enqueue = function(job, name) {
	const self = this;
	if (this.destroyed) {
		return Promise.reject(this.name + " marked destroyed: cannot enqueue job: " + name);
	}
	if (this.failed) {
		return Promise.reject(this.name + " marked failed: cannot enqueue job: " + name);
	}
	return self.execQueue.enqueue(function() {
		return job(self.component);
	}, name);
};

ComponentRef.prototype.getComponent = function() {
	return this.component;
};

ComponentRef.prototype.getComponentPromise = function() {
	return this.componentPromise;
};

ComponentRef.prototype.setComponent = function(component) {
	if (this.component === component) return;
	if (this.component) {
		this.logger.throwError("Attempted to overset component");
	}
	if (!component) {
		this.logger.throwError("Attempted to set component to: " + component);
	}
	if (this.failed) {
		this.logger.throwError("Attempted to set component after marked failed");
	}
	this.component = component;
	if (this.layoutIndependent) this.component.layoutIndependent = true;
	this.execQueue.unblock();
	this.emit("change");
	this.componentPromise.signal(component);
};

ComponentRef.prototype.setComponentInfo = function(info, timestamp) {
	if (timestamp === Infinity) {
		// silently apply update
	} else if (timestamp != null) {
		if (this.previousComponentInfoTimestamp && timestamp < this.previousComponentInfoTimestamp) {
			this.logger.debug("Received update with timestamp prior to previous ignoring: delta: " + (timestamp - this.previousComponentInfoTimestamp));
			return;
		 } else {
			this.previousComponentInfoTimestamp = timestamp;
		 }
	} else if (this.previousComponentInfoTimestamp) {
		this.logger.debug("Received update with no timestamp after receiving timestamp update: ignoring");
		return;
	}

	if (!nanoEqual(info, this.component.dMAppComponentInfo)) {
		this.component.setComponentInfo(info);
	}
};

ComponentRef.prototype._postFailedStatus = function() {
	if (!this.isLayoutIndependent() && this.rootLayout && this.contextId && this.dmAppId) {
		this.rootLayout.io.postDMAppComponentStatus(this, { status: "skipped", revision: this.revision });
	}
};

ComponentRef.prototype.markFailed = function(reason) {
	if (this.failed) return;
	this._postFailedStatus();
	Object.defineProperty(this, 'failed',          { value: true });
	Object.defineProperty(this, 'failureReason',   { value: reason });
	this.execQueue.cancelAll(this.name + " marked as failed");
	this.emit("change");
	this.componentPromise.abort("Component failed: " + reason);
};

ComponentRef.prototype.isLayoutIndependent = function() {
	return this.layoutIndependent || (this.component && this.component.layoutIndependent);
};

ComponentRef.prototype.setLayoutIndependent = function() {
	this.layoutIndependent = true;
	if (this.component) this.component.layoutIndependent = true;
	this.emit("change");
};

ComponentRef.prototype._postFinalStatus = function(reason) {
	// post a final status update before destroying the status update queue
	if (this.statusUpdateQueue) {
		this.statusUpdateQueue.cancelAll();
	}
	if (this.rootLayout && this.contextId && this.dmAppId) {
		this.rootLayout.io.postDMAppComponentStatus(this, { status: "idle", revision: this.revision });
	}
	if (this.statusUpdateQueue) {
		this.statusUpdateQueue.enqueue(function() {
			this.statusUpdateQueue.destroy(this.name + ": " + reason);
		}.bind(this));
	}
};

ComponentRef.prototype.destroy = function(reason) {
	const self = this;
	if (this.destroyed) return;
	if (!reason) reason = "destruction";
	Object.defineProperty(this, 'destroyed',       { value: true });
	this.execQueue.destroy(this.name + ": " + reason);
	if (self.rootLayout) {
		self.rootLayout.componentDebouncer.removeComponent(this.id);
		self.rootLayout._pendingCrInits.delete(this);
	}
	if (!this.speculative && !this.isLayoutIndependent()) {
		self._postFinalStatus(reason);
	} else if (self.statusUpdateQueue) {
		self.statusUpdateQueue.destroy(self.name + ": " + reason);
	}
	this.emit("destroy");
	this.componentPromise.abort("Component destroyed: " + reason);
};

ComponentRef.prototype.markMasqueradeDestroyed = function() {
	if (this.masqueradeDestroyed || this.destroyed) return;
	if (this.rootLayout) {
		this.rootLayout._pendingCrInits.delete(this);
	}
	if (!this.speculative && !this.isLayoutIndependent()) {
		this._postFinalStatus("masquerade destruction");
	}
	Object.defineProperty(this, 'masqueradeDestroyed', { value: true });
	this.setLayoutIndependent();
	this.emit("change");
};

ComponentRef.prototype.setRevisionNumber = function(rev) {
	const refreshStatus = (this.revision !== rev);
	this.revision = rev;
	if (refreshStatus) {
		if ((this.masqueradeDestroyed || this.destroyed) && !this.speculative && !this.isLayoutIndependent()) {
			this._postFinalStatus("re-sending destruction status due to revision change");
		} else if (this.failed) {
			this._postFailedStatus();
		}
	}
};

function ComponentDebouncer(parentLayout) {
	Object.defineProperty(this, 'parentLayout',    { value: parentLayout });
	Object.defineProperty(this, 'componentMap',    { value: new Map() });
	Object.defineProperty(this, 'timerFunc',       { value: this.timerHandler.bind(this) });
}

ComponentDebouncer.prototype.debounceIntervalMs = 50;

ComponentDebouncer.prototype.debounce = function(componentId, type, callback) {
	if (this.timeoutHandle != null) window.clearTimeout(this.timeoutHandle);
	this.timeoutHandle = window.setTimeout(this.timerFunc, this.debounceIntervalMs);

	let info = this.componentMap.get(componentId);
	if (!info) {
		info = new Map();
		this.componentMap.set(componentId, info);
	}
	info.set(type, callback);
};

ComponentDebouncer.prototype.timerHandler = function() {
	delete this.timeoutHandle;

	for (let info of this.componentMap.values()) {
		for (let callback of info.values()) {
			callback();
		}
	}
	this.componentMap.clear();
};

ComponentDebouncer.prototype.removeComponent = function(componentId) {
	this.componentMap.delete(componentId);
};

try {
	Object.freeze(DMAppLayoutRegionCtl.prototype);
	Object.freeze(ComponentContainer.prototype);
	Object.freeze(ComponentRef.prototype);
	Object.freeze(ComponentDebouncer.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = {
	DMAppLayoutRegionCtl: DMAppLayoutRegionCtl,
	ComponentContainer: ComponentContainer,
	ComponentRef: ComponentRef,
	ComponentDebouncer: ComponentDebouncer,
};
