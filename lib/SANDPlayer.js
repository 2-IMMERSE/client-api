"use strict";

const ResourceMgmtUtil = require('./ResourceMgmtUtil');
const Logger = require('./Logger');
const SafeEventEmitter = require('./SafeEventEmitter');
const MiscUtil = require('./MiscUtil');
const $ = require('jquery');
const debounce = require('just-debounce');

const SANDPlayer_Collectors = {
	NEVER_COLLECT: 0,
	COLLECT_AT_INTERVAL: 1,
	COLLECT_ON_SEGMENT_DONE: 2,
	COLLECT_ON_STATS_CHANGE: 3,
	COLLECT_ON_STATS_CHANGE_THROTTLED: 4,
	COLLECT_ON_SEGMENT_DONE_THROTTLED: 5
};

const downstreams = new Map();

function getDownStream(controller, dmappId) {
	let downstream = downstreams.get(dmappId);
	if (!downstream) {
		const ws = MiscUtil.makeSocketIOClient(controller.layout.io._getWebsocketUrl());
		downstream = {
			rc: new ResourceMgmtUtil.RefCountedDelayedDestructor(5000, function() {
				downstreams.delete(dmappId);
				ws.close();
			}),
			logger: controller.createNamedLogger("Bandwidth orchestration downstream"),
			ws: ws,
			event: new SafeEventEmitter(),
		};
		downstreams.set(dmappId, downstream);
		ws.on('connect', function() {
			ws.emit('JOIN', JSON.stringify({
				room: 'bandwidth.orchestration.' + dmappId,
				name: controller.getDeviceId(),
			}));
		});
		ws.on('EVENT', function(data) {
			const process = function(actions) {
				for (let prop in actions) {
					if (!downstream.event.listeners(prop, true)) downstream.logger.warn("Unexpected action on: " + prop, actions[prop]);
					downstream.event.emit(prop, actions[prop]);
				}
			};
			if (data.message && data.message.DMAppId && data.message.DMAppId.actions) process(data.message.DMAppId.actions);
			if (data.message && data.message[dmappId] && data.message[dmappId].actions) process(data.message[dmappId].actions);
		});
	}
	downstream.rc.ref();
	return downstream;
}

