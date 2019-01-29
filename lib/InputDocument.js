/************************************************************************/
/* FILE:                InputDocument.js                                */
/* DESCRIPTION:         Input document handling                         */
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
const Promise = require('promise');
const URI = require('urijs');

const DMAppController = require('./DMAppController');
const Logger = require('./Logger');
const argCheck = require('./argCheck');
const AjaxPromise = require('./AjaxPromise');
const CustomElementUtil = require('./CustomElementUtil');
const DebugMiscUtil = require('./DebugMiscUtil');
const ClockSchedulerUtil = require('./ClockSchedulerUtil');
const InputUtil = require('./InputUtil');

/**
 * Input document handling
 *
 * @namespace InputDocument
 */

/**
 * Input Document Object
 *
 * A DMApp component may implement this in addition to {@link DMAppComponent}
 *
 * @interface SetupComponentInterface
 * @memberof InputDocument
 */
/**
 * Input document setup
 *
 * @method InputDocument.SetupComponentInterface#inputDocumentSetup
 * @param {!InputDocument.InputDocumentHandler} handler input document handler
 * @param {!InputDocument.InputDocumentExecutionResult} ctx input document execution result, so far
 * @param {!InputDocument.InputDocumentObject} input input document
 * @returns {!Promise.<InputDocument.InputDocumentObject>} promise of input document (possibly modified)
 */
/**
 * Input document execution result
 *
 * @typedef {Object} InputDocument.InputDocumentExecutionResult
 * @prop {?DMAppController} controller Controller instance
 * @prop {?DMAppTvEmuSync} tvEmuSync TV emulator sync instance (non-null iff mode is 'tv')
 * @prop {?DMAppTvEmuController} tvEmuController TV emulator controller instance (non-null iff mode is 'tv')
 * @prop {?DMAppComp} compController Companion controller instance (non-null iff setupCompanion is true, this is inited after any setup component)
 * @prop {?DiscoveryCtl} companionDiscoveryCtl Companion discovery controller instance (non-null iff setupCompanion is true and companionDiscoveryOptions is provided, this is inited after any setup component)
 */
/**
 * Input document variation
 *
 * When type is 'optional', at least one of content and inputDocumentUrl must be specified
 *
 * @typedef {Object} InputDocument.InputDocumentVariation
 * @prop {!string} name Variation name
 * @prop {string=} description Description
 * @prop {!string} type Permitted values include: 'select', 'optional'
 * @prop {Array.<InputDocument.InputDocumentVariationSelectOption>} options Selection options, required when type is 'select'
 * @prop {InputDocument.InputDocumentObject} content Object to merge with the input document, when optional variation is enabled, permitted when type is 'optional'
 * @prop {string=} inputDocumentUrl URL of another input document to merge with this input document, permitted when type is 'optional' (applied before content). This is relative to {@link InputDocument.InputDocumentHandler#inputUrl}.
 * @prop {boolean=} required Non-binding UI hint that selecting a value is required, permitted when type is 'select'
 * @prop {boolean=} uiAdvanced Non-binding UI hint that this is an "advanced" option
 * @prop {string=} default Name of the default option for this variation, permitted when type is 'select'
 */
/**
 * Input document variation: select option
 *
 * @typedef {Object} InputDocument.InputDocumentVariationSelectOption
 * @prop {!string} name Option name
 * @prop {string=} description Description
 * @prop {InputDocument.InputDocumentObject=} content Object to merge with the input document
 * @prop {string=} inputDocumentUrl URL of another input document to merge with this input document (applied before content). This is relative to {@link InputDocument.InputDocumentHandler#inputUrl}.
 */
/**
 * Input document signal value schedule
 *
 * @typedef {Object} InputDocument.InputDocumentSignalValueSchedule
 * @prop {!Array.<InputDocument.InputDocumentSignalValueScheduleItem>} schedule Schedule array
 */
/**
 * Input document signal value schedule item
 *
 * @typedef {Object} InputDocument.InputDocumentSignalValueScheduleItem
 * @prop {(string|number)} startTime Number or string representation of the start time of this interval. This may be omitted for the first schedule item, in which case a value of -Infinity is used. It is required for other schedule items.
 * @prop value Required arbitrary signal value to set
 */

