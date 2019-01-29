"use strict";

const dvbcssClocks = require('dvbcss-clocks/src/main');
const argCheck = require('./argCheck');

/**
 * @classdesc
 *
 * Synchronise a media element (slave) to either a clock or another media element (master).
 * This should generally not be used directly by DMApp components.
 * When constructed, synchronisation is started.
 * `slave` and `master` must be valid/available whenever synchronisation is in the started state,
 * or when setOffset is called.
 *
 * @constructor
 * @param {Object} params                    object containing key value pairs:
 * @param {Element|Clock} params.master      must be a media element or an available dvb-css clock
 * @param {Element} params.slave             must be a media element
 * @param {Logger} params.logger             logger
 * @param {number=} params.offset            optional offset in s by which slave should lag master
 * @param {Function=} params.notifyThrashing optional callback to call when media is thrashing
 * @param {boolean=} params.pauseOnSyncStop  optional whether to pause the media element when sync is stopped
 */
function MediaSynchroniser(params) {
	this.avgCorrection = [];
	this.lastSeek = undefined;
	this.thrashing = 0;
	this.playInProgress = false;

	if (!params) {
		throw new Error("MediaSynchroniser constructor: No parameters supplied");
	}

	if (params.logger) {
		this.logger = params.logger;
	} else {
		throw new Error("MediaSynchroniser constructor: No logger supplied");
	}

	this.offset = params.offset || 0;
	this.notifyThrashing = params.notifyThrashing || function() { };
	this.pauseOnSyncStop = !!params.pauseOnSyncStop;

	argCheck(arguments, 1, this.logger, "MediaSynchroniser constructor", params,
			['master', 'slave', 'offset', 'notifyThrashing', 'logger', 'pauseOnSyncStop']);

	if (!params.master) {
		this.logger.throwError("MediaSynchroniser constructor: No master supplied");
	} else if (params.master instanceof dvbcssClocks.ClockBase) {
		this.masterClock = params.master;
		this.isMasterPaused = function() {
			return this.masterClock.getEffectiveSpeed() === 0;
		};
		this.getMasterPosition = function() {
			return this.masterClock.now() / this.masterClock.getTickRate();
		};
	} else {
		this.masterElem = params.master;
		this.isMasterPaused = function() {
			return this.masterElem.paused;
		};
		this.getMasterPosition = function() {
			return this.masterElem.currentTime;
		};
	}

	if (params.slave) {
		this.slaveElem = params.slave;
	} else {
		this.logger.throwError("MediaSynchroniser constructor: No slave supplied");
	}

	this._syncEnabled = false;
	this.startSync();
}

