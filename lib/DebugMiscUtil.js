/************************************************************************/
/* FILE:                DebugMiscUtil.js                                */
/* DESCRIPTION:         Debug misc util                                 */
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

const MiscUtil = require('./MiscUtil');
const deepEql = require('deep-eql');

/**
 * Debug misc utilities
 *
 * @namespace DebugMiscUtil
 */

const dvbcssClocks = require('dvbcss-clocks/src/main');
const $ = require("jquery");

const waitable = require('./waitable');
const UpdateUtil = require('./UpdateUtil');

function makeObjectNonexistentPropertyTrapProxy(obj, logger, name, whitelist) {
	const wl = whitelist ? whitelist.slice() : [];
	if (typeof Proxy === 'undefined') return obj;
	return new Proxy(obj, {
		get: function(target, key) {
			if (!(key in target || wl.indexOf(key) !== -1)) {
				logger.warn("Attempted to access nonexistent property: '" + String(key) + "' on object: '" + (name || target.toString()) + "'");
			}
			return target[key];
		}
	});
}

const setupTimelineMasterOverrideDebugUtilMap = new WeakMap();

function setupTimelineMasterOverrideDebugUtil(controller, config) {
	if (setupTimelineMasterOverrideDebugUtilMap.has(controller)) return;

	setupTimelineMasterOverrideDebugUtilMap.set(controller, true);

	const clock = new dvbcssClocks.CorrelatedClock();

	if (!config || typeof config !== "object") config = {
		enabled: true,
		rate: 1,
		pos: (controller.initStickyDefaultClockWallclockRelative != null) ? controller.timeline._getStickyDefaultClockInitialValue() : 0,
	};

	const set_clock = function(rate, pos) {
		controller.timeline.setCorrelatedClockParent(controller.timeline.monotonicClock, clock,
				controller.timeline.monotonicClock.now() / controller.timeline.monotonicClock.getTickRate(), pos, rate);
	};
	set_clock(config.rate, config.pos);

	let enabled = config.enabled;
	const enable_ctl = function() {
		if (enabled) {
			controller.timeline.setDefaultClockSource(clock, {
				isMaster: true,
				sourceName: "Test Component: Timeline Master Override Option",
				priorityGroup: 10,
				masterOverride: true,
			});
		} else {
			controller.timeline.unsetDefaultClockSource(clock);
		}
	};
	enable_ctl();

	const bar = $('<div style="position: absolute; box-sizing: border-box; color: white; background-color: black; border: 3px solid green; bottom: 0px; left: 0px; z-index: 7000"></div>');
	const status = $('<span style="margin-left: 5em"></span>');
	const enable_label = $('<label style="margin-right: 5em"><input type="checkbox" />Enabled</label>');
	const enable_cb = enable_label.find("input");
	enable_cb.prop("checked", !!enabled);
	const play_btn = $('<button>Play</button>');
	const pause_btn = $('<button>Pause</button>');
	const sync_btn = $('<button>Sync</button>');
	const num_input = $('<input id="_setupTimelineMasterOverrideDebugUtil_num" type="text" style="margin-left: 5em" pattern="(\\d+:)?(\\d+:)?\\d+(\\.\\d*)?" />');
	const seek_btn = $('<button>Seek</button>');
	bar.append(enable_label, play_btn, pause_btn, sync_btn, num_input, seek_btn, status);

	$(document.head).append('<style>#_setupTimelineMasterOverrideDebugUtil_num:invalid { outline: 2px solid red; outline-offset -2px; }</style>');

	const set_state = function() {
		const paused = clock.getSpeed() === 0;
		const now = clock.now() / clock.getTickRate();
		const text = (paused ? "Paused" : "Playing") + ": " + now + " s, " + controller.timeline.formatHMS(now);
		if (enabled) {
			status.text(text);
		} else {
			status.text("Disabled: (" + text + ")");
		}
		play_btn.attr("disabled", !paused || !enabled);
		pause_btn.attr("disabled", paused || !enabled);
		seek_btn.attr("disabled", !enabled);
		sync_btn.attr("disabled", enabled);
	};
	set_state();
	window.setInterval(set_state, 500);

	const parseNum = function(v) {
		if (typeof v === "string") {
			const match = v.match(/^(-?)(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d*)?)$/);
			if (match) {
				let num = Number(match[4]);
				if (match[3]) num += 60 * Number(match[3]);
				if (match[2]) num += 3600 * Number(match[2]);
				if (match[1]) num = -num;
				return num;
			}
		}
		return NaN;
	};

	play_btn.click(function() {
		set_clock(1, clock.now() / clock.getTickRate());
		set_state();
	});
	pause_btn.click(function() {
		set_clock(0, clock.now() / clock.getTickRate());
		set_state();
	});
	seek_btn.click(function() {
		const t = parseNum(num_input.val());
		if (Number.isFinite(t)) {
			set_clock(clock.getSpeed(), t);
			set_state();
		}
	});
	sync_btn.click(function() {
		const defaultClock = controller.timeline.defaultClock;
		if (defaultClock.isAvailable()) {
			set_clock(defaultClock.getEffectiveSpeed(), defaultClock.now() / defaultClock.getTickRate());
			set_state();
		}
	});
	enable_cb.on("change", function() {
		enabled = enable_cb.prop("checked");
		enable_ctl();
		set_state();
	});

	$(document.body).append(bar);
}