/**
 * Input Document Object
 *
 * @typedef InputDocumentObject
 * @memberof InputDocument
 * @prop {!string} mode Mode: tv, companion, or standalone
 * @prop {string=} description Document description
 * @prop {Object=} controllerOptions {@link DMAppController} constructor options
 * @prop {Object=} serviceInput Service input, specifying this option will create a new context and DMApp, this may not be specified if mode is 'companion'
 * @prop {string=} serviceInput.layout Layout document service input, using {@link DMAppLayoutIO#setupContextAndDmapp}
 * @prop {string=} serviceInput.layoutv3 Layout document service input (v3 variant), using {@link DMAppLayoutIO#setupContextAndDmapp}, this is used instead of serviceInput.layout when using a v3 layout service instance
 * @prop {string=} serviceInput.layoutv4 Layout document service input (v4 variant), using {@link DMAppLayoutIO#setupContextAndDmapp}, this is used instead of serviceInput.layout when using a v4 layout service instance
 * @prop {string=} serviceInput.timeline Timeline document service input, using {@link DMAppLayoutIO#setupContextAndDmapp}
 * @prop {string=} serviceInput.contextRejoinMode See {@link DMAppLayoutIO#setupContextAndDmapp}
 * @prop {string=} serviceUrlPreset Set service URLs to named preset, see {@link DMAppController.serviceUrlPresets}
 * @prop {Object.<string>=} serviceUrls Service URLs: See {@link DMAppController#setUrls}, fields override those specified by serviceUrlPreset
 * @prop {boolean=} setupStickyDefaultClock Whether to call {@link DMAppTimeline#setupStickyDefaultClock} (default: true if serviceInput is present, false otherwise)
 * @prop {boolean=} percentCoordsMode Set value of {@link DMAppLayout#newContextPercentCoords}, this is not useful if mode is 'companion'
 * @prop {string=} appendHtmlUrl Call {@link CustomElementUtil.loadAndConcatHtmlImport} with the provided URL, this is applied before any regions or rootLayoutRegionElementSelector options
 * @prop {Array.<DMAppLayoutRegionCtl~RegionInfo>=} regions Call {@link DMAppLayoutRegionCtl#addLayoutRegions} with provided region declaration objects, this is applied after any appendHtmlUrl option
 * @prop {string=} rootLayoutRegionElementSelector Call {@link DMAppLayoutRegionCtl#setRootLayoutRegionElement} with the element found by the parameter value as a CSS selector string, this is applied after any appendHtmlUrl option
 * @prop {boolean=} setupCompanion Create and setup a {@link DMAppComp} instance (default: true if mode is companion, false otherwise)
 * @prop {Object=} companionJoinOptions Optional companion ({@link DMAppComp}) join options, this requires that setupCompanion is true.
 * @prop {boolean=} noContextJoin Do not join the associated context/DMApp when joining a device.
 * @prop {Object=} companionDiscoveryOptions Call {@link DMAppComp#setupCompanionPlatformSpecificDiscovery} with the provided object, this requires that setupCompanion is true.
 * @prop {Layout_RAML_DMAppComponent=} setupComponent Create DMApp component prior to handling serviceInput or discovery, this MAY additionally implement {@link InputDocument.SetupComponentInterface}. This component may be used for any DMApp or device specific setup or configuration
 * @prop {Array.<InputDocument.InputDocumentVariation>=} variations Document variations, see {@link InputDocument.InputDocumentHandler#setVariation}
 * @prop {Object=} localSignalValues Set values of local signals given by object keys to corresponding object values. See {@link DMAppController#localSignalMap}. This is applied before generalSignalValues.
 * @prop {Object=} generalSignalValues Set values of signals given by object keys (type-prefixed) to corresponding object values. See {@link DMAppController#setSignalByName}. This is applied after localSignalValues.
 * @prop {Object.<string, InputDocument.InputDocumentSignalValueSchedule>=} timedGeneralSignalValues Set values of signals given by object keys (type-prefixed) according to a schedule, relative to the default clock {@link DMAppTimeline#defaultClock}. See {@link DMAppController#setSignalByName}. This is applied after generalSignalValues and as necessary due to clock changes.
 * @prop {Object=} tvAuxiliaryData TV auxiliary data object. This is included in DIAL advertisements and can be used for arbitrary data. This only has an effect if mode is 'tv'.
 * @prop {Object=} debugOptions Optional debug options
 * @prop {boolean=} debugOptions.debugComponent Show debug component (default: false)
 * @prop {boolean=} debugOptions.devLogging Call {@link DMAppController#enableDevDialogLogging}
 * @prop {boolean=} debugOptions.failurePlaceholders Set value of {@link DMAppLayout#failedComponentPlaceholderMode}
 * @prop {(boolean|Object)=} debugOptions.timelineMasterOverride Local clock state override debugging tool, use ONLY for local debugging, DO NOT enable by default in any user-facing configuration. Read source carefully before attempting to supply an object, use a boolean instead. (Default: false)
 * @prop {(boolean|Object)=} debugOptions.remoteControlTimelineMasterOverride Remote controlled local clock state override debugging tool, use ONLY for remote controlled clock control debugging, DO NOT enable by default in any user-facing configuration. (Default: false)
 * @prop {string=} baseUrl Set base URL for relative to absolute URL conversions (default: value of {@link InputDocument.InputDocumentHandler#inputUrl}). This does not apply to the inputDocumentUrl field of {@link InputDocument.InputDocumentVariation}, {@link InputDocument.InputDocumentVariationSelectOption}.
 * @prop {string=} authoringLaunchMode Optional string identifying the mode in which this input document is being launched by the authoring tool.
 * @prop {(string|Array.<string>)=} inputDocumentUrl Optional URL(s) of other input document(s) to merge with this input document. This is relative to {@link InputDocument.InputDocumentHandler#inputUrl}.
 */

