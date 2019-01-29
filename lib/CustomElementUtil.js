/************************************************************************/
/* FILE:                CustomElementUtil.js                            */
/* DESCRIPTION:         Custom element util                             */
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

const $ = require("jquery");
const Promise = require("promise");
const URI = require('urijs');

const argCheck = require('./argCheck');
const DMAppController = require('./DMAppController');
const DMAppComponentWrapper = require('./DMAppComponentWrapper');
const StateMapping = require('./StateMapping');
const ExecValve = require('./ExecValve');

/**
 * Utilities for custom elements/webcomponents and HTML imports
 *
 * @namespace CustomElementUtil
 */

/**
 * Web IDL data bindings type for shared state mapping of element attributes
 *
 * @memberof CustomElementUtil
 * @typedef {Object} WebIdlSharedStateMappedElementAttributeConfig
 * @property {Array.<(string|SharedStateMappedElementAttributeDescriptor)>=} globalAttributes List of attribute names and/or descriptors to map by means of {@link DMAppComponentBehaviour.setupSharedStateElementAttributeMapping} with {@link StateMapping.ContextGlobalSharedStateMapping}
 * @property {Array.<(string|SharedStateMappedElementAttributeDescriptor)>=} sharedAttributes List of attribute names and/or descriptors to map by means of {@link DMAppComponentBehaviour.setupSharedStateElementAttributeMapping} with {@link StateMapping.ContextGroupParameterSharedStateMapping}
 */

/**
 * Static element attribute descriptor
 *
 * Exactly one of 'value' and 'getter' must be set
 *
 * @memberof CustomElementUtil
 * @typedef {Object} ElementAttributeStaticDescriptor
 * @property {!string} attribName Mandatory name of element attribute
 * @property {?string} value Optional value to set the element attribute to
 * @property {?CustomElementUtil.ElementAttributeStaticGetHandler} getter Optional callback function used to set the value of the attribute
 */
/**
 * Static attribute "get" handler function
 *
 * @memberof CustomElementUtil
 * @callback ElementAttributeStaticGetHandler
 *
 * @param {!DMAppComponent} component The current component
 * @param {!Element} element The current component's element
 * @param {!DMAppController} controller The current component's owning instance of DMAppController
 * @return {?string} Value to assign to the element attribute
 */

/**
 * Utility function to wrap a custom element as a DMApp component
 *
 * @memberof CustomElementUtil
 *
 * @param {!string} elementName Custom element tag name
 * @param {!string} dMAppComponentName Component class/type name
 * @param {Object=} options Optional options object
 * @param {CustomElementUtil.WebIdlSharedStateMappedElementAttributeConfig=} options.dataBindings Optional web IDL data bindings for shared state mapping of element attributes
 * @param {Object.<string, CustomElementUtil.WebIdlSharedStateMappedElementAttributeConfig>=} options.dataBindingsByParamName Optional object map of string name of component parameter of group name, to web IDL data bindings for shared state mapping of element attributes
 * @param {boolean=} [options.setActiveAttribute=true] Optional whether to set 'active' attribute on element, default: true
 * @param {boolean=} [options.copyParametersToAttributes=false] Optional whether to copy component parameters to attributes on element whenever the component parameters change, default: false
 * @param {boolean=} [options.copyInitialParametersToAttributes=true] Optional whether to copy component parameters to attributes on element at component construction time, default: true
 * @param {string=} options.sharedStateContextIdOverride Optional shared state element attribute mapping group mapping context ID override
 * @param {Array.<CustomElementUtil.ElementAttributeStaticDescriptor>=} options.setAttributesAtInit Optional list of element attributes to be set at component init
 */