function setupRemoteControlTimelineMasterOverrideDebugUtil(controller, config) {
	const clock = new dvbcssClocks.CorrelatedClock();

	const set_clock = function(rate, pos) {
		controller.timeline.setCorrelatedClockParent(controller.timeline.monotonicClock, clock,
				controller.timeline.monotonicClock.now() / controller.timeline.monotonicClock.getTickRate(), pos, rate);
	};
	set_clock(1, (controller.initStickyDefaultClockWallclockRelative != null) ? controller.timeline._getStickyDefaultClockInitialValue() : 0);

	controller.timeline.setDefaultClockSource(clock, {
		isMaster: true,
		sourceName: "Test Component: Remote Control Timeline Master Override Option",
		priorityGroup: 9,
		masterOverride: true,
		zeroUpdateThreshold: true,
	});

	let url = controller._getUrl('websocketService');
	if (!url) return null;
	if (url.slice(-1) != '/') url += '/';
	url += "bus";

	const sock = MiscUtil.makeSocketIOClient(url);

	const join = function() {
		sock.emit('JOIN', JSON.stringify({
			room: "remote-control-clock-" + controller.layout.contextId,
			name: controller.getDeviceId() + ': setupRemoteControlTimelineMasterOverrideDebugUtil',
		}));
	};

	const connect = function() {
		if (controller.layout.contextId) {
			join();
		}
		controller.layout.on('contextChange', function(info) {
			if (info.previousContextId) {
				sock.emit('LEAVE', JSON.stringify({
					room: "remote-control-clock-" + info.previousContextId,
				}));
			}
			if (info.newContextId) {
				join();
			}
		});
	};

	if (sock.connected) {
		connect();
	} else {
		sock.on('connect', connect);
	}

	const processMessage = function(message) {
		controller.logger.info("Remote Control Timeline Master Override Event: ", message);
		const paused = (message.paused != null) ? message.paused : ((message.playing != null) ? !message.playing : (clock.getSpeed() === 0));
		let position = (message.position != null) ? message.position : (clock.now() / clock.getTickRate());
		if (message.adjust) position += message.adjust;
		set_clock(paused ? 0 : 1, position);
		if (message.mute != null) controller.muteAll.setValue(message.mute);
		controller.emit("_remoteControlTimelineMasterOverrideEvent", message);
	};

	if (config && typeof config === "object") processMessage(config);

	sock.on('EVENT', function(data) {
		processMessage(data.message);
	});
}

function presenceOk(presence) {
	return presence === "online" || presence === "connected";
}