/** @member {!Logger} InputDocument.InputDocumentHandler#logger Logger for this instance */
/** @member {?string} InputDocument.InputDocumentHandler#inputUrl Input document URL, may be undefined if an inputObject was used in the constructor instead */

/**
 * Input document handler
 *
 * Exactly one of params.inputObject and params.inputUrl must be given
 *
 * @memberof InputDocument
 *
 * @constructor
 * @param {!Object}                                                                          params                       parameters object
 * @param {(InputDocument.InputDocumentObject|Promise.<InputDocument.InputDocumentObject>)=} params.inputObject           optional input document object, or promise thereof
 * @param {string=}                                                                          params.inputUrl              optional input document URL
 * @param {boolean=}                                                                         [params.urlAutoRetry=true]   optional whether to auto-retry input document URL
 * @param {Logger=}                                                                          params.logger                optional logger to use
 */

function InputDocumentHandler(params) {
	Object.defineProperties(this, {
		logger:               { value: (params && typeof params === "object" && params.logger) ? params.logger : new Logger({ name: "InputDocumentHandler" }) },
		variations:           { value: new Map() },
		variationSelections:  { value: new Map() },
		urlAutoRetry:         { value: (params && params.urlAutoRetry != null) ? !!params.urlAutoRetry : true },
	});
	this.baseUrl = null;

	if (!params || typeof params !== "object") this.logger.throwError("params argument is not an object");
	argCheck(arguments, 1, this.logger, "InputDocumentHandler constructor", params,
			['inputObject', 'inputUrl', 'urlAutoRetry', 'logger']);

	if ((params.inputObject != null) === (params.inputUrl != null)) {
		this.logger.throwError("Input document: Exactly one of params.inputObject and params.inputUrl must be given");
	}

	let inputDoc;
	if (params.inputObject) {
		inputDoc = this._preProcessDoc(params.inputObject);
	} else if (params.inputUrl) {
		Object.defineProperties(this, {
			inputUrl:             { value: params.inputUrl },
		});
		this.baseUrl = this.inputUrl;
		const ap = new AjaxPromise({
			method: "GET",
			url: params.inputUrl,
			dataType: "json",
		});
		ap.setLogger(this.logger);
		if (this.urlAutoRetry) ap.enableAutoRetry();
		ap.setTitle("InputDocumentHandler: Get input document from URL");
		inputDoc = ap.exec().then(function(info) {
			return this._preProcessDoc(info.data);
		}.bind(this));
	}
	Object.defineProperties(this, {
		_inputDoc:            { value: inputDoc, configurable: true },
	});
}

/**
 * Get promise of input document description field, or null
 *
 * @returns {Promise.<?string>} Description
 */
InputDocumentHandler.prototype.getDocumentDescription = function() {
	return this._inputDoc.then(function(doc) {
		return doc.description || null;
	});
};

/**
 * Get promise of input document contents
 *
 * @returns {Promise.<InputDocument.InputDocumentObject>} Document
 */
InputDocumentHandler.prototype.getDocumentContents = function() {
	return this._inputDoc;
};

/**
 * Set document variation
 *
 * @param {!string} name Variation name
 * @param {!string} value Variation value
 */
InputDocumentHandler.prototype.setVariation = function(name, value) {
	this.variationSelections.set(name, value);
};

/**
 * Apply an overlay to the input document, this modifes the input document in place
 *
 * @param {!InputDocument.InputDocumentObject} overlay Overlay document
 * @returns {Promise.<InputDocument.InputDocumentObject>} Modified document
 */
InputDocumentHandler.prototype.applyOverlay = function(overlay) {
	const newDoc = this._inputDoc.then(function(doc) {
		$.extend(true, doc, overlay);
		return doc;
	});
	Object.defineProperties(this, {
		_inputDoc:            { value: newDoc, configurable: true },
	});
	if (!this._haveOverlay) {
		Object.defineProperties(this, {
			_haveOverlay:         { value: true },
		});
	}
	return newDoc;
};

