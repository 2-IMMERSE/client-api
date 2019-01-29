/************************************************************************/
/* FILE:                ClockSyncUtil.js                                */
/* DESCRIPTION:         Utilities for clock sync                        */
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

const dvbcssClocks = require('dvbcss-clocks/src/main');

/**
 * Utilities for clock sync
 *
 * @namespace ClockSyncUtil
 */
/**
 * Correlated clock update message object type.
 *
 * The `subtype` field may only take the values listed in the table below.
 *
 * | `subtype` field  | Description                                              |
 * | ---------------- | -------------------------------------------------------- |
 * | available        | A notification that the clock has become available       |
 * | unavailable      | A notification that the clock has become unavailable     |
 * | change           | A timestamp update indicating a notifiable change        |
 * | update           | A regular timestamp update                               |
 *
 * Message subtypes: *available*, *change*, *update*, have the `speed` and `time` fields.
 * Message subtype: *unavailable*, does not have the `speed` and `time` fields.
 *
 * @typedef {object} ClockSyncUtil.CorrelatedClockUpdateMessage
 * @property {!string} subtype Message subtype, see table above. Mandatory field.
 * @property {number} speed Normal speed = 1, paused = 0, other values are permitted. Relative units.
 * @property {number} time Clock timestamp. Units of seconds (s).
 */
/**
 * Correlated clock update message handler method type
 *
 * @callback ClockSyncUtil.CorrelatedClockUpdateMessageHandler
 * @param {!ClockSyncUtil.CorrelatedClockUpdateMessage} message Clock update message
 */
/**
 * Return a closure which updates a correlated clock from a clock update message object using a thresholded exponentially-weighted moving average.
 *
 * @memberof ClockSyncUtil
 *
 * @param {!CorrelatedClock} clock Correlated clock to update
 * @param {Object=} options Optional options object
 * @param {number=} [options.threshold=0.1] Optional threshold for changing the clock. Units of seconds (s).
 * @param {number=} [options.ewmaWeighting=0.15] Optional exponentially weighted moving average weight factor
 * @param {number=} [options.minRunningCount=3] Optional minimum number of update subtype messages to receive before applying an incremental clock update
 * @param {Logger=} options.logger Optional logger to use for logging clock correlation changes
 * @param {boolean=} [options.logNoChangeEvents=false] Optional whether to log update events that do not result in a clock update
 * @returns {!ClockSyncUtil.CorrelatedClockUpdateMessageHandler} A closure which handles clock update message objects
 */
function makeCorrelatedClockUpdateMessageHandler(clock, options) {
	if (!options) options = {};
	const threshold = (options.threshold != null) ? options.threshold : 0.1;
	const ewmaWeighting = (options.ewmaWeighting != null) ? options.ewmaWeighting : 0.15;
	const minRunningCount = (options.minRunningCount != null) ? options.minRunningCount : 3;
	const logger = options.logger || null;
	const logNoChangeEvents = !!options.logNoChangeEvents;
	let runningChange = null;
	let runningCount = 0;

	return function(msg) {
		const srcClock = clock.getParent();

		if (msg.subtype == "unavailable") {
			clock.availabilityFlag = false;
			return;
		}

		let correlation = new dvbcssClocks.Correlation(srcClock.now(), msg.time * srcClock.getTickRate());
		const change = clock.quantifySignedChange(correlation, msg.speed);
		if (msg.subtype == "update" && isFinite(change)) {
			if (runningChange == null) {
				runningChange = change;
				runningCount = 1;
			} else {
				runningChange = (runningChange * (1 - ewmaWeighting)) + (ewmaWeighting * change);
				runningCount++;
			}
			if (Math.abs(runningChange) < threshold || runningCount < minRunningCount) {
				if (logger && logNoChangeEvents) logger.debug("Clock update within threshold: change: ", change * 1000, "ms, ewma: ", runningChange * 1000 ,"ms, ignoring");
				return;
			}
			correlation = correlation.butWith({ childTime: (msg.time + change - runningChange) * srcClock.getTickRate()});
			if (logger) logger.debug("Applying clock update, change: ", change * 1000, "ms, ewma: ", runningChange * 1000 , "ms, type:", msg.subtype);
		} else {
			if (logger) logger.debug("Applying clock update, change: ", change * 1000, "ms, type:", msg.subtype);
		}

		clock.setCorrelationAndSpeed(correlation, msg.speed);
		runningChange = null;
		runningCount = 0;

		if (msg.subtype == "available") {
			clock.availabilityFlag = true;
		}
	};
}

module.exports = {
	makeCorrelatedClockUpdateMessageHandler: makeCorrelatedClockUpdateMessageHandler,
};