function App2AppMsgBusSharedStateReceiverCtl(controller, group, key) {
	const logger = controller.createNamedLogger("App2AppMsgBusSharedStateReceiverCtl");
	logger.info("Joining group: " + group + ", key: " + JSON.stringify(key));
	Object.defineProperties(this, {
		controller:             { value: controller },
		sharedStatePromise:     { value: controller.createSharedStateFromGroupMapping(group, { parentLogger: logger }) },
		seenMessageIds:         { value: new Set() },
		logger:                 { value: logger },
	});
	const seenMessageIds = this.seenMessageIds;
	UpdateUtil.makeSharedStateUpdateWhenReadyClosure(this.sharedStatePromise, function(sharedState) {
		sharedState.on("change", function(info) {
			if (info.key.startsWith("cmd\u00A7")) {
				const msgId = info.key.slice(4);
				if (info.value == null || typeof info.value != "object" || seenMessageIds.has(msgId)) {
					sharedState.removeItem(info.key);
					return;
				}
				const agentId = info.value.agent;
				if (!agentId || !presenceOk(sharedState.getPresence(agentId))) {
					sharedState.removeItem(info.key);
					return;
				}
				if (info.value.key !== key) {
					logger.info("Ignoring cmd with wrong key to: ", msgId, ", key: ", JSON.stringify(info.value.key));
					return;
				}

				const respond = function(type, data) {
					logger.info("Sending cmd response to: ", msgId, ", type: ", type, ", data: ", data);
					sharedState.setItem("res\u00A7" + msgId, {
						agent: sharedState.agentid,
						type: type,
						data: data,
					});
				};

				seenMessageIds.add(msgId);
				logger.info("Got cmd ID: ", msgId, ", msg: ", info.value.msgBody, ", to: ", info.value.toDeviceId, ", ", info.value.toComponentId, ", from: ", info.value.fromComponentId);
				controller.app2appMsgBusCtl.send(info.value.msgBody, info.value.toDeviceId || '@self', info.value.toComponentId, info.value.fromComponentId || ('App2AppMsgBusSharedStateReceiverCtl: ' + group + ', ' + key)).then(function(ack) {
					respond("ACK", ack);
				}, function(nack) {
					if (nack instanceof Error) {
						respond("NACK", nack.toString());
					} else {
						respond("NACK", nack);
					}
				});
			}
			if (info.key.startsWith("res\u00A7")) {
				if (info.value == null || typeof info.value != "object") {
					sharedState.removeItem(info.key);
					return;
				}
				const agentId = info.value.agent;
				if (!agentId || !presenceOk(sharedState.getPresence(agentId))) {
					sharedState.removeItem(info.key);
					return;
				}
			}
		});
	})();
}

App2AppMsgBusSharedStateReceiverCtl.prototype.destroy = function() {
	this.sharedStatePromise.then(function(sharedState) {
		sharedState.destroy();
	});
};