/**
 * Input document execution, controller post-construction callback
 *
 * @callback InputDocument.InputDocumentHandler~InputDocumentExecutionControllerPostConstructionCallback
 * @param {!InputDocument.InputDocumentExecutionResult} ctx Input document execution result, so far
 * @param {!InputDocument.InputDocumentObject} document Input document
 * @param {!DMAppController} dMAppController Controller
 */
/**
 * Input document execution, controller post append HTML URL callback
 *
 * @callback InputDocument.InputDocumentHandler~InputDocumentExecutionPostAppendHtmlUrlCallback
 * @param {!InputDocument.InputDocumentExecutionResult} ctx Input document execution result, so far
 * @param {!InputDocument.InputDocumentObject} document Input document
 * @param {?string} appendHtmlUrl Document append HTML URL value
 * @param {?Element} linkNode HTML import link node element (if appendHtmlUrl is non-null)
 */

/**
 * Execute input document
 *
 * @param {Object=}                                                                                          options                                         optional options object
 * @param {InputDocument.InputDocumentHandler~InputDocumentExecutionControllerPostConstructionCallback=}     options.controllerPostConstructionCallback      optional controller post construction callback
 * @param {InputDocument.InputDocumentHandler~InputDocumentExecutionPostAppendHtmlUrlCallback=}              options.postAppendHtmlUrlCallback               optional post append HTML URL callback (when no HTML URL is appended, this is called when it would have been appended)
 * @returns {Promise.<InputDocument.InputDocumentExecutionResult>} Promise of execution result
 */
InputDocumentHandler.prototype.executeDocument = function(options) {
	const self = this;
	argCheck(arguments, 1, self.logger, "InputDocumentHandler executeDocument", options,
			['controllerPostConstructionCallback', 'postAppendHtmlUrlCallback']);
	return self._inputDoc.then(function(doc) {
		return self._init({}, doc, options || {});
	});
};

InputDocumentHandler.prototype._preProcessDoc = function(doc) {
	const self = this;
	const merges = [];
	const handleInputDoc = function(url, suffix) {
		if (typeof url !== "string") self.logger.throwError("Input document: 'inputDocumentUrl" + suffix + "' is not a string");

		try {
			if (self.inputUrl) url = URI(url).absoluteTo(self.inputUrl).toString();
		} catch(e) {
			self.logger.error("Exception when attemping to rebase variation input document URL: ", e);
		}
		const handler = new InputDocumentHandler({ inputUrl: url, urlAutoRetry: self.urlAutoRetry, logger: self.logger.makeChildLogger("inputDocumentUrl" + suffix) });
		merges.push(handler.getDocumentContents());
	};
	if (doc.inputDocumentUrl) {
		if (Array.isArray(doc.inputDocumentUrl)) {
			for (let i = 0; i < doc.inputDocumentUrl.length; i++) {
				handleInputDoc(doc.inputDocumentUrl[i], "[" + i + "]");
			}
		} else {
			handleInputDoc(doc.inputDocumentUrl, '');
		}
	}

	if (merges.length) doc = $.extend(true, {}, doc);
	return Promise.all(merges).then(function(items) {
		for (let i = 0; i < items.length; i++) {
			$.extend(true, doc, items[i]);
		}
		self._preProcessDocPhase2(doc);
		return doc;
	});
};

