/************************************************************************/
/* FILE:                TestConfigTestComponent.js                      */
/* DESCRIPTION:         Test config test component                      */
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

(function() {
	"use strict";

	const import_wrap = function(name) {
		try {
			const imp = require(name);
			return imp;
		} catch(e) {
			/* swallow */
			return null;
		}
	};

	const DMAppClientLib = require('DMAppClientLib');
	const DMAppCompLib = import_wrap('DMAppCompLib');
	const DMAppTvEmuLib = import_wrap('DMAppTvEmuLib');
	const $ = DMAppClientLib.deps.jquery;
	const URI = DMAppClientLib.deps.URI;

	const tvModeOk = !(window.cordova || !DMAppTvEmuLib) || /ODROID/.test(window.navigator.userAgent);

	const serviceInputs = {
		none: {
			layout: "",
			timeline: "",
		},
	};

	const service_url_presets = [
		{
			name: "Local (v4 Docker)",
			layoutService: "http://127.0.0.1:8000/layout/v4",
			websocketService: "http://127.0.0.1:3000/",
			timelineService: "http://127.0.0.1:8080/timeline/v1",
			bandwidthOrchestrationService: 'http://127.0.0.1:4000/',
			sharedStateService: "http://127.0.0.1:8081/",
			loggingService: "http://127.0.0.1:3001/",
			layoutServiceFromTimelineService: '',
			cordovaOk: false,
			showUrls: true,
		},
		{
			name: "Local (v3)",
			layoutService: "http://127.0.0.1:9701/layout/v3",
			websocketService: "http://127.0.0.1:9703/",
			timelineService: "http://127.0.0.1:9702/timeline/v1",
			bandwidthOrchestrationService: '',
			layoutServiceFromTimelineService: '',
			cordovaOk: false,
			showUrls: true,
		},
	];

	/**
	 * Test Components
	 * @namespace TestComponents
	 */
	/**
	 * @typedef {Object} TestComponents.TestConfigTestComponent~Configuration
	 * @prop {!string} mode Mode: tv, companion, standalone, or standalone_ns
	 * @prop {Object=} serviceInput
	 * @prop {string=} serviceInput.layout Layout document service input, using {@link DMAppLayoutIO#setupContextAndDmapp}
	 * @prop {string=} serviceInput.timeline Timeline document service input, using {@link DMAppLayoutIO#setupContextAndDmapp}
	 * @prop {string=} serviceInput.contextRejoinMode See {@link DMAppLayoutIO#setupContextAndDmapp}
	 * @prop {Array.<string>=} serviceInput.regions Test region list input
	 * @prop {Object.<string>=} urls Service URLs: See {@link DMAppController#setUrls}
	 * @prop {string=} deviceIdPrefix Forwarded to {@link DMAppController} constructor
	 * @prop {string=} deviceIdNamespace Forwarded to {@link DMAppController} constructor
	 * @prop {string=} deviceIdNamespaceGroup Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} debugComp Show debug component
	 * @prop {boolean=} makeNewDeviceId Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} touchInteraction Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} failurePlaceholders Set value of {@link DMAppLayout#failedComponentPlaceholderMode}
	 * @prop {boolean=} showUserErrorMessageUI Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} longFormConsoleLogging Forwarded to {@link DMAppController} constructor
	 * @prop {(number|string)=} networkLogLevel Forwarded to {@link DMAppController} constructor
	 * @prop {string=} networkLogSourcePostfix Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} devLogging Call {@link DMAppController#enableDevDialogLogging}
	 * @prop {boolean=} advDebugMode Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} wallclockServiceRemoteClockSync Increase ref-count of {@link DMAppTimeline#wallclockServiceRemoteClockSyncEnableRefCount}
	 * @prop {boolean=} percentCoordsMode Set value of {@link DMAppLayout#newContextPercentCoords}
	 * @prop {number=} displayWidth Forwarded to {@link DMAppController} constructor
	 * @prop {number=} displayHeight Forwarded to {@link DMAppController} constructor
	 * @prop {string=} joinInterContextSyncGroup Set inter-context sync ID using: {@link DMAppTimeline#setInterContextSyncId}
	 * @prop {ajaxCredentials=} serviceAjaxCredentials Forwarded to {@link DMAppController} constructor
	 * @prop {boolean=} componentFailTest Component failure test
	 * @prop {string=} componentUrlTransformStr Read source before use
	 * @prop {boolean=} mediaPlayerFullLogging Media player (DASH.js) full logging by default
	 * @prop {(boolean|Object)=} timelineMasterOverride Local clock state override debugging tool, use ONLY for local debugging, DO NOT enable by default in any user-facing configuration. Read source carefully before attempting to supply an object, use a boolean instead.
	 * @prop {(boolean|Object)=} remoteControlTimelineMasterOverride Remote controlled local clock state override debugging tool, use ONLY for remote controlled clock control debugging. Specifying an object will use it as an initial input.
	 * @prop {boolean=} promiseRejectionTracking Read source before use
	 */
	/**
	 * @typedef {Object} TestComponents.TestConfigTestComponent~Parameters
	 * @prop {TestComponents.TestConfigTestComponent~Configuration=} launch Launch immediately using the given configuration
	 */
	/**
	 * Test configuration test component
	 *
	 * The component parameters are defined by {@link TestComponents.TestConfigTestComponent~Parameters}
	 *
	 * If the page URL includes fragment parameters: (URL suffix of the form: #?a=1&b=2...), and the component parameter launch field is not specified:
	 * the parameters are used as follows:
	 *
	 * (Where a fragment parameter is defined as of a boolean type, acceptable string values for true include: `true, t, yes, y, on`, and for false include: `false, f, no, n, off`)
	 *
	 * If the `inputDocument` parameter is present and non-empty:
	 * * The input document loaded from the URL in the parameter value is executed.
	 * * If the `inputDocumentVariations` parameter is present and non-empty, it is parsed as a comma-separated list of items, each of which is either: a variation name, a variation name and value separated by an '@' character.
	 * * All other fragment parameters (except `inputDocumentVariations`) are ignored.
	 *
	 * If either: the `layout` and `timeline` parameters are both present and non-empty, or the boolean `autostart` parameter is present and true; then a test is automatically launched.
	 * Fragment parameters are mapped to fields of the {@link TestComponents.TestConfigTestComponent~Configuration} object according to the table below.
	 *
	 * | Fragment parameter               | [Configuration]{@link TestComponents.TestConfigTestComponent~Configuration} field | Type     | Default     | Notes                                                                           |
	 * | -------------------------------- | --------------------------------------------------------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------- |
	 * | mode                             | mode                                                                              | String   |             | Overrides tvemu fragment parameter                                              |
	 * | tvemu                            | mode                                                                              | Boolean  | False       | sets mode to `tv` if true, `standalone` if false                                |
	 * | layout                           | serviceInput.layout                                                               | String   |             |                                                                                 |
	 * | timeline                         | serviceInput.timeline                                                             | String   |             |                                                                                 |
	 * | contextRejoinMode                | serviceInput.contextRejoinMode                                                    | String   |             |                                                                                 |
	 * | serviceUrlPreset                 | urls                                                                              | String   |             | Set service URLs to named preset, see {@link DMAppController.serviceUrlPresets} |
	 * | layoutService                    | urls.layoutService                                                                | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | websocketService                 | urls.websocketService                                                             | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | timelineService                  | urls.timelineService                                                              | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | sharedStateService               | urls.sharedStateService                                                           | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | loggingService                   | urls.loggingService                                                               | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | wallclockService                 | urls.wallclockService                                                             | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | authService                      | urls.authService                                                                  | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | bandwidthOrchestrationService    | urls.bandwidthOrchestrationService                                                | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | layoutServiceFromTimelineService | urls.layoutServiceFromTimelineService                                             | String   |             | Overrides sub field specified by serviceUrlPreset                               |
	 * | debugComp                        | debugComp                                                                         | Boolean  | True        |                                                                                 |
	 * | makeNewDeviceId                  | makeNewDeviceId                                                                   | Boolean  | False       |                                                                                 |
	 * | touchInteraction                 | touchInteraction                                                                  | Boolean  |             |                                                                                 |
	 * | failurePlaceholders              | failurePlaceholders                                                               | Boolean  | True        |                                                                                 |
	 * | devLogging                       | devLogging                                                                        | Boolean  | True        |                                                                                 |
	 * | advDebugMode                     | advDebugMode                                                                      | Boolean  | True        |                                                                                 |
	 * | wallclockServiceRemoteClockSync  | wallclockServiceRemoteClockSync                                                   | Boolean  | False       |                                                                                 |
	 * | percentCoordsMode                | percentCoordsMode                                                                 | Boolean  | False       |                                                                                 |
	 * | displayWidth                     | displayWidth                                                                      | Number   |             |                                                                                 |
	 * | displayHeight                    | displayHeight                                                                     | Number   |             |                                                                                 |
	 * | displayResolution                | displayResolution                                                                 | Number   |             |                                                                                 |
	 * | joinInterContextSyncGroup        | joinInterContextSyncGroup                                                         | String   |             |                                                                                 |
	 * | showUserErrorMessageUI           | showUserErrorMessageUI                                                            | Boolean  | True        |                                                                                 |
	 * | longFormConsoleLogging           | longFormConsoleLogging                                                            | Boolean  | True        |                                                                                 |
	 * | networkLogLevel                  | networkLogLevel                                                                   | String   |             |                                                                                 |
	 * | networkLogSourcePostfix          | networkLogSourcePostfix                                                           | String   |             |                                                                                 |
	 * | componentFailTest                | componentFailTest                                                                 | Boolean  | False       |                                                                                 |
	 * | componentUrlTransformStr         | componentUrlTransformStr                                                          | String   |             |                                                                                 |
	 * | mediaPlayerFullLogging           | mediaPlayerFullLogging                                                            | Boolean  | False       |                                                                                 |
	 * | timelineMasterOverride           | timelineMasterOverride                                                            | Boolean  | False       |                                                                                 |
	 * | remoteControlTimelineMasterOverride | remoteControlTimelineMasterOverride                                            | Boolean  | False       |                                                                                 |
	 * | promiseRejectionTracking         | promiseRejectionTracking                                                          | Boolean  | False       |                                                                                 |
	 *
	 * If a test is not auto-launched:
	 * If the `ding` fragment parameter is present and non-empty, the value is inserted into the device ID namespace group textbox.
	 * If the `tcng` fragment parameter is present and non-empty, the value is concatenated to the local storage key name prefix used for storage of persistent test component configuration.
	 *
	 * @implements DMAppComponent
	 * @constructor
	 * @alias TestConfigTestComponent
	 * @memberof TestComponents
	 * @extends DMAppComponentBehaviour
	 */
	DMAppClientLib.dMAppComponentTypes.TestConfigTestComponent = Polymer({

		is: "test-config-test-component",

		initDMAppComponent: function(dMAppController, id, typeName, config) {
			const self = this;
			DMAppClientLib.DMAppComponentBehaviour.initDMAppComponent.apply(this, arguments);

			self.localStoragePrefix = "TestVideoTestComponent";

			const uri = new URI(location.href);
			const uri_fragment = uri.fragment();
			if (uri_fragment) {
				const parseBool = DMAppClientLib.InputUtil.parseBool;
				try {
					const params = URI.parseQuery(uri_fragment);
					self.logger.info("Loaded fragment: ", uri_fragment, params);
					if (params.inputDocument) {
						return self.readyPromise.done(function() {
							const handler = new DMAppClientLib.InputDocument.InputDocumentHandler({
								inputUrl: params.inputDocument,
								logger: self.logger.makeChildLogger("InputDocumentHandler"),
							});
							if (params.inputDocumentVariations) {
								const opts = params.inputDocumentVariations.split(',');
								for (let i = 0; i < opts.length; i++) {
									const res = opts[i].split('@');
									if (res.length === 1) {
										handler.setVariation(res[0], true);
									} else if (res.length === 2) {
										handler.setVariation(res[0], res[1]);
									} else {
										self.logger.warn("Cannot parse inputDocumentVariations item: " + opts[i]);
									}
								}
							}
							handler.executeDocument();
							self._selfDestruct();
						});
					}
					if (parseBool(params.autostart, false) || (params.layout && params.timeline)) {
						return self.readyPromise.done(function() {
							const mode = params.mode || (parseBool(params.tvemu, false) ? "tv" : "standalone");
							const cfg = {
								deviceIdPrefix: "test",
								deviceIdNamespace: "test_fragment_" + mode,
								deviceIdNamespaceGroup: params.deviceIdNamespaceGroup || null,
								debugComp: parseBool(params.debugComp, true),
								makeNewDeviceId: parseBool(params.makeNewDeviceId, false),
								mode: mode,
								touchInteraction: parseBool(params.touchInteraction, null),
								failurePlaceholders: parseBool(params.failurePlaceholders, true),
								devLogging: parseBool(params.devLogging, true),
								showUserErrorMessageUI: parseBool(params.showUserErrorMessageUI, true),
								longFormConsoleLogging: parseBool(params.longFormConsoleLogging, true),
								networkLogLevel: params.networkLogLevel || null,
								componentFailTest: parseBool(params.componentFailTest, false),
								advDebugMode: parseBool(params.advDebugMode, false),
								mediaPlayerFullLogging: parseBool(params.mediaPlayerFullLogging, false),
								promiseRejectionTracking: parseBool(params.promiseRejectionTracking, false),
								wallclockServiceRemoteClockSync: parseBool(params.wallclockServiceRemoteClockSync, false),
								percentCoordsMode: parseBool(params.percentCoordsMode, false),
								displayWidth: params.displayWidth || null,
								displayHeight: params.displayHeight || null,
								displayResolution: params.displayResolution || null,
								componentUrlTransformStr: params.componentUrlTransformStr || null,
								joinInterContextSyncGroup: params.joinInterContextSyncGroup || null,
								timelineMasterOverride: parseBool(params.timelineMasterOverride, false),
								remoteControlTimelineMasterOverride: parseBool(params.remoteControlTimelineMasterOverride, false),
								serviceInput: $.extend(self._urlFixup({
										layout: params.layout ? new URI(params.layout, location.href).toString() : null,
										timeline: params.layout ? new URI(params.timeline, location.href).toString() : null,
									}), {
										regions: params.regions ? self._parseRegionList(params.regions) : null,
										contextRejoinMode: params.contextRejoinMode || null,
									}),
								networkLogSourcePostfix: params.networkLogSourcePostfix || null,
							};

							if (params.serviceUrlPreset) {
								const preset = DMAppClientLib.DMAppController.serviceUrlPresets[params.serviceUrlPreset];
								if (preset) {
									cfg.urls = $.extend({}, preset);
								} else {
									throw "Unknown service URL preset: " + params.serviceUrlPreset;
								}
							}
							const urlProps = DMAppClientLib.DMAppController.getUrlProps();
							for (let i = 0; i < urlProps.length; i++) {
								if (params[urlProps[i]]) {
									if (!cfg.urls) cfg.urls = {};
									cfg.urls[urlProps[i]] = params[urlProps[i]];
								}
							}

							self._initTestConfig(cfg);
						});
					}
					if (params.ding) {
						self.readyPromise.done(function() {
							self.$$('#device_id_namespace_group_tb').value = params.ding;
						});
					}
					if (params.tcng) {
						self.localStoragePrefix += "#" + params.tcng;
					}
				} catch (e) {
					self.logger.error("Failed to parse uri fragment: ", e);
				}
			}

			self.readyPromise.done(function() {
				if (config && config.parameters && config.parameters.launch) {
					return self._initTestConfig(config.parameters.launch);
				}
				$(self.$$('#version_field')).text("DMAppController version: " + DMAppClientLib.version);
				if (window.cordova) {
					$.ajax({
						dataType: "text",
						url: "./version",
					}).done(function(data) {
						$(self.$$('#version_field')).text("APK version: " + data);
					});
					$.ajax({
						dataType: "text",
						url: "./build-date",
					}).done(function(data) {
						const field = $(self.$$('#build_date'));
						field.text("Build date: " + data);
						field.css("display", "");
					});
				}
				$(self.$$('#browser_version_field')).text("Browser version: " + window.navigator.userAgent);
				if (!tvModeOk) self.$$('#tv_mode_block').style.display = "none";
				if (!DMAppCompLib) self.$$('#companion_mode_block').style.display = "none";
				self.$$('#main_div').style.visibility = "inherit";
				$(self.$$('#doit')).on('click', function() {
					self._initTest();
				});
				const url_items = $(Polymer.dom(self.root).querySelectorAll('.svc_url'));
				const ns_url_items = $(Polymer.dom(self.root).querySelectorAll('.no_standalone_url'));
				const button_reset_url_div = self.$$('#button_reset_url_div');
				const service_input_block = self.$$('#service_input_block');
				const context_mode_block = self.$$('#context_mode_block');
				const inter_context_sync_block = self.$$('#inter_context_sync_block');
				const mode_radio_change_handler = function() {
					const mode = self.$$('input[name=mode_radio]:checked').value;
					const show_urls = !!self.$$('#show_urls_opt:checked');
					url_items.css('display', (show_urls ? "block" : "none"));
					if (mode === "standalone_ns") ns_url_items.css('display', "none");
					button_reset_url_div.style.display = ((mode === "standalone_ns" && !self.$$('#adv_opt:checked') && !show_urls) ? "none" : "block");
					service_input_block.style.display = ((mode === "standalone_ns" || mode === "companion") ? "none" : "block");
					context_mode_block.style.display = ((mode === "standalone_ns" || mode === "companion") ? "none" : "block");
					inter_context_sync_block.style.display = (mode === "companion" ? "none" : "block");
				};
				$(Polymer.dom(self.root).querySelectorAll('input[name=mode_radio]')).on('change', mode_radio_change_handler);
				$(self.$$('#show_urls_opt')).on('change', mode_radio_change_handler);
				const service_input_url_block = self.$$('#service_input_url_block');
				const service_input_radio_change_handler = function() {
					const mode = self.$$('input[name=input_radio]:checked').value;
					service_input_url_block.style.display = (mode === "custom") ? "block" : "none";
				};
				$(Polymer.dom(self.root).querySelectorAll('input[name=input_radio]')).on('change', service_input_radio_change_handler);
				self._setupUrlBoxes(self._serviceUrlFunc);
				self._setupUrlBoxes(self._serviceInputUrlFunc);
				self._loadStoredRadioButtons(self._radioButtonFunc);
				self._loadStoredCheckBoxes(self._checkBoxFunc);
				self._loadStoredTextBoxes(self._textBoxFunc);
				service_input_radio_change_handler();

				if (self.$$('#input_doc_remember_settings_cb:checked')) {
					try {
						self.input_doc_stored_variations = JSON.parse(localStorage.getItem(self.localStoragePrefix + "_inputDoc_variations"));
					} catch(e) {
						/* swallow */
					}
				}

				const svcButtonMap = new Map();

				const service_url_input_handler = function() {
					let foundPreset = null;
					for (let [button, urls] of svcButtonMap) {
						let ok = true;
						self._serviceUrlFunc(function(elem, name) {
							if (urls[name] != null && elem.value !== urls[name]) ok = false;
						});
						button.style.fontWeight = ok ? "bold" : "normal";
						if (ok) foundPreset = urls;
					}
					if (!foundPreset || foundPreset.showUrls) {
						$(self.$$('#show_urls_opt')).prop("checked", true).prop("disabled", true);
						mode_radio_change_handler();
					} else {
						$(self.$$('#show_urls_opt')).prop("disabled", false);
					}
				};
				url_items.on("input", service_url_input_handler);

				for (let i = 0; i < service_url_presets.length; i++) {
					const preset = service_url_presets[i];
					if (preset.cordovaOk === false && window.cordova) continue;

					if (preset.src) $.extend(preset, preset.src);

					let presetName = preset.name;
					if (preset.src && preset.src === dMAppController._defaultPreset) presetName += " (default)";
					const button = $('<button>' + presetName + '</button>');
					button.on('click', function() {
						if (preset.showUrls) $(self.$$('#show_urls_opt')).prop("checked", true);
						self._serviceUrlFunc(function(elem, name) {
							if (preset[name] != null) elem.value = preset[name];
						});
						mode_radio_change_handler();
						service_url_input_handler();
					});
					button_reset_url_div.appendChild(button[0]);
					svcButtonMap.set(button[0], preset);
				}
				service_url_input_handler();

				const adv_opt_handler = function() {
					$(Polymer.dom(self.root).querySelectorAll('.adv')).toggleClass('adv_hidden', !self.$$('#adv_opt:checked'));
					$(Polymer.dom(self.root).querySelectorAll('.very_adv')).toggleClass('adv_hidden', !self.$$('#very_adv_opt:checked'));
					$(Polymer.dom(self.root).querySelectorAll('.test_opt')).toggleClass('adv_hidden', !self.$$('#testing_opt:checked'));
					mode_radio_change_handler();
				};
				$(self.$$('#adv_opt')).on('change', adv_opt_handler);
				$(self.$$('#very_adv_opt')).on('change', adv_opt_handler);
				$(self.$$('#testing_opt')).on('change', adv_opt_handler);
				adv_opt_handler();

				const override_clock_params_handler = function() {
					$(self.$$('#override_clock_params')).toggleClass('adv_hidden', !self.$$('#override_clock_cb:checked'));
				};
				$(self.$$('#override_clock_cb')).on('change', override_clock_params_handler);
				override_clock_params_handler();

				const network_logging_opts_handler = function() {
					$(self.$$('#network_logging_source_postfix_block')).toggleClass('adv_hidden', self.$$('input[name=remote_logging_radio]:checked').value === "off");
				};
				$(Polymer.dom(self.root).querySelectorAll('input[name=remote_logging_radio]')).on('change', network_logging_opts_handler);
				network_logging_opts_handler();

				self._setupInputDocHandler();

				self._checkSystemTime();
			});
		},

		_resetInputDoc: function() {
			$(this.$$('#input_doc_info_block')).empty();
			this.$$('#input_doc_doit').style.display = 'none';
			this._inputDocHandler = null;
		},

		_setupInputDocAdvModeChange: function() {
			const adv_mode = !!this.$$('#input_doc_adv_mode_cb:checked');
			$(Polymer.dom(this.root).querySelectorAll('.cc_block')).toggleClass('doc_cc_block_enabled', adv_mode);
			$(this.$$("#input_doc_setting_warn_msg_prefix")).text(adv_mode ? " not marked with " : "");
			$(this.$$("#input_doc_setting_warn_msg_prefix")).toggleClass("doc_cc_block_enabled", adv_mode);
		},

		_handleInputDoc: function(handler, documentInfo) {
			const self = this;
			const execBtn = self.$$('#input_doc_doit');
			self._inputDocHandler = handler;
			handler.getDocumentContents().then(function(doc) {
				if (self._inputDocHandler !== handler) return;
				let storedVariations = {};
				if (self.input_doc_stored_variations && self.input_doc_stored_variations.url !== handler.inputUrl) delete self.input_doc_stored_variations;
				if (self.input_doc_stored_variations && self.input_doc_stored_variations.variations) storedVariations = self.input_doc_stored_variations.variations;
				execBtn.textContent = "Launch " + (doc.description ? doc.description : "input document");
				execBtn.style.display = 'inline-block';
				execBtn.disabled = true;
				const execBtnBlocker = new DMAppClientLib.Signal.BlockCountSignal();
				if (Array.isArray(doc.variations)) {
					for (let i = 0; i < doc.variations.length; i++) {
						const v = doc.variations[i];
						const appendDiv = function(div) {
							if (v.uiAdvanced) {
								div.classList.add("adv");
								div.classList.toggle("adv_hidden", !self.$$('#adv_opt:checked'));
							}
							Polymer.dom(self.$$('#input_doc_info_block')).appendChild(div);
						};
						if (v.type === "select") {
							const div = $("<div />");
							if (v.description) div.text(v.description);
							if (v.required) execBtnBlocker.registerBlocker(v);
							let haveSetVariation = false;
							let haveDefaultVariation = false;
							for (let j = 0; j < v.options.length; j++) {
								const opt = v.options[j];
								const item = $("<div style='margin-left: 2em'><label><input name='input_doc_var_radio_" + v.name + "' type='radio' /></label></div>");
								item.find('label').append(document.createTextNode(opt.description));
								const doSet = function(check) {
									if (check) item.find('input').prop("checked", true);
									execBtnBlocker.unregisterBlocker(v);
									self._inputDocHandler.setVariation(v.name, opt.name);
								};
								if (!haveSetVariation && (storedVariations[v.name] === opt.name)) {
									haveSetVariation = true;
									doSet(true);
								}
								if (!haveSetVariation && !haveDefaultVariation && (v.default === opt.name)) {
									haveDefaultVariation = true;
									doSet(true);
								}
								if (!haveSetVariation && !haveDefaultVariation && (!opt.inputDocumentUrl && (opt.content == null || $.isEmptyObject(opt.content)))) {
									doSet(true);
								}
								item.find('input').click(function() {
									doSet(false);
								});
								div.append(item);
							}
							appendDiv(div[0]);
						} else if (v.type === "optional") {
							const div = $("<div><label><input name='input_doc_var_cb_" + v.name + "' type='checkbox' /></label></div>");
							if (v.description) div.find('label').append(document.createTextNode(v.description));
							const input = div.find('input');
							if (storedVariations[v.name] === true) {
								input.prop("checked", true);
								self._inputDocHandler.setVariation(v.name, true);
							}
							input.click(function() {
								self._inputDocHandler.setVariation(v.name, !!input.prop("checked"));
							});
							appendDiv(div[0]);
						} else if (v.type === "optional/string") {
							const div = $("<div><label><input name='input_doc_var_tb_" + v.name + "' type='text' /></label></div>");
							if (v.description) div.find('label').prepend(document.createTextNode(v.description));
							const input = div.find('input');
							if (storedVariations[v.name]) {
								input.prop("value", storedVariations[v.name]);
								self._inputDocHandler.setVariation(v.name, storedVariations[v.name]);
							}
							input.on("input", function() {
								self._inputDocHandler.setVariation(v.name, input.prop("value"));
							});
							appendDiv(div[0]);
						} else {
							self.logger.warn("Unexpected variation type: ", v.type);
						}
					}
				}
				execBtnBlocker.awaitEqual(0, function() {
					execBtn.disabled = false;
				});
			}).catch(function(info) {
				self.dMAppController.showNotification({
					error: true,
					text: "Failed to load input document: " + documentInfo + ", " + info,
				});
				self.logger.error("Failed to load input document: " + documentInfo + ", " + info);
			});
		},

		_setupInputDocHandler: function() {
			const self = this;
			const execBtn = self.$$('#input_doc_doit');
			$(self.$$('#input_doc_adv_mode_cb')).click(self._setupInputDocAdvModeChange.bind(self));
			$(self.$$('#input_doc_tb')).on('change', self._resetInputDoc.bind(self));
			$(self.$$('#input_doc_tb')).on('input', self._resetInputDoc.bind(self));
			$(self.$$('#input_doc_local')).on('change', function() {
				if (this.files.length) {
					self.$$('#input_doc_tb').value = '';
					self._resetInputDoc();
					const file = this.files[0];
					const content = new DMAppClientLib.deps.promise(function(resolve, reject) {
						const reader = new FileReader();
						reader.onload = function() {
							resolve(JSON.parse(reader.result));
						};
						reader.onabort = reader.onerror = reject;
						reader.readAsText(file);
					});
					content.catch(function(info) {
						self.dMAppController.showNotification({
							error: true,
							text: "Failed to load local input document: " + info,
						});
						self.logger.error("Failed to load local input document: " + info);
					});
					const handler = new DMAppClientLib.InputDocument.InputDocumentHandler({
						inputObject: content,
						logger: self.logger.makeChildLogger("InputDocumentHandler"),
					});
					self._handleInputDoc(handler, "Local file: " + file.name);
				}
			});
			$(self.$$('#input_doc_load')).click(function() {
				self.$$('#input_doc_local').value = '';
				self._resetInputDoc();
				const url = self.$$('#input_doc_tb').value;
				if (url) {
					const handler = new DMAppClientLib.InputDocument.InputDocumentHandler({
						inputUrl: url,
						urlAutoRetry: false,
						logger: self.logger.makeChildLogger("InputDocumentHandler"),
					});
					self._handleInputDoc(handler, url);
				}
			});
			$(execBtn).click(function() {
				if (!self._inputDocHandler) return;
				self.logger.info("About to switch to input document");

				if (self._inputDocHandler.inputUrl && self.$$('#input_doc_remember_settings_cb:checked')) {
					try {
						const variations = {};
						for (let [k, v] of self._inputDocHandler.variationSelections) {
							variations[k] = v;
						}
						localStorage.setItem(self.localStoragePrefix + "_inputDoc_variations", JSON.stringify({
							url: self._inputDocHandler.inputUrl,
							variations: variations,
						}));
					} catch(e) {
						/* swallow */
					}
				}

				self._storeRadioButtons(self._radioButtonFunc);
				self._storeCheckBoxes(self._checkBoxFunc);
				self._storeTextBoxes(self._textBoxFunc);
				const execOpts = {};
				if (self.$$('#input_doc_adv_mode_cb:checked')) {
					const config = self._getCommonControllerParams();
					const urls = self._getAndStoreUrls(self._serviceUrlFunc);
					const credentials = self._getCredentials();
					const overlay = {
						controllerOptions: $.extend({ defaultLogLevel: DMAppClientLib.Logger.levels.TRACE }, self._mapCommonControllerConfigToOptions(config)),
						serviceUrlPreset: null,
						serviceUrls: urls,
					};
					if (config.debugComp) {
						$.extend(true, overlay, {
							debugOptions: {
								debugComponent: true,
							},
						});
					}
					self._inputDocHandler.applyOverlay(overlay).then(function(newDoc) {
						self.logger.info("Overlay modifying input document --> ", newDoc);
					});
					execOpts.controllerPostConstructionCallback = function(ctx, doc, controller) {
						controller.initedWaitable.then(function() {
							self._commonSetupControllerFromConfig(controller, config);
						});
						if (credentials) controller.serviceAjaxCredentials = credentials;
					};
				}
				self._selfDestruct();
				self._inputDocHandler.executeDocument(execOpts).then(function() {
					self.logger.info("Input document execute completed successfully");
				}, function(info) {
					self.dMAppController.showNotification({
						error: true,
						text: "Failed to execute input document: " + info,
					});
					self.logger.error("Failed to execute input document: " + info);
				});
			});
			self._setupInputDocAdvModeChange();

			const parent = $(self.$$('#input_doc_url_presets'));
			const addPreset = function(url, text) { // jshint ignore:line
				const btn = $('<button />');
				btn.text(text);
				btn.click(function() {
					self.$$('#input_doc_tb').value = url;
					$(self.$$('#input_doc_load')).click();
				});
				parent.append(btn);
			};
			const addBreak = function(gap) { // jshint ignore:line
				const br = $('<div>');
				if (gap) br.css("margin-bottom", "5px");
				parent.append(br);
			};
		},

		_setupUrlBoxes: function(urlFunc) {
			urlFunc.bind(this)(function(elem, name) {
				let url;
				try {
					url = localStorage.getItem(this.localStoragePrefix + "_url_" + name);
				} catch(e) {
					/* swallow */
				}
				if (url != null) {
					elem.value = url;
				} else {
					elem.value = this.dMAppController._urls[name] || '';
				}
			}.bind(this));
		},

		_getAndStoreUrls: function(urlFunc) {
			const urls = {};
			urlFunc.bind(this)(function(elem, name) {
				const url = elem.value;
				try {
					localStorage.setItem(this.localStoragePrefix + "_url_" + name, url);
				} catch(e) {
					/* swallow */
				}
				urls[name] = url;
			}.bind(this));
			return urls;
		},

		_serviceUrlFunc: function(handler) {
			handler(this.$$('#layout_url_tb'), 'layoutService');
			handler(this.$$('#ws_url_tb'), 'websocketService');
			handler(this.$$('#timeline_url_tb'), 'timelineService');
			handler(this.$$('#shared_state_url_tb'), 'sharedStateService');
			handler(this.$$('#logging_url_tb'), 'loggingService');
			handler(this.$$('#wallclock_url_tb'), 'wallclockService');
			handler(this.$$('#auth_url_tb'), 'authService');
			handler(this.$$('#bos_url_tb'), 'bandwidthOrchestrationService');
			handler(this.$$('#layout_url_from_timeline_tb'), 'layoutServiceFromTimelineService');
			handler(this.$$('#cloud_sync_id_tb'), 'remoteNetSyncService');
		},

		_serviceInputUrlFunc: function(handler) {
			handler(this.$$('#layout_doc_tb'), 'layout');
			handler(this.$$('#timeline_doc_tb'), 'timeline');
			handler(this.$$('#region_list_tb'), 'region_list');
		},

		_getCredentials: function() {
			const username = this.$$('#creds_username_tb').value;
			const password = this.$$('#creds_password_tb').value;
			if (username || password) {
				return {
					username: username,
					password: password,
				};
			} else {
				return null;
			}
		},

		_storeRadioButtons: function(radioButtonFunc) {
			radioButtonFunc.bind(this)(function(name) {
				try {
					localStorage.setItem(this.localStoragePrefix + "_radioButton_" + name, this.$$('input[name=' + name + ']:checked').value);
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_loadStoredRadioButtons: function(radioButtonFunc) {
			radioButtonFunc.bind(this)(function(name) {
				try {
					const button = localStorage.getItem(this.localStoragePrefix + "_radioButton_" + name);
					if (button) {
						$(this.$$('input[name=' + name + '][value=' + button + ']')).attr("checked", "checked");
					}
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_radioButtonFunc: function(handler) {
			handler('input_radio');
			handler('mode_radio');
			handler('remote_logging_radio');
		},

		_storeCheckBoxes: function(checkBoxFunc) {
			checkBoxFunc.bind(this)(function(name) {
				try {
					localStorage.setItem(this.localStoragePrefix + "_checkBox_" + name, this.$$('#' + name + ':checked') ? "checked" : "unchecked");
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_loadStoredCheckBoxes: function(checkBoxFunc) {
			checkBoxFunc.bind(this)(function(name) {
				try {
					const value = localStorage.getItem(this.localStoragePrefix + "_checkBox_" + name);
					if (value != null) {
						$(this.$$('#' + name)).prop("checked", value === "checked");
					}
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_checkBoxFunc: function(handler) {
			handler('long_form_console_log_cb');
			handler('dev_logging_cb');
			handler('user_error_ui_cb');
			handler('wallclock_sync_cb');
			handler('adv_debug_mode_cb');
			handler('media_player_full_logging_cb');
			handler('promise_rejection_tracking_cb');
			handler('component_url_transforms_cb');
			handler('percent_coords_cb');
			handler('input_doc_adv_mode_cb');
			handler('input_doc_remember_settings_cb');
			handler('override_clock_cb');
			handler('override_clock_start_enabled');
			handler('override_clock_paused');
			handler('remote_control_override_clock_cb');
			handler('wallclock_sync_cb');
		},

		_storeTextBoxes: function(textBoxFunc) {
			textBoxFunc.bind(this)(function(name) {
				try {
					localStorage.setItem(this.localStoragePrefix + "_textBox_" + name, this.$$('#' + name).value);
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_loadStoredTextBoxes: function(textBoxFunc) {
			textBoxFunc.bind(this)(function(name, defaultValue) {
				try {
					this.$$('#' + name).value = localStorage.getItem(this.localStoragePrefix + "_textBox_" + name) || (defaultValue != null ? defaultValue : '');
				} catch(e) {
					/* swallow */
				}
			}.bind(this));
		},

		_textBoxFunc: function(handler) {
			handler('inter_context_sync_tb');
			handler('remote_net_session_sync_tb');
			handler('component_url_transforms_tb');
			handler('network_logging_source_postfix_tb');
			handler('input_doc_tb');
			handler('override_clock_start', 0);
		},

		_urlFixup: function(obj) {
			if (!obj) return obj;
			const output = {};
			for (let prop in obj) {
				let name = obj[prop];
				if (name && typeof name === "string") {
					if (name.substr(0, 2) === '//') {
						output[prop] = this.dMAppController.getBaseUrlProtocol() + name;
						continue;
					}
				}
				output[prop] = name;
			}
			return output;
		},

		_applyComponentUrlTransformStr: function(controller, str) {
			const componentUrlTransforms = [];
			const componentTypeNameTransforms = [];
			const lines = str.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const str = lines[i];
				if (!str || str.startsWith("#")) continue;
				const pat_res = /^r\|([^|]*)\|([^|]*)$/.exec(str);
				if (pat_res) {
					componentUrlTransforms.push(function(url) {
						return url.replace(pat_res[1], pat_res[2]);
					});
					continue;
				}
				const t_pat_res = /^t\|([^|]*)\|([^|]*)$/.exec(str);
				if (t_pat_res) {
					componentTypeNameTransforms.push(function(typeName) {
						return typeName.replace(t_pat_res[1], t_pat_res[2]);
					});
					continue;
				}
				/* globals console */
				console.warn("Component URL transforms: can't parse: " + str);
			}
			controller.layout._componentUrlTransforms.push.apply(controller.layout._componentUrlTransforms, componentUrlTransforms);
			controller.layout._componentTypeNameTransforms.push.apply(controller.layout._componentTypeNameTransforms, componentTypeNameTransforms);
		},

		_getCommonControllerParams: function() {
			const touchMode = this.$$('input[name=touch_radio]:checked').value;
			let touchInteraction;
			if (touchMode === "yes") touchInteraction = true;
			if (touchMode === "no") touchInteraction = false;

			const networkLogMode = this.$$('input[name=remote_logging_radio]:checked').value;
			let networkLogLevel = null;
			if (networkLogMode === "warn") networkLogLevel = DMAppClientLib.Logger.levels.WARN;
			if (networkLogMode === "all") networkLogLevel = DMAppClientLib.Logger.levels.TRACE;

			let timelineMasterOverride;
			if (this.$$('#override_clock_cb:checked')) {
				timelineMasterOverride = {
					pos: parseFloat($(this.$$('#override_clock_start')).val()),
					rate: this.$$('#override_clock_paused:checked') ? 0 : 1,
					enabled: !!this.$$('#override_clock_start_enabled:checked'),
				};
			}

			return {
				failurePlaceholders: !!this.$$('#failure_placeholder_cb:checked'),
				makeNewDeviceId: !!this.$$('#make_new_device_id_cb:checked'),
				deviceIdNamespaceGroup: this.$$('#device_id_namespace_group_tb').value || null,
				touchInteraction: touchInteraction,
				longFormConsoleLogging: !!this.$$('#long_form_console_log_cb:checked'),
				networkLogLevel: networkLogLevel,
				devLogging: !!this.$$('#dev_logging_cb:checked'),
				showUserErrorMessageUI: !!this.$$('#user_error_ui_cb:checked'),
				displayWidth: this.$$('#width_override_tb').value || null,
				displayHeight: this.$$('#height_override_tb').value || null,
				displayResolution: this.$$('#dpi_override_tb').value || null,
				advDebugMode: !!this.$$('#adv_debug_mode_cb:checked'),
				mediaPlayerFullLogging: !!this.$$('#media_player_full_logging_cb:checked'),
				promiseRejectionTracking: !!this.$$('#promise_rejection_tracking_cb:checked'),
				componentUrlTransformStr: this.$$('#component_url_transforms_cb:checked') ? this.$$('#component_url_transforms_tb').value : null,
				timelineMasterOverride: timelineMasterOverride,
				remoteControlTimelineMasterOverride: this.$$('#remote_control_override_clock_cb:checked'),
				wallclockServiceRemoteClockSync: !!this.$$('#wallclock_sync_cb:checked'),
				networkLogSourcePostfix: this.$$('#network_logging_source_postfix_tb').value || null,
				debugComp: !!this.$$('#debug_comp_cb:checked'),
			};
		},

		_commonSetupControllerFromConfig: function(controller, config) {
			if (config.devLogging) controller.enableDevDialogLogging();

			if (config.timelineMasterOverride) {
				DMAppClientLib.DebugMiscUtil.setupTimelineMasterOverrideDebugUtil(controller, (typeof config.timelineMasterOverride === "object") ? config.timelineMasterOverride : null);
			}

			if (config.remoteControlTimelineMasterOverride) {
				DMAppClientLib.DebugMiscUtil.setupRemoteControlTimelineMasterOverrideDebugUtil(controller, config.remoteControlTimelineMasterOverride);
			}

			if (config.failurePlaceholders) {
				controller.layout.failedComponentPlaceholderMode = true;
			}

			if (config.mediaPlayerFullLogging) {
				controller.setSignalByName("l/media-player-component-default-logging-mode", true);
			}

			if (config.promiseRejectionTracking) {
				DMAppClientLib.deps.promise_rejection_tracking.enable({ allRejections: true });
			}

			if (config.componentUrlTransformStr) {
				this._applyComponentUrlTransformStr(controller, config.componentUrlTransformStr);
			}

			if (config.wallclockServiceRemoteClockSync) {
				controller.timeline.wallclockServiceRemoteClockSyncEnableRefCount.increment();
			}
		},

		_mapCommonControllerConfigToOptions: function(config) {
			return {
				makeNewDeviceId: config.makeNewDeviceId,
				deviceIdNamespaceGroup: config.deviceIdNamespaceGroup,
				touchInteraction: config.touchInteraction,
				displayWidth: config.displayWidth ? parseFloat(config.displayWidth) : null,
				displayHeight: config.displayHeight ? parseFloat(config.displayHeight) : null,
				displayResolution: config.displayResolution ? parseFloat(config.displayResolution) : null,
				longFormConsoleLogging: config.longFormConsoleLogging,
				networkLogLevel: config.networkLogLevel,
				advDebugMode: !!config.advDebugMode,
				showUserErrorMessageUI: !!config.showUserErrorMessageUI,
				serviceAjaxCredentials: config.serviceAjaxCredentials,
				networkLogSourcePostfix: config.networkLogSourcePostfix,
				remoteNetSyncConfig: config.remoteNetSyncConfig,
			};
		},

		_parseRegionList: function(region_list) {
			return region_list.split(',').map(function(val) {
				return val.trim();
			});
		},

		_initTest: function() {
			const serviceInputStr = this.$$('input[name=input_radio]:checked').value;
			let serviceInput;
			if (serviceInputStr === "custom") {
				serviceInput = this._urlFixup(this._getAndStoreUrls(this._serviceInputUrlFunc));
			} else {
				serviceInput = this._urlFixup(serviceInputs[serviceInputStr || "none"]);
			}
			if (serviceInput.region_list) {
				serviceInput.regions = this._parseRegionList(serviceInput.region_list);
			}
			if (serviceInput) serviceInput.contextRejoinMode = this.$$('input[name=context_radio]:checked').value;
			const mode = this.$$('input[name=mode_radio]:checked').value;

			this._initTestConfig($.extend(this._getCommonControllerParams(), {
				deviceIdPrefix: "test_" + mode,
				deviceIdNamespace: "test_" + mode,
				mode: mode,
				urls: this._getAndStoreUrls(this._serviceUrlFunc),
				componentFailTest: !!this.$$('#component_fail_test_cb:checked'),
				serviceInput: serviceInput,
				joinInterContextSyncGroup: this.$$('#inter_context_sync_tb').value,
				percentCoordsMode: !!this.$$('#percent_coords_cb:checked'),
				serviceAjaxCredentials: this._getCredentials(),
			}));
			this._storeRadioButtons(this._radioButtonFunc);
			this._storeCheckBoxes(this._checkBoxFunc);
			this._storeTextBoxes(this._textBoxFunc);
		},

		_initTestConfig: function(config) {
			DMAppClientLib.InputUtil.checkStringInList(config.mode, ['tv', 'companion', 'standalone', 'standalone_ns'], false);
			if (config.serviceInput) DMAppClientLib.InputUtil.checkStringInList(config.serviceInput.contextRejoinMode, ['rejoin', 'nocheck', 'destroy'], true);

			this.config = config;
			let deviceType;
			if (config.mode === "tv" || config.mode === "companion") {
				deviceType = config.mode;
			} else if (config.mode === "standalone") {
				deviceType = "tv";
			}
			const controller = new DMAppClientLib.DMAppController($.extend(this._mapCommonControllerConfigToOptions(config), {
				defaultLogLevel: DMAppClientLib.Logger.levels.TRACE,
				deviceIdPrefix: config.deviceIdPrefix,
				deviceIdNamespace: config.deviceIdNamespace,
				deviceType: deviceType,
				communalDevice: (deviceType === "tv"),
			}));

			this._commonSetupControllerFromConfig(controller, config);

			if (config.percentCoordsMode) controller.layout.newContextPercentCoords = true;

			if (config.urls) {
				controller.setUrls(config.urls);
			}

			const items = {};

			if (config.debugComp) {
				const debugElement = controller.layout.createDMAppComponent("debug", "DMAppDebugDisplayComponent");
				debugElement.layoutIndependent = true;
				debugElement.noElementDomAttachmentCtl = true;
				debugElement.style.maxHeight = "400px";
				debugElement.style.margin = "10px";
				debugElement.style.boxSizing = "border-box";
				document.body.appendChild(debugElement.getComponentElement());
				items.debugElement = debugElement;
			}

			const serviceInput = config.serviceInput;

			if (serviceInput.regions) {
				const regions = {};
				const region_list = [];
				const tab_bar = $('<div style="position: relative; z-index: 100; box-sizing: border-box; border: 3px solid blue;"></div>');
				$(document.body).append(tab_bar);
				const add_button = function(name) {
					const button = $('<button></button>');
					button.text(name);
					button.click(function() {
						for (let prop in regions) {
							regions[prop].style.display = ((prop === name) ? "block" : "none");
						}
					});
					tab_bar.append(button);
				};
				add_button('None');
				for (let i = 0; i < serviceInput.regions.length; i++) {
					const region = $('<div style="position: absolute; z-index: 10; box-sizing: border-box; width: 50%; height: 50%; display: none"></div>');
					region[0].style.border = '3px solid #'+(0x1000000+(Math.random())*0xffffff).toString(16).substr(1,6);
					$(document.body).append(region);
					regions[serviceInput.regions[i]] = region[0];
					add_button(serviceInput.regions[i]);
					region_list.push({
						id: serviceInput.regions[i],
						width: Math.floor(region.width()),
						height: Math.floor(region.height()),
						resizable: false,
						element: region[0],
					});
				}
				const main_region = $('<div style="position: absolute; box-sizing: border-box; left: 0px; right: 0px; bottom: 0px; border: 3px solid black;"></div>');
				main_region.css("top", tab_bar.offset().top + tab_bar.outerHeight());
				$(document.body).append(main_region);
				controller.layout.layoutRegionCtl.setRootLayoutRegionElement(main_region[0]);
				controller.layout.layoutRegionCtl.addLayoutRegions.apply(controller.layout.layoutRegionCtl, region_list);
			}

			if (config.mode === "standalone") {
				this._setupContext(controller, serviceInput);
			} else if (config.mode === "standalone_ns") {
				// Do nothing
				controller.timeline.setupStickyDefaultClock();
			} else if (config.mode === "tv") {
				items.tvemusync = new DMAppTvEmuLib.DMAppTvEmuSync(controller);
				const tvemucontroller = new DMAppTvEmuLib.DMAppTvEmuController(controller);
				tvemucontroller.startApp2App();
				this._setupContext(controller, serviceInput, config);
			} else if (config.mode === "companion") {
				const compcontroller = new DMAppCompLib.DMAppComp(controller, {
					useApp2AppSync: true,
				});
				compcontroller.setupCompanionPlatformSpecificDiscovery({ joinFirst: true });
			} else {
				this.logger.throwError("Unexpected mode: " + config.mode);
			}

			if (config.componentFailTest) {
				const s = {
					"width": 380,
					"height": 180,
				};
				const components = [
					{
						"componentId": "f1",
						"config": {
							"url": "",
							"class": "BadType1",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 10,
								"y": 10,
							},
						},
					},
					{
						"componentId": "f2",
						"config": {
							"url": "",
							"class": "bad-type-2",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 410,
								"y": 10,
							},
						},
					},
					{
						"componentId": "ok1",
						"config": {
							"url": "",
							"class": "dmapp-debug-text-id-component",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 810,
								"y": 10,
							},
						},
					},
					{
						"componentId": "f3",
						"config": {
							"url": "http://0.0.0.0:0/",
							"class": "BadType3",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 10,
								"y": 210,
							},
						},
					},
					{
						"componentId": "f4",
						"config": {
							"url": "http://0.0.0.0:0/",
							"class": "bad-type-4",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 410,
								"y": 210,
							},
						},
					},
					{
						"componentId": "f5",
						"config": {
							"url": "http://0.0.0.0:0/",
							"class": "dmapp-debug-text-id-component",
						},
						"startTime": 0,
						"stopTime": null,
						"layout": {
							"size": s,
							"position": {
								"x": 810,
								"y": 210,
							},
						},
					},
				];
				controller.layout._resetLayoutComponents(components, Infinity).map(function(cr) {
					cr.setLayoutIndependent();
				});
			}

			if (config.joinInterContextSyncGroup && deviceType !== "companion") {
				controller.timeline.setInterContextSyncId(config.joinInterContextSyncGroup);
			}

			this._selfDestruct();
		},

		_setupContext: function(controller, serviceInput) {
			controller.layout.io.setupContextAndDmapp(serviceInput.timeline, serviceInput.layout, serviceInput.contextRejoinMode);
			controller.timeline.setupStickyDefaultClock();
		},

		_checkSystemTime: function() {
			const self = this;
			const block = self.$$("#time_warning");
			const now_span = self.$$("#time_warning_now");
			const check = function() {
				const now = new Date();
				if (now.getFullYear() < 2000) {
					block.style.display = "block";
					now_span.textContent = now.toString();
					window.setTimeout(check, 500);
				} else {
					block.style.display = "none";
				}
			};
			check();
		},

		behaviors: [ DMAppClientLib.DMAppComponentBehaviour ],

	});

})();