let sendApp2AppMsgBusSharedStateCmdLogNum = 0;
function sendApp2AppMsgBusSharedStateCmd(controller, group, key, msgBody, toDeviceId, toComponentId, fromComponentId) {
	const logger = controller.createNamedLogger("sendApp2AppMsgBusSharedStateCmd#" + (sendApp2AppMsgBusSharedStateCmdLogNum++));
	const ret = new waitable();
	controller.createSharedStateFromGroupMapping(group, { parentLogger: logger, cached: true, returnObject: true }).then(function(info) {
		ret.finally(function() {
			info.unref();
		});
		UpdateUtil.makeSharedStateUpdateWhenReadyClosure(info.sharedState, function(sharedState) {
			try {
				const msgId = "SSAMID-" + controller.generateRandomIdString(20);
				sharedState.setItem("cmd\u00A7" + msgId, {
					agent: sharedState.agentid,
					key: key,
					msgBody: msgBody,
					toDeviceId: toDeviceId,
					toComponentId: toComponentId,
					fromComponentId: fromComponentId,
				});
				const handler = function(info) {
					if (info.key === "res\u00A7" + msgId) {
						if (info.value == null || typeof info.value != "object") {
							logger.warn("Reply to: " + msgId + ", in unexpected format (1), ignoring");
							sharedState.removeItem(info.key);
							return;
						}

						if (info.value.type === "ACK") {
							ret.signal(info.value.data);
						} else if (info.value.type === "NACK") {
							ret.abort(info.value.data);
						} else {
							logger.warn("Reply to: " + msgId + ", in unexpected format (2), ignoring");
						}

						sharedState.removeItem(info.key);
					}
				};
				sharedState.on("change", handler);
				ret.finally(function() {
					sharedState.off("change", handler);
				});
			} catch (e) {
				return ret.abort({
					deviceId: controller.getDeviceId(),
					type: "exception",
					msg: "sendApp2AppMsgBusSharedStateCmd() threw exception whilst sending command: " + e,
				});
			}
		})();
	}, function() {
		ret.abort({
			deviceId: controller.getDeviceId(),
			type: "shared_state_error",
			msg: "Failed to setup shared state group: " + group,
		});
	});
	window.setTimeout(function() {
		ret.abort({
			deviceId: controller.getDeviceId(),
			type: "timeout",
			msg: "Failed to get response within timeout (sendApp2AppMsgBusSharedStateCmd)",
		});
	}, 45000);
	return ret;
}

/**
 * Debug dumper interface
 *
 * @memberof DebugMiscUtil
 * @interface DebugDumper
 */
/**
 * Create dumper subcategory
 *
 * @method DebugMiscUtil.DebugDumper#subcategory
 * @param {string} name Subcategory name
 * @param {boolean} [shown=true] Show subcategory (in UI) by default
 * @return {DebugMiscUtil.DebugDumper} Dumper for subcategory
 */
/**
 * Dump key value pair
 *
 * @method DebugMiscUtil.DebugDumper#keyValue
 * @param {string} k Key
 * @param v Arbitrary value
 */
/**
 * Dump value
 *
 * @method DebugMiscUtil.DebugDumper#value
 * @param v Arbitrary value
 */
/**
 * Dump and control boolean signal as a checkbox option
 *
 * @method DebugMiscUtil.DebugDumper#checkboxOption
 * @param {string} label Option label
 * @param {Signal.SettableSignal} signal Signal of boolean value to get/set
 */
/**
 * Item type for {@link DebugMiscUtil.DebugDumper#multiChoiceOption}
 *
 * @typedef DebugMiscUtil.DebugDumper~MultiChoiceOptionItem
 * @prop {string} name Name
 * @prop value Arbitrary value
 */
/**
 * Dump and control signal as a multi-choice option
 *
 * @method DebugMiscUtil.DebugDumper#multiChoiceOption
 * @param {string} label Option label
 * @param {Signal.SettableSignal} signal Signal of value to get/set
 * @param {DebugMiscUtil.DebugDumper~MultiChoiceOptionItem[]} choiceList List of choices
 */
/**
 * Dump callback function as a button
 *
 * @method DebugMiscUtil.DebugDumper#button
 * @param {string} label Option label
 * @param {Function} callback Function to call
 */
/**
 * Signal input submission callback
 *
 * @callback DebugMiscUtil.DebugDumper~StringInputCallback
 * @param {string} value String value
 */
/**
 * Item type for {@link DebugMiscUtil.DebugDumper#multiInput}
 *
 * @typedef DebugMiscUtil.DebugDumper~MultiInputItem
 * @prop {!string} type Type, one of: 'string', 'number', 'checkBox', 'multiChoice'
 * @prop {string} label Label
 * @prop initial Optional intial value
 * @prop {DebugMiscUtil.DebugDumper~MultiChoiceOptionItem[]} choiceList For 'multiChoice' type only: List of choices
 */
 /**
 * Multi input submission callback
 *
 * @callback DebugMiscUtil.DebugDumper~MultiInputCallback
 * @param {Array} value Result values
 */