InputDocumentHandler.prototype._preProcessDocPhase2 = function(doc) {
	const contentCheck = function(item, prefix) {
		if (item.content) {
			if (typeof item.content !== "object") this.logger.throwError("Input document: '" + prefix + ".content' is not an object");
			if (item.content.variations) this.logger.throwError("Input document: variations may not be nested, in '" + prefix + ".content'");
		}
		if (item.inputDocumentUrl && typeof item.inputDocumentUrl !== "string") this.logger.throwError("Input document: '" + prefix + ".inputDocumentUrl' is not a string");
	}.bind(this);

	try {
		if (doc.variations) {
			if (!Array.isArray(doc.variations)) this.logger.throwError("Input document: 'variations' is not an array");
			for (let i = 0; i < doc.variations.length; i++) {
				const v = doc.variations[i];
				const prefix = "variations[" + i + "]";
				if (!v.name || typeof v.name !== "string") this.logger.throwError("Input document: '" + prefix + ".name' is missing or not a string");
				if (v.description && typeof v.description !== "string") this.logger.throwError("Input document: '" + prefix + ".description' is not a string");
				const entry = {
					name: v.name,
					description: v.description,
					opts: new Map(),
				};
				if (v.type === "select") {
					argCheck([], 0, this.logger, "Input document: '" + prefix + "'", v,
							['name', 'description', 'type', 'options', 'required', 'uiAdvanced', 'default']);
					if (!Array.isArray(v.options)) this.logger.throwError("Input document: '" + prefix + ".options' is missing or not an array");
					for (let j = 0; j < v.options.length; j++) {
						const item = v.options[j];
						const item_prefix = prefix + ".options[" + j + "]";
						argCheck([], 0, this.logger, "Input document: '" + item_prefix + "'", item,
								['name', 'description', 'content', 'inputDocumentUrl']);
						if (!item.name || typeof item.name !== "string") this.logger.throwError("Input document: '" + item_prefix + ".name' is missing or not a string");
						if (item.description && typeof item.description !== "string") this.logger.throwError("Input document: '" + item_prefix + ".description' is not a string");
						contentCheck(item, item_prefix);
						if (entry.opts.has(item.name)) this.logger.throwError("Input document: '" + item_prefix + ".name' (" + item.name + ") is a duplicate");
						entry.opts.set(item.name, {
							name: item.name,
							description: item.description,
							content: item.content,
							inputDocumentUrl: item.inputDocumentUrl,
						});
					}
					if (v.default != null) {
						if (!entry.opts.has(v.default)) this.logger.throwError("Input document: '" + prefix + ".default' is not a known item name");
						if (!this.variationSelections.has(v.name)) this.variationSelections.set(v.name, v.default);
					}
				} else if (v.type === "optional") {
					argCheck([], 0, this.logger, "Input document: '" + prefix + "'", v,
							['name', 'description', 'type', 'content', 'inputDocumentUrl', 'uiAdvanced']);
					if (!v.content && !v.inputDocumentUrl) this.logger.throwError("Input document: '" + prefix + ".content' and '" + prefix + ".inputDocumentUrl' are both missing");
					contentCheck(v, prefix);
					entry.opts.set(true, {
						name: true,
						description: "Option: " + v.name + " enabled",
						content: v.content,
						inputDocumentUrl: v.inputDocumentUrl,
					});
					entry.opts.set(false, {
						name: false,
						description: "Option: " + v.name + " disabled",
					});
				} else {
					this.logger.throwError("Input document: '" + prefix + ".type' is unknown: " + v.type);
				}
				this.variations.set(v.name, entry);
			}
		}
	} catch(e) {
		this.logger.error("Exception when attemping to parse variations: ", e);
	}
};

InputDocumentHandler.prototype._rebaseDocUrls = function(doc) {
	try {
		if (this.baseUrl && doc.serviceInput && typeof doc.serviceInput === "object") {
			if (doc.serviceInput.timeline) doc.serviceInput.timeline = URI(doc.serviceInput.timeline).absoluteTo(this.baseUrl).toString();
			if (doc.serviceInput.layout) doc.serviceInput.layout = URI(doc.serviceInput.layout).absoluteTo(this.baseUrl).toString();
			if (doc.serviceInput.layoutv3) doc.serviceInput.layoutv3 = URI(doc.serviceInput.layoutv3).absoluteTo(this.baseUrl).toString();
			if (doc.serviceInput.layoutv4) doc.serviceInput.layoutv4 = URI(doc.serviceInput.layoutv4).absoluteTo(this.baseUrl).toString();
		}
	} catch(e) {
		this.logger.error("Exception when attemping to rebase service input URLs: ", e);
	}
	try {
		if (this.baseUrl && doc.setupComponent && typeof doc.setupComponent === "object" && doc.setupComponent.config && typeof doc.setupComponent.config === "object" && doc.setupComponent.config.url) {
			doc.setupComponent.config.url = URI(doc.setupComponent.config.url).absoluteTo(this.baseUrl).toString();
		}
	} catch(e) {
		this.logger.error("Exception when attemping to rebase setup component URL: ", e);
	}
	try {
		if (this.baseUrl && doc.appendHtmlUrl) {
			doc.appendHtmlUrl = URI(doc.appendHtmlUrl).absoluteTo(this.baseUrl).toString();
		}
	} catch(e) {
		this.logger.error("Exception when attemping to rebase append HTML URL: ", e);
	}
};

InputDocumentHandler.prototype._import_wrap = function(name) {
	try {
		const imp = require(name);
		return imp;
	} catch(e) {
		this.logger.throwError("Cannot import module: ", name, ", ", e);
	}
};

InputDocumentHandler.prototype._validateDoc = function(doc, name) {
	if (typeof doc !== "object") this.logger.throwError("Input document is not an object (in " + name + ")");
	argCheck([], 0, this.logger, "InputDocumentHandler input document (in " + name + ")", doc,
			['mode', 'description', 'controllerOptions', 'serviceInput', 'serviceUrlPreset', 'serviceUrls', 'setupStickyDefaultClock',
			'appendHtmlUrl', 'regions', 'rootLayoutRegionElementSelector', 'percentCoordsMode', 'setupCompanion',
			'companionDiscoveryOptions', 'companionJoinOptions', 'setupComponent', 'variations', 'localSignalValues', 'generalSignalValues', 'timedGeneralSignalValues',
			'tvAuxiliaryData', 'debugOptions', 'baseUrl', 'authoringLaunchMode', 'inputDocumentUrl']);
};

