/************************************************************************/
/* FILE:                DMAppAVPlayerComponentBehaviour.js              */
/* DESCRIPTION:         Polymer DMApp component behaviour template      */
/*                      for video players, applies on top of            */
/*                      DMAppComponentBehaviour                         */
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
const DMAppComponentBehaviour = require('./DMAppComponentBehaviour');
const MediaElementClockSource = require('./MediaElementClockSource');
const EnumUtil = require('./EnumUtil');
const Signal = require('./Signal');
const ClockSchedulerUtil = require('./ClockSchedulerUtil');
const $ = require("jquery");
const dvbcssClocks = require('dvbcss-clocks/src/main');

/**
 * DMApp AV player component interface
 *
 * This is the instance interface of a DMApp component, which mixes the {@link DMAppAVPlayerComponentBehaviour} mixin.
 *
 * @constructor DMAppAVPlayerComponent
 * @mixes DMAppAVPlayerComponentBehaviour
 * @extends DMAppComponent
 */

/** @member {?boolean} DMAppAVPlayerComponent#isClockMaster Set to true by {@link DMAppAVPlayerComponentBehaviour#setAsDefaultTimelineClock} */
/** @member {!DMAppAVPlayerComponentBehaviour.SYNC_MODE} DMAppAVPlayerComponent#syncMode sync mode */

/**
 * DMApp AV player component behaviour.
 * AV media player components SHOULD mix-in this behaviour, or another behaviour which mixes this behaviour.
 * This is typically done using Polymer's behaviour mechanism.
 *
 * @see {@link DMAppAVPlayerComponent} for the corresponding instance interface
 *
 * @alias DMAppAVPlayerComponentBehaviour
 * @mixes DMAppComponentBehaviour
 * @mixin
 */