function upgradeCustomElementIntoComponent(elementName, dMAppComponentName, options) {
	if (DMAppController.getMostRecent()) {
		argCheck(arguments, 3, DMAppController.getMostRecent().logger, "upgradeCustomElementIntoComponent: (" + elementName + " -> " + dMAppComponentName + ")", options,
				['dataBindings', 'dataBindingsByParamName', 'setActiveAttribute', 'copyParametersToAttributes', 'copyInitialParametersToAttributes', 'sharedStateContextIdOverride', 'setAttributesAtInit']);
	}

	const opts = $.extend({
		dataBindings: null,
		setActiveAttribute: true,
		copyParametersToAttributes: false,
		copyInitialParametersToAttributes: true,
		sharedStateContextIdOverride: null,
	}, options || {});

	function CustomElementComponentWrapper(dMAppController) {
		DMAppComponentWrapper.call(this, document.createElement(elementName), dMAppController);
	}

	$.extend(CustomElementComponentWrapper.prototype, DMAppComponentWrapper.prototype);

	CustomElementComponentWrapper.prototype.initDMAppComponent = function(dMAppController, id, typeName, config) {
		DMAppComponentWrapper.prototype.initDMAppComponent.apply(this, arguments);

		// Set component properties on element
		const elem = this.getComponentElement();
		Object.defineProperties(elem, {
			_logger:            { value: this.logger },
			_debugLog:          { value: this.logger.debug.bind(this.logger), writable: true },
			_debuglog:          { value: this.logger.debug.bind(this.logger), writable: true },
			_component:         { value: this },
			_controller:        { value: dMAppController },
		});

		this._setupAttributeFlushCtl();

		const flushLatch = this._attributeFlushBlock.latch();

		if (opts.setActiveAttribute) {
			// Custom elements are created and added to the DOM well before they are made visible.
			// Inform custom elements when they are eventually made visible so they can respect the
			// two-step initialisation of DMAppComponent life cycle.
			this.event.on("isRunningChange", function(running) {
				this._bufferedSetAttribute("active", running);
			}.bind(this));
			this._bufferedSetAttribute("active", this.isRunning());
		}

		const dataBindingsOptions = {};
		if (opts.sharedStateContextIdOverride) {
			dataBindingsOptions.contextIdOverride = opts.sharedStateContextIdOverride;
		}

		const add_data_binding = function(bindingOpts, baseOptions) {
			if (bindingOpts.globalAttributes) {
				this.setupSharedStateElementAttributeMapping(bindingOpts.globalAttributes, new StateMapping.ContextGlobalSharedStateMapping(baseOptions), { blockable: this._attributeFlushBlock });
			}
			if (bindingOpts.sharedAttributes) {
				this.setupSharedStateElementAttributeMapping(bindingOpts.sharedAttributes, new StateMapping.ContextGroupParameterSharedStateMapping(baseOptions), { blockable: this._attributeFlushBlock });
			}
		}.bind(this);

		if (opts.dataBindings) {
			add_data_binding(opts.dataBindings, dataBindingsOptions);
		}
		if (opts.dataBindingsByParamName) {
			for (let prop in opts.dataBindingsByParamName) {
				add_data_binding(opts.dataBindingsByParamName[prop], $.extend({ parameterName: prop }, dataBindingsOptions));
			}
		}

		if (opts.copyInitialParametersToAttributes && config.parameters) {
			for (let key in config.parameters) {
				this._bufferedSetAttribute(key, config.parameters[key]);
			}
		}

		if (opts.copyInitialParametersToAttributes) this._haveWarnedNoParamHandler = true;

		if (opts.copyParametersToAttributes) {
			this.setParameterFunctions.push(function(parameters) {
				for (let key in parameters) {
					this._bufferedSetAttribute(key, parameters[key]);
				}
			});
		}

		if (opts.setAttributesAtInit) {
			for (let i = 0; i < opts.setAttributesAtInit.length; i++) {
				const item = opts.setAttributesAtInit[i];
				if (typeof item === "object") {
					argCheck([], 0, this.logger, "Shared state element attribute mapping: attribute definition object", item, ['attribName', 'value', 'getter']);
					if (!item.attribName || typeof item.attribName !== "string") {
						this.logger.throwError("Unexpected or missing attribute item attribName value in setAttributesAtInit attribute definition: ", item);
					}
					/* jshint -W018 */
					if ((!item.value) === (!item.getter)) {
						this.logger.throwError("Exactly one of attribute items: 'value' and 'getter' must be specified in setAttributesAtInit attribute definition", item);
					}
					/* jshint +W018 */
					if (item.value != null) {
						this._bufferedSetAttribute(item.attribName, item.value);
					}
					if (item.getter) {
						if (typeof item.getter !== "function") {
							this.logger.throwError("Unexpected attribute item getter function type in setAttributesAtInit attribute definition: ", item);
						}
						this._bufferedSetAttribute(item.attribName, item.getter(this, elem, dMAppController));
					}
				} else {
					this.logger.throwError("Unexpected attribute item type in setAttributesAtInit attribute definition: ", item);
				}
			}
		}

		// Unblock on the next event loop iteration.
		// This is long enough that parameters, etc. will have been set
		window.setTimeout(flushLatch, 0);
	};

	CustomElementComponentWrapper.prototype.dumpDebugInfo = function(dumper) {
		const cat = dumper.subcategory("CustomElementComponentWrapper");
		cat.keyValue("Element tag", elementName);
		cat.keyValue("Copy params -> attribs", !!opts.copyParametersToAttributes);
		cat.keyValue("Set 'active' attrib", opts.setActiveAttribute);
		cat.keyValue("Has data bindings", !!opts.dataBindings);
		if (opts.sharedStateContextIdOverride) {
			cat.keyValue("Shared state context override", opts.sharedStateContextIdOverride);
		}
		DMAppComponentWrapper.prototype.dumpDebugInfo.call(this, dumper);
	};

	// Register wrapped element as a DMAppComponent
	DMAppController.prototype.dMAppComponentTypes[dMAppComponentName] = CustomElementComponentWrapper;
}