InputDocumentHandler.prototype._handleVariations = function(doc) {
	const entries = [];
	for (let [k, v] of this.variationSelections) {
		const entry = this.variations.get(k);
		if (!entry) this.logger.throwError("No such variation: ", k);
		const item = entry.opts.get(v);
		if (!item) this.logger.throwError("No such variation option: ", k, "-->", v);
		if (item.inputDocumentUrl) {
			let url = item.inputDocumentUrl;
			try {
				if (this.inputUrl) url = URI(url).absoluteTo(this.inputUrl).toString();
			} catch(e) {
				this.logger.error("Exception when attemping to rebase variation input document URL: ", e);
			}
			const handler = new InputDocumentHandler({ inputUrl: url, urlAutoRetry: this.urlAutoRetry, logger: this.logger.makeChildLogger("Variation:" + k + "=" + v) });
			entries.push(handler.getDocumentContents().then(function(subdoc) {
				delete subdoc.variations;
				handler._rebaseDocUrls(subdoc);
				item.subdoc = subdoc;
				return item;
			}));
		} else {
			entries.push(Promise.resolve(item));
		}
	}
	return Promise.all(entries).then(function(items) {
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.subdoc) $.extend(true, doc, item.subdoc);
			if (item.content) $.extend(true, doc, item.content);
		}
	});
};

InputDocumentHandler.prototype._init = function(ctx, doc, options) {
	this.logger.info("Processing input document" + ((typeof doc.description === "string") ? ": " + doc.description : ""));
	this._validateDoc(doc, "init");

	if (this.variations.size) {
		return this._handleVariations(doc).then(function() {
			this._validateDoc(doc, "init (post variations)");
			return this._init1(ctx, doc, options);
		}.bind(this));
	} else {
		return this._init1(ctx, doc, options);
	}
};