/**
 * Dump string input callback function
 *
 * @method DebugMiscUtil.DebugDumper#stringInput
 * @param {string} label Option label
 * @param {DebugMiscUtil.DebugDumper~StringInputCallback} callback Function to call
 * @param {string=} initial Optional hint initial string value
 * @param {string=} buttonText Optional hint button text
 */
/**
 * Dump multi input callback function
 *
 * @method DebugMiscUtil.DebugDumper#multiInput
 * @param {string} label Label
 * @param {DebugMiscUtil.DebugDumper~MultiInputItem[]} inputList List of inputs
 * @param {DebugMiscUtil.DebugDumper~MultiInputCallback} callback Function to call
 * @param {string=} buttonText Hint button text
 */
/**
 * Dump component container
 *
 * @method DebugMiscUtil.DebugDumper#componentContainer
 * @param {ComponentContainer} componentContainer Component container
 * @param {string} label Label
 * @param {boolean} [shown=true] Show subcategory (in UI) by default
 */
/**
 * Dump component
 *
 * @method DebugMiscUtil.DebugDumper#component
 * @param {DMAppComponent} component Component
 * @param {boolean} [shown=true] Show subcategory (in UI) by default
 */

/**
 * Serialisation dumper dynamic item handler interface
 *
 * @interface DebugMiscUtil.SerialisationDumper~Dynhandler
 */
/**
 * Checkbox option handler
 *
 * @method DebugMiscUtil.SerialisationDumper~Dynhandler#checkboxOption
 * @param {Object} info Mutable serialisation result
 * @param {string} info.type Type field: "checkboxOption"
 * @param {string} info.label Label
 * @param {Signal.SettableSignal} signal Signal of boolean value to get/set
 */
/**
 * Multi-choice option handler
 *
 * @method DebugMiscUtil.SerialisationDumper~Dynhandler#multiChoiceOption
 * @param {Object} info Mutable serialisation result
 * @param {string} info.type Type field: "multiChoiceOption"
 * @param {string} info.label Label
 * @param {DebugMiscUtil.DebugDumper~MultiChoiceOptionItem[]} info.choiceList List of choices
 * @param {Signal.SettableSignal} signal Signal of value to get/set
 */
/**
 * Button option handler
 *
 * @method DebugMiscUtil.SerialisationDumper~Dynhandler#button
 * @param {Object} info Mutable serialisation result
 * @param {string} info.type Type field: "button"
 * @param {string} info.label Label
 * @param {Function} callback Function to call
 */
/**
 * String input handler
 *
 * @method DebugMiscUtil.SerialisationDumper~Dynhandler#stringInput
 * @param {Object} info Mutable serialisation result
 * @param {string} info.type Type field: "stringInput"
 * @param {string} info.label Label
 * @param {string=} info.initial Hint initial string value
 * @param {string=} info.buttonText Hint button text
 * @param {DebugMiscUtil.DebugDumper~StringInputCallback} callback Function to call
 */
/**
 * Multi input handler
 *
 * @method DebugMiscUtil.SerialisationDumper~Dynhandler#multiInput
 * @param {Object} info Mutable serialisation result
 * @param {string} info.type Type field: "multiInput"
 * @param {string} info.label Label
 * @param {DebugMiscUtil.DebugDumper~MultiInputItem[]} info.inputList List of inputs
 * @param {string=} info.buttonText Hint button text
 * @param {DebugMiscUtil.DebugDumper~MultiInputCallback} callback Function to call
 */
/**
 * Serialisation dumper
 *
 * @memberof DebugMiscUtil
 * @implements DebugMiscUtil.DebugDumper
 * @constructor
 * @param {!Array} array Output array
 * @param {DebugMiscUtil.SerialisationDumper~Dynhandler=} dynHandler Optional dynamic item handler
 */
function SerialisationDumper(array, dynHandler) {
	this.array = array;
	this.dynHandler = dynHandler;
}