/**
 * {@link ExecValve} instance which is blocked when {@link CustomElementUtil.loadAndConcatHtmlImport} operations are in progress.
 * This can be used within an appended document to schedule callbacks to run once appending is complete.
 *
 * @type ExecValve
 *
 * @memberof CustomElementUtil
 */
const loadAndConcatHtmlImportsDone = new ExecValve();

/**
 * Utility function to load a HTML page and concatenate it onto the document DOM
 *
 * DOM adjustments:
 * * The 'href' attribute of `<link>` tags is adjusted such that relative URLs work
 *
 * `<script>` tags are not concatenated to the document DOM, as this would result in them being executed more than once.
 *
 * {@link CustomElementUtil.loadAndConcatHtmlImportsDone} is blocked until the return promise is resolved or rejected.
 *
 * @memberof CustomElementUtil
 *
 * @param {!string} url HTML page URL to import
 * @param {!Logger} logger Logger instance
 * @param {Object=} options Optional options object
 * @param {string=} options.name Name to use in logging output
 * @returns {Promise.<Element>} Promise of import link node
 */
function loadAndConcatHtmlImport(url, logger, options) {
	argCheck(arguments, 3, logger, "loadAndConcatHtmlImport", options,
			['name']);

	const logName = options.name || "HTML page";
	loadAndConcatHtmlImportsDone.block();
	const p = new Promise(function(resolve, reject) {
		const linkNode = Polymer.Base.importHref(url, function(val) {
			logger.info(logName + " import load success: URL: " + url);
			const handleImportNode = function(imported, appendTo) {
				const nodes = $(document.importNode(imported, true)).children();
				nodes.filter("link").each(function() {
					const je = $(this);
					if (je.attr("href")) {
						je.attr("href", new URI(je.attr("href"), url).toString());
					}
				});
				$(appendTo).append(nodes.not('script'));
			};
			handleImportNode(linkNode.import.head, document.head);
			handleImportNode(linkNode.import.body, document.body);
			resolve(linkNode);
		}, function(e) {
			const msg = logName + " import load failed: URL: " + url;
			logger.error(msg);
			reject(msg);
		}, true);
	});
	p.finally(function() {
		loadAndConcatHtmlImportsDone.unblock();
	});
	return p;
}

module.exports = {
	upgradeCustomElementIntoComponent: upgradeCustomElementIntoComponent,
	loadAndConcatHtmlImport: loadAndConcatHtmlImport,
	loadAndConcatHtmlImportsDone: loadAndConcatHtmlImportsDone,
};