const DMAppAVPlayerComponentBehaviourImpl = {

	initDMAppComponent: function(dMAppController, id, typeName, config) /* -> void */ {
		DMAppComponentBehaviour.initDMAppComponent.apply(this, arguments);
		const self = this;
		self._mediaOffset = 0;
		self._liveOffset = 0;
		self._pauseOnSyncStop = false;
		self._syncBlockSignal = new Signal.BlockCountSignal();
		self.syncMode = self.SYNC_MODE.SLAVE;
		self.readyPromise.then(function() {
			self.getPlayer().then(function(player) {
				self.event.emit("playerReady");
				const handleSyncStateChange = self._handleSyncStateChange.bind(self);
				self.event.on("isRunningChange", handleSyncStateChange);
				self.event.on("syncStateChange", handleSyncStateChange);
				self.event.on("referenceClockChange", self._handleReferenceClockChange.bind(self));
				self.componentTimelineClock.on("available", handleSyncStateChange);
				self.componentTimelineClock.on("unavailable", handleSyncStateChange);
				self._syncBlockSignal.on("toggle", handleSyncStateChange);
				self._handleSyncStateChange();
			});
		});
	},

	deinitDMAppComponent: function() /* -> void */ {
		this.unsetAsDefaultTimelineClock();
		this._handleSyncStateChange();
		DMAppComponentBehaviour.deinitDMAppComponent.call(this);
	},

	_getEffectiveOffset: function() {
		return (this._mediaOffset || 0) + (this._liveOffset || 0);
	},

	/**
	 * @typedef {Object} GetPlayerResultType
	 * @property {!Element} element The player element
	 * @property {Player=} player The player object
	 */
	/**
	 * Get the AV player element and optionally player object.
	 * This method must be overridden, and the parent implementation MUST NOT be called.
	 *
	 * @abstract
	 * @returns {Promise<GetPlayerResultType>}
	 */
	getPlayer: function() /* -> Promise<{ player: player, element: Element }> */ {
		return Promise.reject("Not implemented");
	},

	/**
	 * Synchronously get the AV player element and optionally player object.
	 * This method must be overridden, and the parent implementation MUST NOT be called.
	 *
	 * @abstract
	 * @returns {?GetPlayerResultType}
	 */
	getPlayerSync: function() {
		throw new Error("Not implemented");
	},

	/**
	 * Get whether the AV player is showing controls.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * @abstract
	 * @returns {Promise<boolean>}
	 */
	getControlsShown: function() /* -> Promise<bool> */ {
		return Promise.resolve(false); // sensible default
	},

	/**
	 * Set whether the AV player is showing controls.
	 * If this method is overridden, the parent implementation SHOULD NOT be called.
	 *
	 * @abstract
	 * @param {boolean} shown
	 * @returns {Promise}
	 */
	setControlsShown: function(shown) /* -> Promise<> */ {
		return Promise.resolve(); // do nothing
	},

	/**
	 * Set the offset in time in s by which the AV media player is ahead of the component
	 * timeline clock, when synced as either a master or slave.
	 * This method SHOULD NOT be overridden.
	 *
	 * @param {number} offset offset in s
	 */
	setMediaOffset: function(offset) /* -> void */ {
		if (!offset) offset = 0;
		if (this._mediaOffset === offset) return;
		this._mediaOffset = offset;
		this._setOffsetIntl();
	},

	/**
	 * Set the live offset in time in s by which the AV media player is ahead of the component
	 * timeline clock, when synced as either a master or slave.
	 * This is equivalent to the availability start time of a DASH feed, when using the media wallclock as the component timeline clock.
	 * This method SHOULD NOT be overridden.
	 *
	 * @param {number} offset offset in s
	 */
	setLiveOffset: function(offset) /* -> void */ {
		if (!offset) offset = 0;
		if (this._liveOffset === offset) return;
		this._liveOffset = offset;
		this._setOffsetIntl();
	},

	_setOffsetIntl: function() {
		if (this._avpbTimelineClock) this._avpbTimelineClock.setOffset(this._getAvpbTimelineClockOffset());
		if (this._isSynced) {
			this.logger.debug("Changing media sync clock offset to: " + this._getEffectiveOffset());
			this.resyncMedia();
		}
	},

	/**
	 * Set whether the AV media player in slave mode should be paused in the case whether sync is stopped because the clock to which the AV media player is synced is unavailable.
	 * This method SHOULD NOT be overridden.
	 *
	 * @param {boolean} enabled whether to pause the media element when sync is stopped due to the clock being unavailable
	 */
	setPauseOnSyncStop: function(enabled) /* -> void */ {
		const flag = !!enabled;
		if (this._pauseOnSyncStop === flag) return;
		this._pauseOnSyncStop = flag;
		this.resyncMedia();
	},

	/**
	 * Set the time in s (or null to disable) by which the clock to which the AV media player is synced (in slave mode) is clamped to be greater than or equal to the given value (relative to the component timeline clock).
	 * Clamping is applied before and after any media sync offset (see {@link DMAppAVPlayerComponentBehaviour#setMediaOffset}).
	 * This method SHOULD NOT be overridden.
	 *
	 * @param {?number} pre optional offset offset in s, pre-offset
	 * @param {?number} post optional offset offset in s, post-offset
	 */
	setMediaSyncMinimum: function(pre, post) /* -> void */ {
		if (this._mediaMinimumSyncTimePreOffset === pre && this._mediaMinimumSyncTimePostOffset === post) return;
		this._mediaMinimumSyncTimePreOffset = pre;
		this._mediaMinimumSyncTimePostOffset = post;
		this.resyncMedia();
	},

	/**
	 * If media element are currently synced, re-initialise the sync state.
	 * This method should be used if the media/player state changes in a way that require re-applying sync handlers.
	 */
	resyncMedia: function() {
		if (this._isSynced) {
			this._unsynchroniseAllElems();
			this._synchroniseAllElems();
		}
	},

	/**
	 * If the media element is currently synced, re-initialise the sync state.
	 * This method should be used if the media/player state changes in a way that require re-applying sync handlers.
	 *
	 * @param {Element} elem The media element to resync
	 */
	resyncMediaElement: function(elem) {
		if (this._isSynced) {
			this._unsynchroniseElem(elem);
			this._synchroniseElem(elem);
		}
	},

	SYNC_MODE: EnumUtil.createConstEnum(
			/**
			 * Sync mode types: see {@link DMAppAVPlayerComponent#syncMode}
			 *
			 * @readonly
			 * @alias SYNC_MODE
			 * @memberof! DMAppAVPlayerComponentBehaviour
			 * @enum {number}
			 */
			{
				/** Request that the media be synced as a slave to the clock source */
				SLAVE:  0,

				/** Request that the media attempt to drive the clock source as a master */
				MASTER: 1,

				/** Request the the media not be synced as either a master or slave to the clock source */
				NONE:   2,
			}, 'DMAppAVPlayerComponentBehaviour.SYNC_MODE'),

	/**
	 * Set the synchronisation mode for this component, as a string.
	 * This calls {@link DMAppAVPlayerComponentBehaviour#setMediaSyncMode}.
	 *
	 * @param {string} modeString The sync mode to set, as a string.
	 */
	setMediaSyncModeString: function(modeString) /* -> void */ {
		let mode;
		if (modeString === 'slave' || !modeString) {
			mode = this.SYNC_MODE.SLAVE;
		} else if (modeString === 'master') {
			mode = this.SYNC_MODE.MASTER;
		} else if (modeString === 'none') {
			mode = this.SYNC_MODE.NONE;
		} else {
			this.logger.warn("Unknown media sync mode: '" + modeString + "', defaulting to 'slave'");
			mode = this.SYNC_MODE.SLAVE;
		}
		this.setMediaSyncMode(mode);
	},

	/**
	 * Set the synchronisation mode for this component.
	 *
	 * @param {DMAppAVPlayerComponentBehaviour.SYNC_MODE} mode The sync mode to set
	 */
	setMediaSyncMode: function(mode) /* -> void */ {
		if (mode < this.SYNC_MODE.SLAVE || mode > this.SYNC_MODE.NONE) {
			this.logger.throwError("setMediaSyncMode: Invalid mode: ", mode);
		}
		if (this.syncMode !== mode) {
			this.syncMode = mode;
			this._handleSyncStateChange();
		}
	},

	/**
	 * Set whether to shown video player controls, from the parameter.
	 * This calls {@link DMAppAVPlayerComponentBehaviour#setControlsShown}.
	 *
	 * @param showParam Whether to show controls if a boolean, otherwise use the default.
	 */
	setControlsShownParameter: function(showParam) /* -> void */ {
		let show = false;
		if (showParam === true || showParam === "true") {
			show = true;
		} else if (showParam === false || showParam === "false") {
			show = false;
		} else if (showParam === "auto") {
			show = (this.syncMode !== this.SYNC_MODE.SLAVE);
		} else if (showParam != null) {
			this.logger.warn("Unknown show controls parameter: '" + showParam + "', using default value: " + show);
		}
		this.setControlsShown(show).catch(this.logger.deferredConcat('error', "setControlsShownParameter: Setting whether to show controls failed: "));
	},

	/**
	 * Set the AV player to be the master source of the default timeline clock source {@link DMAppTimeline#defaultClock}
	 * and by extension all components and other entities synchronised to the default timeline clock source.
	 * This method SHOULD NOT be overridden.
	 * Sets {@link DMAppAVPlayerComponentBehaviour#isClockMaster} to true.
	 * This is called by {@link DMAppAVPlayerComponentBehaviour#setMediaSyncMode}, manual calls may be overridden.
	 *
	 * @param {boolean} replace Replace any existing default timeline clock source
	 *
	 * @returns {Promise}
	 */
	setAsDefaultTimelineClock: function(replace) /* -> Promise<> */ {
		if (this._destructing) this.logger.throwError("Cannot setAsDefaultTimelineClock, element is destructing");
		const self = this;
		delete this._avpbTimelineClockCancel;
		this.isClockMaster = true;
		this.event.emit("syncStateChange");
		return self.getPlayer().then(function(player) {
			if (self._destructing) return;
			if (self._avpbTimelineClockCancel) return;

			let clock_replace;
			if (replace && self._avpbTimelineClock) {
				clock_replace = function(master, clock) {
					self.dMAppController.timeline.unsetClockSource(master, clock);
					clock.destroy();
				}.bind(null, self._avpbMasterClock, self._avpbTimelineClock);
				delete self._avpbTimelineClock;
				delete self._getAvpbTimelineClockOffset;
				delete self._avpbMasterClock;
			}

			if (!self._avpbTimelineClock) {
				if (self._componentTimelineIndependent) {
					self._avpbMasterClock = self.componentTimelineClock.getParent();
					if (self._avpbMasterClock) {
						self._getAvpbTimelineClockOffset = function() {
							return self._getEffectiveOffset();
						};
						self._avpbTimelineClock = new MediaElementClockSource({
							element: player.element,
							offset: self._getAvpbTimelineClockOffset(),
							dMAppController: self.dMAppController,
						});
					}
				} else {
					self._avpbMasterClock = self.dMAppController.timeline.defaultClock;
					self._getAvpbTimelineClockOffset = function() {
						let offset = self._getEffectiveOffset();
						if (!self._liveOffset) offset -= (self.dMAppStartTime || 0);
						return offset;
					};
					self._avpbTimelineClock = new MediaElementClockSource({
						element: player.element,
						offset: self._getAvpbTimelineClockOffset(),
						dMAppController: self.dMAppController,
						minimumOutputTime: (self.dMAppStartTime || 0),
					});
				}
			}

			if (self._avpbTimelineClock) {
				self.dMAppController.timeline.setClockSource(self._avpbMasterClock, self._avpbTimelineClock, {
					isMaster: true,
					synchroniserElement: player.element,
					getSynchroniserElementOffset: self._avpbTimelineClock.getOffset.bind(self._avpbTimelineClock),
					player: player.player,
					sourceName: self.getName() + ":MediaElementClockSource",
					priority: self.dMAppStartTime,
				});
			}

			if (clock_replace) clock_replace();
		});
	},

	/**
	 * Unset the AV player from being the master source of the default timeline clock source {@link DMAppTimeline#defaultClock}.
	 * See {@link DMAppAVPlayerComponentBehaviour.setAsDefaultTimelineClock}.
	 * This method SHOULD NOT be overridden.
	 * Unsets {@link DMAppAVPlayerComponentBehaviour#isMaster}.
	 * This is called by {@link DMAppAVPlayerComponentBehaviour#setMediaSyncMode}, manual calls may be overridden.
	 *
	 * @returns {Promise}
	 */
	unsetAsDefaultTimelineClock: function() /* -> void */ {
		this._avpbTimelineClockCancel = true;
		delete this.isClockMaster;
		if (this._avpbTimelineClock) {
			// Note that this function is potentially re-entrant through the call to unsetDefaultClockSource below
			const clock = this._avpbTimelineClock;
			delete this._avpbTimelineClock;
			delete this._getAvpbTimelineClockOffset;
			const master = this._avpbMasterClock;
			delete this._avpbMasterClock;
			this.dMAppController.timeline.unsetClockSource(master, clock);
			clock.destroy();
		}
		this.event.emit("syncStateChange");
	},

	/**
	 * Set whether this AV player can possibly be a sync master, default: false.
	 *
	 * @param {boolean} possible Whether being a sync master is possible
	 */
	setIsSyncMasterPossible: function(possible) {
		this._syncMasterPossible = possible;
		this._handleSyncStateChange();
	},

	_isMasterToSlaveOverrideMode: function() {
		return this.syncMode === this.SYNC_MODE.MASTER && this.dMAppController.timeline.isClockMasterOverride(this.componentTimelineClock);
	},

	_shouldBeSyncMaster: function() {
		return this.syncMode === this.SYNC_MODE.MASTER && !this._destructing && this.isRunning() && this._syncMasterPossible && !this._isMasterToSlaveOverrideMode() && !this._syncBlockSignal.isBlocked();
	},

	_shouldSync: function() {
		return (this.syncMode === this.SYNC_MODE.SLAVE || this._isMasterToSlaveOverrideMode()) && !(this.isClockMaster || this._destructing) && !this._syncBlockSignal.isBlocked();
	},

	_handleSyncStateChange: function() {
		const shouldBeMaster = this._shouldBeSyncMaster();
		if (!shouldBeMaster && this.isClockMaster) {
			this.unsetAsDefaultTimelineClock();
		} else if (shouldBeMaster && !this.isClockMaster) {
			this.setAsDefaultTimelineClock().catch(this.logger.deferredConcat('error', "setMediaSyncMode: Setting default timeline clock failed: "));
		}

		const shouldSync = this._shouldSync();
		if (!shouldSync && this._isSynced) {
			// remove sync
			this._unsynchroniseAllElems();
		} else if (shouldSync && !this._isSynced) {
			// apply sync
			this._synchroniseAllElems();
		}
	},

	_synchroniseElem: function(elem) {
		const self = this;
		if (this._synchronisedElements && this._synchronisedElements.indexOf(elem) >= 0) {
			// already synchronised
			return;
		}

		if (!this._mediaSyncClock) {
			this._mediaSyncClockDestructors = [];
			let clock = this.componentTimelineClock;
			if (this._liveOffset && !this._componentTimelineIndependent) {
				// Live operation, switch to reference clock instead
				clock = this.referenceClock;
			}

			const applyMinimum = function(threshold, name) {
				if (threshold == null) return;

				name += "(" + threshold + "s)";

				const srcClock = clock;
				const boundedClock = new dvbcssClocks.CorrelatedClock();
				const scheduler = new ClockSchedulerUtil.ClockArrayIntervalScheduler([threshold], {
					logger: self.logger,
				});
				scheduler.on("change", function(interval) {
					if (interval.interval === -1) {
						self.dMAppController.timeline.setCorrelatedClockParent(srcClock, boundedClock, 0, threshold, 0, name);
					} else if (interval.interval === 0) {
						self.dMAppController.timeline.setCorrelatedClockParent(srcClock, boundedClock, 0, 0, 1, name);
					}
				});
				scheduler.setClock(srcClock);
				if (!boundedClock.getParent()) self.dMAppController.timeline.setCorrelatedClockParent(srcClock, boundedClock, 0, 0, 1, name);

				clock = boundedClock;
				self._mediaSyncClockDestructors.push(function() {
					boundedClock.setParent(null); // prevent leaks
					scheduler.destroy();
				});
			};

			applyMinimum(this._mediaMinimumSyncTimePreOffset, "MinimumSyncTimePreOffset");

			const effectiveOffset = this._getEffectiveOffset();
			if (effectiveOffset) {
				const offsetClock = this.dMAppController.timeline.createOffsettedClock(clock, effectiveOffset, "MediaOffset");
				clock = offsetClock;
				this._mediaSyncClockDestructors.push(function() {
					offsetClock.setParent(null); // prevent leaks
				});
			}

			applyMinimum(this._mediaMinimumSyncTimePostOffset, "MinimumSyncTimePostOffset");

			this._mediaSyncClock = clock;
		}
		if (!this._synchronisedElements) this._synchronisedElements = [];
		this._synchronisedElements.push(elem);
		let name = this.getName();
		if (DMAppAVPlayerComponentBehaviourImpl.ElemAnnotationSymbol) name += "[" + elem[DMAppAVPlayerComponentBehaviourImpl.ElemAnnotationSymbol] + "]";
		try {
			this.dMAppController.timeline.synchroniseMediaElementToClock(this._mediaSyncClock, elem, name, { pauseOnSyncStop: this._pauseOnSyncStop });
		} catch(e) {
			this.logger.error("Failed to synchronise media to clock: ", e);
		}
	},

	_getElementList: function() {
		const info = this.getPlayerSync();
		if (!info) return [];
		if (info.allElements) return info.allElements;
		if (info.element) return [info.element];
		return [];
	},

	_synchroniseAllElems: function() {
		this._isSynced = true;
		const elems = this._getElementList();
		if (this._synchronisedElements) {
			const to_remove = [];
			for (let i = 0; i < this._synchronisedElements.length; i++) {
				if (elems.indexOf(this._synchronisedElements[i] < 0)) to_remove.push(this._synchronisedElements[i]);
			}
			for (let i = 0; i < to_remove.length; i++) {
				this._unsynchroniseElem(to_remove[i]);
			}
		}
		for (let i = 0; i < elems.length; i++) {
			this._synchroniseElem(elems[i]);
		}
	},

	_unsynchroniseElem: function(elem) {
		if (this._synchronisedElements) {
			const index = this._synchronisedElements.indexOf(elem);
			if (index >= 0) {
				this.dMAppController.timeline.unsynchroniseFromClock(this._mediaSyncClock, this._synchronisedElements[index]);
				this._synchronisedElements.splice(index, 1);
			}
		}
	},

	_unsynchroniseAllElems: function() {
		this._isSynced = false;
		if (this._synchronisedElements) {
			for (let i = 0; i < this._synchronisedElements.length; i++) {
				this.dMAppController.timeline.unsynchroniseFromClock(this._mediaSyncClock, this._synchronisedElements[i]);
			}
			delete this._synchronisedElements;
		}
		if (this._mediaSyncClock) {
			while (this._mediaSyncClockDestructors.length) {
				this._mediaSyncClockDestructors.pop()();
			}
			delete this._mediaSyncClock;
			delete this._mediaSyncClockDestructors;
		}
	},

	_handleReferenceClockChange: function(info) {
		if (this._isSynced && this._mediaSyncClock) {
			const mediaSyncAncestry = this._mediaSyncClock.getAncestry();
			if (mediaSyncAncestry.indexOf(info.oldReferenceClock) >= 0) {
				const timeline = this.dMAppController.timeline;
				this.logger.info("Changing media sync reference clock source from: " +
						timeline.getClockInfo(info.oldReferenceClock) + " to " + timeline.getClockInfo(info.newReferenceClock));
				this._unsynchroniseAllElems();
			}
		}
		this._handleSyncStateChange();
	},

	setupComponentDebugEvents: function(listenerTracker, func) {
		const tracker = listenerTracker.subscribeTo(this.event);
		tracker.on("syncStateChange", func);
		tracker.on("playerReady", func);
		DMAppComponentBehaviour.setupComponentDebugEvents.call(this, listenerTracker, func);
	},

	dumpDebugInfo: function(dumper) {
		const cat = dumper.subcategory("DMAppAVPlayerComponentBehaviour");
		let syncType = "none";
		if (this._isSynced) syncType = "slave";
		if (this.isClockMaster) syncType = "master";
		cat.keyValue("Sync state", syncType);
		cat.keyValue("Sync mode", EnumUtil.enumToString(this.SYNC_MODE, this.syncMode));
		cat.keyValue("Media offset", this._mediaOffset);
		if (this._liveOffset) cat.keyValue("Live offset", this._liveOffset);
		DMAppComponentBehaviour.dumpDebugInfo.call(this, dumper);
	},

};

try {
	DMAppAVPlayerComponentBehaviourImpl.ElemAnnotationSymbol = Symbol('ElemAnnotationSymbol');
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

const DMAppAVPlayerComponentBehaviour = $.extend({}, DMAppComponentBehaviour, DMAppAVPlayerComponentBehaviourImpl);

try {
	Object.freeze(DMAppAVPlayerComponentBehaviour);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = DMAppAVPlayerComponentBehaviour;