MediaSynchroniser.prototype = {

	_eventSetupCommon: function(handler) {
		handler('timeupdate');
		handler('play');
		handler('pause');
	},

	/** start synchronisation if not already started */
	startSync: function() {
		if (this._syncEnabled) return;
		this._syncEnabled = true;
		if (this.masterElem) {
			this._eventSetupCommon(function(ev) {
				const propfunc = "_" + ev + "Event";
				const propbind = "_" + ev + "EventBind";
				if (!this[propbind]) {
					this[propbind] = this[propfunc].bind(this);
					this.masterElem.addEventListener(ev, this[propbind], false);
				}
			}.bind(this));
			this._clockChangeEvent();
		}
		if (this.masterClock) {
			this._clockEventHandler = this._clockChangeEvent.bind(this);
			this.masterClock.on('change', this._clockEventHandler);
			this._clockChangeEvent();
			this._checkTimer();
		}

		this._slaveCheck = function(ev) {
			const isPause = (ev.type === 'pause');
			if (this.isMasterPaused() !== isPause) {
				this._clockChangeEvent();
			}
			this._lastSeekCheckValue = null;
		}.bind(this);
		this.slaveElem.addEventListener("play", this._slaveCheck, false);
		this.slaveElem.addEventListener("pause", this._slaveCheck, false);

		this._slaveSeekCheck = function() {
			if (this._checkDuration()) return;
			if (this.isMasterPaused() && this.slaveElem.paused && this.slaveElem.currentTime !== this.getMasterPosition() - this.offset) {
				if (this._lastSeekCheckValue !== this.slaveElem.currentTime) {
					this._lastSeekCheckValue = this.slaveElem.currentTime;
					this._setTimeNow();
				}
			}
		}.bind(this);
		this.slaveElem.addEventListener("seeked", this._slaveSeekCheck, false);

		this._slaveLoadedMetadataCheck = this._clockChangeEvent.bind(this);
		this.slaveElem.addEventListener("loadedmetadata", this._slaveLoadedMetadataCheck, false);
	},

	/** stop synchronisation if not already stopped */
	stopSync: function() {
		if (!this._syncEnabled) return;
		this._syncEnabled = false;
		if (this.masterElem) {
			this._eventSetupCommon(function(ev) {
				const prop = "_" + ev + "EventBind";
				if (this[prop]) {
					this.masterElem.removeEventListener(ev, this[prop], false);
					delete this[prop];
				}
			}.bind(this));
		}
		if (this.masterClock) {
			this.masterClock.removeListener('change', this._clockEventHandler);
			this._checkTimer();
		}
		this.slaveElem.removeEventListener("play", this._slaveCheck, false);
		this.slaveElem.removeEventListener("pause", this._slaveCheck, false);
		this.slaveElem.removeEventListener("seeked", this._slaveSeekCheck, false);
		this.slaveElem.removeEventListener("loadedmetadata", this._slaveLoadedMetadataCheck, false);
		this.slaveElem.playbackRate = 1;
		if (this.pauseOnSyncStop) {
			this.slaveElem.pause();
		} else {
			this.slaveElem.play();
		}
	},

	_clockChangeEvent: function() {
		if (!this._syncEnabled) this.logger.throwError("_clockChangeEvent called when sync not enabled");
		if (this._checkDuration()) return;
		if (this.isMasterPaused()) {
			this._pauseEvent();
		} else {
			this._playEvent();
		}
		this._checkTimer();
	},

	_checkTimer: function() {
		const shouldHaveTimer = this._syncEnabled && this.masterClock && !this.isMasterPaused();
		if (shouldHaveTimer && !this._timerHandle) {
			this._timerHandle = window.setInterval(this._timeupdateEvent.bind(this), 100);
		} else if (!shouldHaveTimer && this._timerHandle) {
			window.clearInterval(this._timerHandle);
			delete this._timerHandle;
		}
	},

	_checkDuration: function() {
		const curTime = this.getMasterPosition() - this.offset;
		if (this.slaveElem.duration <= curTime) {
			if (this.slaveElem.currentTime !== this.slaveElem.duration) this.slaveElem.currentTime = this.slaveElem.duration;
			if (!this.slaveElem.paused) this.slaveElem.pause();
			return true;
		}
		return false;
	},

	_playEvent: function() {
		if (!this._syncEnabled) this.logger.throwError("_playEvent called when sync not enabled");
		if (this.playInProgress) return;
		if (this.slaveElem.readyState < this.slaveElem.HAVE_METADATA) return;
		if (this._checkDuration()) return;

		if (this.slaveElem.paused) this.slaveElem.play();
		this._timeupdateEvent();
	},

	_pauseEvent: function() {
		if (!this._syncEnabled) this.logger.throwError("_pauseEvent called when sync not enabled");
		if (this.slaveElem.readyState < this.slaveElem.HAVE_METADATA) return;
		if (this._checkDuration()) return;

		if (!this.slaveElem.paused) this.slaveElem.pause();
		this._setTimeNow();
	},

	_setTimeNow: function() {
		if (!this._syncEnabled) this.logger.throwError("_setTimeNow called when sync not enabled");
		if (this.slaveElem.readyState < this.slaveElem.HAVE_METADATA) return;
		if (this._checkDuration()) return;
		this.slaveElem.currentTime = this.getMasterPosition() - this.offset;
	},

	/**
	 * set synchronisation offset
	 *
	 * @param {number} offset offset in s by which slave should lag master
	 */
	setOffset: function(offset) {
		if (this.offset !== offset) {
			this.offset = offset;
			if (this._syncEnabled) {
				if (this._checkDuration()) return;
				if (this.isMasterPaused()) {
					this._setTimeNow();
				} else {
					this._timeupdateEvent();
				}
			}
		}
	},

	// playbackRate based solution - speed up or slow down playback to align video with audio.
	// Based on https://github.com/webtiming/timingsrc/blob/gh-pages/source/mediasync/mediasync.js
	_timeupdateEvent: function() {
		if (!this._syncEnabled) this.logger.throwError("_timeupdateEvent called when sync not enabled");
		if (this.isMasterPaused()) {
			this._pauseEvent();
			return;
		}
		if (this.playInProgress) {
			return;
		}
		if (this.slaveElem.readyState < this.slaveElem.HAVE_METADATA) return;
		if (this._checkDuration()) return;

		// Determine how out of sync the slave video player is w.r.t the master.
		const curTime = this.getMasterPosition() - this.offset;
		// Compute different in playback position between the two videos.
		let delta = curTime - this.slaveElem.currentTime;

		// A large delta will be corrected with a seek. Small delta with playbackRate changes.
		if (Math.abs(delta) > 1) {
			const now = performance.now();
			let adjust = 0;
			if (this.lastSeek !== undefined) {
				// Thrash detection - still out of sync despite an accurate seek.  This indicates
				// the system is under load and cannot seek fast enough to get back in sync.
				const elapsed = now - this.lastSeek.ts;
				if (elapsed < 1500) {
					// We seeked only a short time ago, we are thrashing
					++this.thrashing;
					if (this.thrashing > 3) {
						this.logger.warn("Thrashing");
						this.notifyThrashing();
						//thrashing = 0;
					}
				} else {
					this.thrashing = 0;
				}
				const miss = (this.lastSeek.pos + elapsed) - curTime;
				adjust = this.lastSeek.adjust + miss;
				if (Math.abs(adjust) > 5) {
					adjust = 0;
				}
			}

			this.slaveElem.playbackRate = 1;
			if (this.thrashing > 3) {
				// Don't compound the thrashing behaviour by issuing more seeks.
				// Obviously, the video will remain out of sync / for longer.
				this.lastSeek = undefined;
				this.thrashing = 0;
			} else {
				// seeking is more efficient if the video element is paused.
				if (!this.slaveElem.paused && this.slaveElem.readyState >= this.slaveElem.HAVE_CURRENT_DATA && this.slaveElem.buffered.length > 0) {
					this.slaveElem.pause();
				}
				// Factor a computed adjustment which represents the measured overhead of seek operations.
				this.slaveElem.currentTime = curTime + adjust;
				const playPromise = this.slaveElem.play();
				if (playPromise != null) {
					const self = this;
					self.playInProgress = true;
					playPromise.then(function() {
						self.playInProgress = false;
					}).catch(function(error) {
						self.logger.warn("Call to play() failed: ", error);
						self.playInProgress = false;
					});
				}

				this.lastSeek = {
					ts: now, //performance.now(),
					pos: curTime,
					adjust: adjust
				};
			}
			//console.log('i: ' + i + ', seek: ' + slaveElem.currentTime);
		} else {

			// Use average of last three deltas
			const samples = this.avgCorrection;
			samples.push(delta);
			if (samples.length >= 3) {
				let avg = 0;
				for (let j = 0; j < samples.length; j++) {
					avg += samples[j];
				}
				delta = avg / samples.length;
				samples.splice(0, 1); // This could be shift()? - remove 1 at index 0
			} else {
				return;
			}

			const clampRate = function(limit, rate) {
				return Math.max(Math.min(1 + rate, 1 + limit), 1 - limit);
			};

			if (Math.abs(delta) > 1) {
				samples.length = 0;
				this.slaveElem.playbackRate = clampRate(1, delta * 1.3);
			} else if (Math.abs(delta) > 0.5) {
				samples.length = 0;
				this.slaveElem.playbackRate = clampRate(0.5, delta * 0.75);
			} else if (Math.abs(delta) > 0.1) {
				samples.length = 0;
				this.slaveElem.playbackRate = clampRate(0.4, delta * 0.75);
			} else if (Math.abs(delta) > 0.025) {
				samples.length = 0;
				this.slaveElem.playbackRate = clampRate(0.30, delta * 0.60);
			} else {
				this.slaveElem.playbackRate = clampRate(0.02, delta * 0.07);
			}
			//console.log('i: ' + i + ', playbackRate: ' + slaveElem.playbackRate + ',correction: ' + delta);
		}
	},
};

try {
	Object.freeze(MediaSynchroniser.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = MediaSynchroniser;