SerialisationDumper.prototype.subcategory = function(name, shown) /* -> DumperHelper */ {
	const subarray = [];
	this.array.push({
		type: "subcategory",
		name: name,
		content: subarray,
		defaultShown: shown,
	});
	return new SerialisationDumper(subarray, this.dynHandler);
};

SerialisationDumper.prototype.keyValue = function(k, v) {
	this.array.push({
		type: "keyValue",
		key: k,
		value: v,
	});
};

SerialisationDumper.prototype.value = function(v) {
	this.array.push({
		type: "value",
		value: v,
	});
};

SerialisationDumper.prototype.checkboxOption = function(label, signal) {
	const info = {
		type: "checkboxOption",
		label: label,
		value: !!signal.getValue(),
	};
	if (this.dynHandler && this.dynHandler.checkboxOption) this.dynHandler.checkboxOption(info, signal);
	this.array.push(info);
};

SerialisationDumper.prototype.multiChoiceOption = function(label, signal, choiceList) {
	const info = {
		type: "multiChoiceOption",
		label: label,
		value: signal.getValue(),
		choiceList: choiceList,
	};
	if (this.dynHandler && this.dynHandler.multiChoiceOption) this.dynHandler.multiChoiceOption(info, signal);
	this.array.push(info);
};

SerialisationDumper.prototype.button = function(label, callback) {
	const info = {
		type: "button",
		label: label,
	};
	if (this.dynHandler && this.dynHandler.button) this.dynHandler.button(info, callback);
	this.array.push(info);
};

SerialisationDumper.prototype.stringInput = function(label, callback, initial, buttonText) {
	const info = {
		type: "stringInput",
		label: label,
		initial: initial,
		buttonText: buttonText,
	};
	if (this.dynHandler && this.dynHandler.stringInput) this.dynHandler.stringInput(info, callback);
	this.array.push(info);
};

SerialisationDumper.prototype.multiInput = function(label, inputList, callback, buttonText) {
	const info = {
		type: "multiInput",
		label: label,
		inputList: inputList,
		buttonText: buttonText,
	};
	if (this.dynHandler && this.dynHandler.multiInput) this.dynHandler.multiInput(info, callback);
	this.array.push(info);
};

SerialisationDumper.prototype.componentContainer = function(componentContainer, label, shown) {
	const cat = this.subcategory(label, shown);
	const components = componentContainer.getComponents();
	for (const id in components) {
		cat.component(components[id], false);
	}
};

SerialisationDumper.prototype.component = function(component, shown) {
	const cdumper = this.subcategory(component.getName(), shown);
	component.dumpDebugInfo(cdumper);
	component.dMAppController.timeline.dumpClockInfo(component.referenceClock, cdumper.subcategory("Component Reference Clock", false), true, false);
	component.dMAppController.timeline.dumpClockInfo(component.componentTimelineClock, cdumper.subcategory("Component Timeline Clock", false), true, false);
};

/**
 * Create app2app callback from name
 *
 * @callback DebugMiscUtil~DynhandlerMakeApp2AppCallback
 *
 * @param {!string} name The implementation may pre/postfix or otherwise transform this as necessary
 * @param {!function} callback Callback to call
 * @return {!string} Fully qualified callback name
 */

/**
 * Signal value change callback
 *
 * Signals are used for checkboxOption and multiChoiceOption dump items
 *
 * @callback DebugMiscUtil~DynhandlerSignalValueUpdateCallback
 *
 * @param {!number} id Signal ID (non-negative integer)
 * @param value New signal value
 */

/**
 * Create serialisation dumper dyn handler which uses app2app callbacks
 *
 * @memberof DebugMiscUtil
 * @param {!DebugMiscUtil~DynhandlerMakeApp2AppCallback} makeCallback Callback creation callback
 * @param {?DebugMiscUtil~DynhandlerSignalValueUpdateCallback} signalChangeCallback Optional signal change callback, signal IDs are included in the dump output iff this is present
 * @param {?ListenerTracker} listenerTracker Optional Listener tracker to subscribe to events on
 * @returns {!DebugMiscUtil.SerialisationDumper~Dynhandler}
 */