InputDocumentHandler.prototype._init1 = function(ctx, doc, options) {
	let controllerOptions = {};

	if (doc.baseUrl) this.baseUrl = doc.baseUrl;

	this._rebaseDocUrls(doc);

	if (doc.mode === "tv" || doc.mode === "companion") {
		controllerOptions.deviceType = doc.mode;
	} else if (doc.mode === "standalone") {
		controllerOptions.deviceType = "tv";
	} else {
		this.logger.throwError("Input document: 'mode' is not a valid value: " + doc.mode);
	}

	if (doc.controllerOptions) {
		if (typeof doc.controllerOptions !== "object") this.logger.throwError("Input document: 'controllerOptions' is not an object");
		$.extend(controllerOptions, doc.controllerOptions);
	}
	if (controllerOptions.communalDevice == null) controllerOptions.communalDevice = (controllerOptions.deviceType === "tv");

	const controller = new DMAppController(controllerOptions);
	Object.defineProperties(ctx, {
		controller:           { value: controller },
	});
	{
		const inputDocSubLogger = controller.logger.makeChildLogger("SourceInputDocument");
		const msgParts = [];
		if (typeof doc.description === "string") msgParts.push(doc.description);
		if (this.inputUrl) msgParts.push("URL: " + this.inputUrl);
		if (this.inputObject) msgParts.push("[input object]");
		if (this._haveOverlay) msgParts.push("[has overlay]");
		for (let [k, v] of this.variationSelections) {
			msgParts.push(k + "=" + v);
		}
		inputDocSubLogger.info("Controller was created by input document: " + msgParts.join(", "));
	}
	if (options.controllerPostConstructionCallback) options.controllerPostConstructionCallback(ctx, doc, controller);

	if (doc.localSignalValues) {
		if (typeof doc.localSignalValues !== "object") this.logger.throwError("Input document: 'localSignalValues' is not an object");
		for (let prop in doc.localSignalValues) {
			controller.localSignalMap.getSignal(prop).setValue(doc.localSignalValues[prop]);
		}
	}

	if (doc.generalSignalValues) {
		if (typeof doc.generalSignalValues !== "object") this.logger.throwError("Input document: 'generalSignalValues' is not an object");
		for (let prop in doc.generalSignalValues) {
			controller.setSignalByName(prop, doc.generalSignalValues[prop]);
		}
	}

	if (doc.timedGeneralSignalValues) {
		const self = this;
		if (typeof doc.timedGeneralSignalValues !== "object") self.logger.throwError("Input document: 'timedGeneralSignalValues' is not an object");
		for (let prop in doc.timedGeneralSignalValues) {
			const info = doc.timedGeneralSignalValues[prop];
			if (!info || typeof info !== "object") self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "]' is not an object");
			if (!Array.isArray(info.schedule)) self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "].schedule' is not an array");
			argCheck([], 0, self.logger, "Input document: 'timedGeneralSignalValues[" + prop + "]'", info,
					['schedule']);
			const scheduler = new ClockSchedulerUtil.ClockArrayIntervalScheduler(info.schedule.map(function(item, index) {
				if (!item || typeof item !== "object") self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "].schedule[" + index + "]' is not an object");
				if (!item.hasOwnProperty("value")) self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "].schedule[" + index + "].value' is missing");
				argCheck([], 0, self.logger, "Input document: 'timedGeneralSignalValues[" + prop + "].schedule[" + index + "]'", item,
						['startTime', 'value']);
				if (item.hasOwnProperty("startTime")) {
					const parsed = InputUtil.parseTime(item.startTime, null, true);
					if (parsed != null) return parsed;
					self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "].schedule[" + index + "].startTime' is not a time/number: ", item.startTime);
				} else if (index === 0) {
					return -Infinity;
				} else {
					self.logger.throwError("Input document: 'timedGeneralSignalValues[" + prop + "].schedule[" + index + "].startTime' is missing");
				}
			}));
			scheduler.on("change", function(interval) {
				if (interval.interval == null) return;
				if (interval.interval === -1) {
					controller.setSignalByName(prop, null);
				} else {
					controller.setSignalByName(prop, info.schedule[interval.interval].value);
				}
			});
			scheduler.setClock(controller.timeline.defaultClock);
		}
	}

	if (doc.authoringLaunchMode != null) {
		if (typeof doc.authoringLaunchMode !== "string") this.logger.throwError("Input document: 'authoringLaunchMode' is not a string");
		controller.localSignalMap.getSignal("authoringLaunchMode").setValue(doc.authoringLaunchMode);
	}

	if (doc.mode === "tv") {
		const DMAppTvEmuLib = this._import_wrap('DMAppTvEmuLib');
		const tvEmuSync = new DMAppTvEmuLib.DMAppTvEmuSync(controller);
		const tvEmuController = new DMAppTvEmuLib.DMAppTvEmuController(controller);
		tvEmuController.startApp2App();
		Object.defineProperties(ctx, {
			tvEmuSync:            { value: tvEmuSync },
			tvEmuController:      { value: tvEmuController },
		});
	}
	if (doc.tvAuxiliaryData) {
		if (typeof doc.tvAuxiliaryData !== "object") this.logger.throwError("Input document: 'tvAuxiliaryData' is not an object");
		if (doc.mode === "tv") {
			ctx.tvEmuController.setAuxData(doc.tvAuxiliaryData);
		} else {
			this.logger.warn("Input document: 'tvAuxiliaryData' only has an effect in tv mode");
		}
	}

	if (doc.percentCoordsMode != null) {
		controller.layout.newContextPercentCoords = !!(doc.percentCoordsMode);
		if (doc.mode === "companion") this.logger.warn("Input document: 'percentCoordsMode' has no effect in companion mode");
	}

	let urls = {};
	if (doc.serviceUrlPreset) {
		const preset = DMAppController.serviceUrlPresets[doc.serviceUrlPreset];
		if (preset) {
			urls = $.extend(urls, preset);
		} else {
			this.logger.throwError("Input document: Unknown service URL preset: " + doc.serviceUrlPreset);
		}
	}
	if (doc.serviceUrls) {
		if (typeof doc.serviceUrls !== "object") this.logger.throwError("Input document: 'serviceUrls' is not an object");
		urls = $.extend(urls, doc.serviceUrls);
	}
	controller.setUrls(urls);

	if (doc.debugOptions) {
		if (typeof doc.debugOptions !== "object") this.logger.throwError("Input document: 'debugOptions' is not an object");
		argCheck([], 0, this.logger, "InputDocumentHandler: debugOptions", doc.debugOptions,
				['debugComponent', 'devLogging', 'failurePlaceholders', 'timelineMasterOverride', 'remoteControlTimelineMasterOverride']);
		if (doc.debugOptions.debugComponent) controller.app2appMsgBusCtl.send({}, '@self', '**create_debug_component');
		if (doc.debugOptions.devLogging) controller.enableDevDialogLogging();
		if (doc.debugOptions.failurePlaceholders != null) controller.layout.failedComponentPlaceholderMode = !!doc.debugOptions.failurePlaceholders;
		if (doc.debugOptions.timelineMasterOverride) DebugMiscUtil.setupTimelineMasterOverrideDebugUtil(controller, doc.debugOptions.timelineMasterOverride);
		if (doc.debugOptions.remoteControlTimelineMasterOverride) DebugMiscUtil.setupRemoteControlTimelineMasterOverrideDebugUtil(controller, doc.debugOptions.remoteControlTimelineMasterOverride);
	}

	if (doc.appendHtmlUrl) {
		return CustomElementUtil.loadAndConcatHtmlImport(doc.appendHtmlUrl, this.logger, { name: "Input document appendHtmlUrl option" }).then(this._init2.bind(this, ctx, doc, options));
	} else {
		return this._init2(ctx, doc, options, null);
	}
};