const SANDPlayer = function(controller, dmAppId, instanceId, dashjs, player, userOption, logger) {

	if (!logger) throw new Error("SANDPlayer: No logger specified");
	if (!controller) this.logger.throwError("SANDPlayer: No controller specified");
	if (!dmAppId) this.logger.throwError("SANDPlayer: No dmAppId specified");
	if (!instanceId) this.logger.throwError("SANDPlayer: No instanceId specified");
	if (!dashjs) this.logger.throwError("SANDPlayer: No dashjs specified");
	if (!player) this.logger.throwError("SANDPlayer: No player specified");

	logger.debug("SANDPlayer: init");

	const destructors = [];

	// defaults
	let options = {
		id: instanceId,
		dmapp: dmAppId,
		monitorInterval: 10000,
		monitorHistory: 20,
		monitorLastInterval: 0,
		collectorUrl: null,
		collectorType: SANDPlayer_Collectors.NEVER_COLLECT,
		collectionInterval: 10000,
	};

	const netLogger = logger.makeChildLogger();
	netLogger.setLevel(Math.min(netLogger.getLevel(), Logger.levels.WARN));

	function averageNullable() {
		let sum = 0;
		let count = 0;
		for (let i = 0; i < arguments.length; i++) {
			if (arguments[i] != null && !Number.isNaN(arguments[i])) {
				sum += arguments[i];
				count++;
			}
		}
		return count ? sum / count : 0;
	}

	// collection interval object
	let reporter;

	// monitor background task
	let monitor;

	// downstream channel
	let downstream;

	// an MPEG DASH SAND message template
	const sandMessage = {
		senderId: options.id,
		dmappId: options.dmapp
	};

	// metric holder
	const metric = {
		averageThroughput: {
			avgVideoThroughput: 0,
			avgAudioThroughput: 0,
			avgThroughput: 0
		},
		bandwidth: {
			video: {
				current: 0,
				history: [],
				average: 0
			},
			audio: {
				current: 0,
				history: [],
				average: 0
			},
			current: 0,
			average: 0
		},
		bitrate: {
			playing: {
				video: 0,
				audio: 0
			},
			queued: {
				video: 0,
				audio: 0
			}
		},
		bitrates: {
			video: [],
			audio: []
		},
		status: "uninitialized"
	};
	let prevMetric = $.extend(true, {}, metric);

	function bandwidthSummaryLine() {
		return "bitrates: [" + metric.bitrates.video.join(", ") + "], current: " + metric.bitrates.video[player.getQualityFor('video')] + ", limit: " + (player.getMaxAllowedBitrateFor("video") * 1000);
	}

	// bandwidth data
	const fragmentRequests = {};
	const fragmentState = {};

	const buildMessage = function() {
		return $.extend(true, {},
			sandMessage,
			metric, {
				generationTime: Date.now()
			});
	};

	// report metrics to collector
	const sendMetric = function() {

		// build message
		const message = buildMessage();

		// send sand message to collector
		controller.ajaxPromiseNX({
			method: "POST",
			url: options.collectorUrl,
			data: JSON.stringify(message),
			contentType: "application/json"
		}).setTitle("Send SAND metrics").setLogger(netLogger).exec().catch(function(info) {
			netLogger.error("failed to send metrics: " + info.status, info);
		});
	};

	// get the current average throughput and send to the collector
	const collectMetrics = function() {
		metric.averageThroughput.avgVideoThroughput = player.getAverageThroughput("video");
		metric.averageThroughput.avgAudioThroughput = player.getAverageThroughput("audio");
		metric.averageThroughput.avgThroughput = averageNullable(metric.averageThroughput.avgVideoThroughput, metric.averageThroughput.avgAudioThroughput);

		if (Number.isNaN(metric.averageThroughput.avgVideoThroughput)) metric.averageThroughput.avgVideoThroughput = 0;
		if (Number.isNaN(metric.averageThroughput.avgAudioThroughput)) metric.averageThroughput.avgAudioThroughput = 0;

		// we make a copy here because this changes while we work!
		// TODO: make sure we actually need to copy ...
		const videoMetrics = $.extend(true, {}, player.getMetricsFor("video"));
		const audioMetrics = $.extend(true, {}, player.getMetricsFor("audio"));
		const dashMetrics = $.extend(true, {}, player.getDashMetrics());

		// current playing bitrate
		metric.bitrate.playing.video = metric.bitrates.video[player.getQualityFor('video')] || 0;
		metric.bitrate.playing.audio = metric.bitrates.audio[player.getQualityFor('audio')] || 0;

		if (!metric.bitrate.playing.video) {
			// don't bother submitting stats for audio-only players as the service doesn't do anything useful with them
			return;
		}

		// current scheduled bitrate
		const videoSchedulingInfo = dashMetrics.getCurrentSchedulingInfo(videoMetrics);
		if (videoSchedulingInfo) {
			const videoQuality = videoSchedulingInfo.quality;
			metric.bitrate.queued.video = isNaN(videoQuality) ? prevMetric.bitrate.queued.video :
				metric.bitrates.video[videoQuality];
		} else {
			metric.bitrate.queued.video = 0;
		}
		const audioSchedulingInfo = dashMetrics.getCurrentSchedulingInfo(audioMetrics);
		if (audioSchedulingInfo) {
			const audioQuality = audioSchedulingInfo.quality;
			metric.bitrate.queued.audio = isNaN(audioQuality) ? prevMetric.bitrate.queued.audio :
				metric.bitrates.audio[audioQuality];
		} else {
			metric.bitrate.queued.audio = 0;
		}

		sendMetric();
	};

	// monitoring function
	const monitorPlayer = function() {
		// now?
		const intervalEnd = Date.now();
		const intervalStart = options.monitorLastInterval;
		options.monitorLastInterval = intervalStart;
		const intervalSize = intervalEnd - intervalStart;

		/** bandwidth **/
		// start by copying the data so it doesn't change anymore!
		const requests = $.extend(true, {}, fragmentRequests);

		const bandwidth = {
			video: 0,
			audio: 0
		};

		// go over the requests
		for (const url in requests) {
			const request = requests[url];

			if (!request.firstByteDate) {
				continue;
			}

			// the request is done
			if (request.requestEndDate) {

				// thee request started and ended within the current interval
				if (request.requestStartDate >= intervalStart) {
					const duration = request.requestEndDate - request.requestStartDate;
					bandwidth[request.mediaType] += 1000.0 / duration * request.bytesTotal;
					delete fragmentRequests[url];
				}

				// the request started before this interval start and ended within this interval
				else if (request.requestStartDate < intervalStart) {

					const duration = request.requestEndDate - intervalStart;
					const reduction = fragmentState[url] ? fragmentState[url] : 0;
					bandwidth[request.mediaType] += 1000.0 / duration * (request.bytesTotal - reduction);
					delete fragmentState[url];
					delete fragmentRequests[url];
				}
			} else {

				// the request started within this interval and has not yet finished
				if (request.requestStartDate >= intervalStart) {

					const duration = intervalEnd - request.requestStartDate;
					bandwidth[request.mediaType] += 1000.0 / duration * request.bytesLoaded;
					fragmentState[url] = request.bytesLoaded;
				}

				// this request started before this interval and has not yet ended
				else {

					const duration = intervalSize;
					const reduction = fragmentState[url] ? fragmentState[url] : 0;
					bandwidth[request.mediaType] += 1000.0 / duration * (request.bytesLoaded - reduction);
					fragmentState[url] = request.bytesLoaded;
				}
			}
		}

		// hopefully, we should now have proper bandwidth measurements!
		metric.bandwidth.video.current = bandwidth.video;
		metric.bandwidth.audio.current = bandwidth.audio;
		metric.bandwidth.current = bandwidth.video + bandwidth.audio;

		metric.bandwidth.video.history.push(bandwidth.video);
		if (metric.bandwidth.video.history.length > options.monitorHistory) {
			metric.bandwidth.video.history.shift();
		}
		metric.bandwidth.video.average =
			metric.bandwidth.video.history.reduce(function(sum, value) {
				return sum + value;
			}, 0) /
			metric.bandwidth.video.history.length;

		metric.bandwidth.audio.history.push(bandwidth.audio);
		if (metric.bandwidth.audio.history.length > options.monitorHistory) {
			metric.bandwidth.audio.history.shift();
		}
		metric.bandwidth.audio.average =
			metric.bandwidth.audio.history.reduce(function(sum, value) {
				return sum + value;
			}, 0) /
			metric.bandwidth.audio.history.length;

		metric.bandwidth.average = averageNullable(metric.bandwidth.video.average, metric.bandwidth.audio.average);

		prevMetric = $.extend(true, {}, metric);
	};

	// prep options
	options = $.extend(true, options, userOption);
	if (typeof options.collectorType === "string" && SANDPlayer_Collectors[options.collectorType] != null) options.collectorType = SANDPlayer_Collectors[options.collectorType];

	sandMessage.senderId = options.id;
	sandMessage.dmappId = options.dmapp;

	downstream = getDownStream(controller, options.dmapp);
	downstream.event.on(options.id, function(action) {
		if (action.action === "disable") {
			logger.warn("Received 'disable' action, support is not implemented");
		} else if (action.action === "nothing" || action.action === "downgrade" || action.action === "upgrade" || action.action === "preserve") {
			player.setMaxAllowedBitrateFor('video', (action.videoBitrate / 1000) || NaN);
			logger.debug("Received action type: '" + action.action + "', videoBitrate: " + action.videoBitrate + ", " + bandwidthSummaryLine());
		} else {
			logger.warn("Received unknown action type: '" + action.action + "', support is not implemented");
		}
	});

	const subscribePlayerEvent = function(type, listener, scope, priority) {
		const ret = player.on(type, listener, scope, priority);
		destructors.push(player.off.bind(player, type, listener, scope));
		return ret;
	};

	// initialize the player
	const init = function() {
		// update network state
		subscribePlayerEvent(dashjs.MediaPlayer.events.FRAGMENT_LOADING_STARTED, function(e) {
			metric.status = "downloading";
			fragmentRequests[e.request.url] = e.request;
		});
		subscribePlayerEvent(dashjs.MediaPlayer.events.FRAGMENT_LOADING_COMPLETED, function() {
			metric.status = "idle";
		});
		subscribePlayerEvent(dashjs.MediaPlayer.events.FRAGMENT_LOADING_ABANDONED, function() {
			metric.status = "idle";
		});

		// run user provided callback when ready to start playback
		subscribePlayerEvent(dashjs.MediaPlayer.events.CAN_PLAY, function() {

			// get available bitrates
			const videoBitrates = player.getBitrateInfoListFor("video");
			if (videoBitrates) {
				videoBitrates.forEach(function(item, index) {
					metric.bitrates.video[item.qualityIndex] = item.bitrate;
				});
			}
			const audioBitrates = player.getBitrateInfoListFor("audio");
			if (audioBitrates) {
				audioBitrates.forEach(function(item, index) {
					metric.bitrates.audio[item.qualityIndex] = item.bitrate;
				});
			}
		});

		// start the monitor
		monitor = setInterval(monitorPlayer, options.monitorInterval);
		options.monitorLastInterval = Date.now();

		const debouncedCollect = debounce(collectMetrics, options.collectionInterval);

		// setup callbacks
		switch (options.collectorType) {
			case SANDPlayer_Collectors.COLLECT_ON_SEGMENT_DONE_THROTTLED:
				subscribePlayerEvent(dashjs.MediaPlayer.events.FRAGMENT_LOADING_COMPLETED,
					debouncedCollect);
				break;

			case SANDPlayer_Collectors.COLLECT_ON_STATS_CHANGE_THROTTLED:
				subscribePlayerEvent(dashjs.MediaPlayer.events.METRIC_CHANGED,
					debouncedCollect);
				break;

			case SANDPlayer_Collectors.COLLECT_AT_INTERVAL:
				reporter = setInterval(collectMetrics, options.collectionInterval);
				break;

			case SANDPlayer_Collectors.COLLECT_ON_SEGMENT_DONE:
				subscribePlayerEvent(dashjs.MediaPlayer.events.FRAGMENT_LOADING_COMPLETED, collectMetrics);
				break;

			case SANDPlayer_Collectors.COLLECT_ON_STATS_CHANGE:
				subscribePlayerEvent(dashjs.MediaPlayer.events.METRIC_CHANGED, collectMetrics);
				break;

			case SANDPlayer_Collectors.NEVER_COLLECT:
				break;

			default:
				logger.warn("No such collection policy: " + options.collectorType + ", will NOT send statistics to collector!");
				break;
		}
	};

	// destroy player
	const destroy = function() {
		logger.debug("SANDPlayer: destroy");
		for (let i = 0; i < destructors.length; i++) {
			destructors[i]();
		}
		player = undefined;
		if (reporter) {
			window.clearInterval(reporter);
			reporter = undefined;
		}
		if (monitor) {
			window.clearInterval(monitor);
			monitor = undefined;
		}
		if (downstream) {
			downstream.rc.unref();
			downstream = undefined;
		}
	};

	init();

	return {
		destroy: destroy,
	};
};

module.exports = {
	SANDPlayer_Collectors: SANDPlayer_Collectors,
	SANDPlayer: SANDPlayer,
};