function MakeApp2AppCallbackSerialisationDumperDynHandler(makeCallback, signalChangeCallback, listenerTracker) {
	let btnId = 0;
	let chkId = 0;
	let mcoId = 0;
	let siId = 0;
	let miId = 0;
	let signalId = 0;
	return {
		button: function (info, callback) {
			info.cb = makeCallback("btn-" + (btnId++), callback);
		},
		checkboxOption: function (info, signal) {
			info.cb = makeCallback("chkbox-" + (chkId++), function(param) {
				if (typeof param === "boolean") {
					signal.setValue(param);
				} else if (param == null) {
					signal.setValue(!signal.getValue());
				} else {
					throw new Error("Unexpected value type in parameter field");
				}
				return signal.getValue();
			});
			if (signalChangeCallback) {
				const id = (signalId++);
				signal.on("toggle", function() {
					signalChangeCallback(id, !!signal.getValue());
				}, listenerTracker);
				info.signalId = id;
			}
		},
		multiChoiceOption: function (info, signal) {
			info.cb = makeCallback("mco-" + (mcoId++), function(param) {
				if (!param || typeof param !== "object") {
					throw new Error("Parameter field is not an object");
				}
				const check = function(val, prop) {
					for (let i = 0; i < info.choiceList.length; i++) {
						if (deepEql(val, info.choiceList[i][prop])) {
							signal.setValue(info.choiceList[i].value);
							return;
						}
					}
					throw new Error("Value not in list of options");
				};
				if (param.hasOwnProperty("name")) {
					check(param.name, "name");
				} else if (param.hasOwnProperty("value")) {
					check(param.value, "value");
				} else {
					throw new Error("No 'name' or 'value' parameter field");
				}
				return signal.getValue();
			});
			if (signalChangeCallback) {
				const id = (signalId++);
				signal.on("change", function() {
					signalChangeCallback(id, signal.getValue());
				}, listenerTracker);
				info.signalId = id;
			}
		},
		stringInput: function (info, callback) {
			info.cb = makeCallback("si-" + (siId++), function(param) {
				if (typeof param === "string") {
					callback(param);
				} else {
					throw new Error("Unexpected value type in parameter field");
				}
			});
		},
		multiInput: function (info, callback) {
			info.cb = makeCallback("mi-" + (miId++), function(param) {
				if (Array.isArray(param)) {
					callback(param);
				} else {
					throw new Error("Unexpected value type in parameter field");
				}
			});
		},
	};
}

/**
 * Debug dumpable interface
 *
 * @memberof DebugMiscUtil
 * @interface DebugDumpable
 */
/**
 * Register debug dump refresh/change events
 *
 * @method DebugMiscUtil.DebugDumpable#setupComponentDebugEvents
 * @param {ListenerTracker} listenerTracker Listener tracker to subscribe to events on
 * @param {Function} func Callback function to use for event subscriptions
 */
/**
 * Dump debug info
 *
 * @method DebugMiscUtil.DebugDumpable#dumpDebugInfo
 * @param {DebugMiscUtil.DebugDumper} dumper Dumper to dump to
 */

module.exports = {
	makeObjectNonexistentPropertyTrapProxy: makeObjectNonexistentPropertyTrapProxy,
	setupTimelineMasterOverrideDebugUtil: setupTimelineMasterOverrideDebugUtil,
	setupRemoteControlTimelineMasterOverrideDebugUtil: setupRemoteControlTimelineMasterOverrideDebugUtil,
	App2AppMsgBusSharedStateReceiverCtl: App2AppMsgBusSharedStateReceiverCtl,
	sendApp2AppMsgBusSharedStateCmd: sendApp2AppMsgBusSharedStateCmd,
	MakeApp2AppCallbackSerialisationDumperDynHandler: MakeApp2AppCallbackSerialisationDumperDynHandler,
	SerialisationDumper: SerialisationDumper,
};