InputDocumentHandler.prototype._init2 = function(ctx, doc, options, linkNode) {
	const self = this;
	if (options.postAppendHtmlUrlCallback) options.postAppendHtmlUrlCallback(ctx, doc, doc.appendHtmlUrl || null, linkNode);
	if (doc.rootLayoutRegionElementSelector) {
		const element = document.querySelector(doc.rootLayoutRegionElementSelector);
		if (!element) this.logger.warn("Input document: rootLayoutRegionElementSelector: '" + doc.rootLayoutRegionElementSelector + "' failed to return an element");
		ctx.controller.layout.layoutRegionCtl.setRootLayoutRegionElement(element);
	}
	if (doc.regions) {
		if (!Array.isArray(doc.regions)) this.logger.throwError("Input document: 'regions' is not an array");
		ctx.controller.layout.layoutRegionCtl.addLayoutRegions.apply(
			ctx.controller.layout.layoutRegionCtl, doc.regions);
	}
	if (doc.setupComponent) {
		return ctx.controller.layout.testCreateLayoutComponent(doc.setupComponent, { promise: true }).then(function(component) {
			if (component.inputDocumentSetup) {
				return component.inputDocumentSetup(self, ctx, doc).then(function(updatedDoc) {
					return self._initServices(ctx, updatedDoc, options);
				});
			} else {
				return self._initServices(ctx, doc, options);
			}
		});
	} else {
		return Promise.resolve(self._initServices(ctx, doc, options));
	}
};

InputDocumentHandler.prototype._initServices = function(ctx, doc, options) {
	this._validateDoc(doc, "init services");

	const controller = ctx.controller;

	let setupStickyDefaultClock = doc.setupStickyDefaultClock;
	if (doc.serviceInput) {
		if (doc.mode === "companion") this.logger.throwError("Input document: 'serviceInput' may not be used in companion mode");
		const serviceInput = doc.serviceInput;
		if (typeof serviceInput !== "object") this.logger.throwError("Input document: 'serviceInput' is not an object");
		let layoutDoc = serviceInput.layout;
		if (serviceInput.layoutv3 && controller.getUrl('layoutService').endsWith('v3')) layoutDoc = serviceInput.layoutv3;
		if (serviceInput.layoutv4 && controller.getUrl('layoutService').endsWith('v4')) layoutDoc = serviceInput.layoutv4;
		controller.layout.io.setupContextAndDmapp(serviceInput.timeline, layoutDoc, serviceInput.contextRejoinMode);
		if (setupStickyDefaultClock == null) setupStickyDefaultClock = true;
	}
	if (setupStickyDefaultClock) controller.timeline.setupStickyDefaultClock();

	let setupCompanion = (doc.mode === "companion");
	if (doc.setupCompanion != null) setupCompanion = !!doc.setupCompanion;
	if (setupCompanion) {
		const DMAppCompLib = this._import_wrap('DMAppCompLib');
		if (doc.companionJoinOptions) {
			if (typeof doc.companionJoinOptions !== "object") this.logger.throwError("Input document: 'companionJoinOptions' is not an object");
			argCheck([], 0, this.logger, "InputDocumentHandler: companionJoinOptions", doc.companionJoinOptions,
					['noContextJoin']);
		}
		const compController = new DMAppCompLib.DMAppComp(controller, {
			useApp2AppSync: true,
			noContextJoin: doc.companionJoinOptions && doc.companionJoinOptions.noContextJoin,
		});
		Object.defineProperties(ctx, {
			compController:       { value: compController },
		});
		if (doc.companionDiscoveryOptions) {
			const companionDiscoveryCtl = compController.setupCompanionPlatformSpecificDiscovery(doc.companionDiscoveryOptions);
			Object.defineProperties(ctx, {
				companionDiscoveryCtl:    { value: companionDiscoveryCtl },
			});
		}
	} else if (doc.companionDiscoveryOptions) {
		this.logger.throwError("Input document: 'companionDiscoveryOptions' may only be used when 'setupCompanion' is true (companion mode)");
	} else if (doc.companionJoinOptions) {
		this.logger.throwError("Input document: 'companionJoinOptions' may only be used when 'setupCompanion' is true (companion mode)");
	}
	return ctx;
};

module.exports = {
	InputDocumentHandler: InputDocumentHandler,
};
