/************************************************************************/
/* FILE:                SyncProtocolsCiiSyncHandler.js                  */
/* DESCRIPTION:         CII sync handler using dvbcss-protocols         */
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

const DMAppClientLib = require('DMAppClientLib');
const ReconnectingWebSocket = require("reconnectingwebsocket");

const CiiSyncHandlerBase = require('./CiiSyncHandlerBase');

const SyncProtocols = DMAppClientLib.deps.syncProtocols;
const CIIChangeMask = SyncProtocols.CII.CIIMessage.prototype.CIIChangeMask;
const inherits = DMAppClientLib.deps.inherits;
const deepEql = DMAppClientLib.deps.deepEql;
const $ = DMAppClientLib.deps.jquery;
const URI = DMAppClientLib.deps.URI;

/**
 * @classdesc
 *
 * CII sync handler implemented using dvbcss-protocols module
 *
 * @implements CiiSyncHandler
 * @extends CiiSyncHandlerBase
 *
 * @constructor
 * @param {!DMAppController} dMAppController parent controller
 * @param {!DMAppComp} dMAppComp parent DMAppComp
 */
function SyncProtocolsCiiSyncHandler(dMAppController, dMAppComp) {
	CiiSyncHandlerBase.call(this, dMAppController, dMAppComp, dMAppController.timeline.wallClock, "SyncProtocolsCiiSyncHandler");

	Object.defineProperties(this, {
		_ciiWsErrorFlag:     { value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, dMAppController.errorSignals.localServices, DMAppClientLib.ErrorUtil.ErrorMode.DEV,
				"SyncProtocolsCiiSyncHandler: Error connecting/using CII websocket") },
		_ciiTsErrorFlag:     { value: new DMAppClientLib.ErrorUtil.ErrorFlag(dMAppController, dMAppController.errorSignals.localServices, DMAppClientLib.ErrorUtil.ErrorMode.DEV,
				"SyncProtocolsCiiSyncHandler: Error connecting/using TS websocket") },
		_intermediaryClock:  { value: new DMAppClientLib.deps.dvbcssClocks.CorrelatedClock(this.srcClock) },
	});
	this._timelineCfg = {};

	this.logger.info("SyncProtocolsCiiSyncHandler version: " + require('__VERSION__'));

	const clockListenerTracker = this.listenerTracker.subscribeTo(this._intermediaryClock);
	clockListenerTracker.on("available", this._handleIntermediaryClockAvailabilityChange.bind(this));
	clockListenerTracker.on("unavailable", this._handleIntermediaryClockAvailabilityChange.bind(this));
	clockListenerTracker.on("change", this._handleIntermediaryClockChange.bind(this));

	this.dMAppComp.setCiiSyncHandler(this);
}
inherits(SyncProtocolsCiiSyncHandler, CiiSyncHandlerBase);

SyncProtocolsCiiSyncHandler.prototype.sync = function(dMAppController, url, name) {
	url = url.slice(0, -1);
	const self = this;
	self._expectedHostname = URI(url).hostname();
	self._doSync(dMAppController, url, name);
	self._ciiWsErrorFlag.setMessage("SyncProtocolsCiiSyncHandler: Error connecting/using CII websocket: " + url);
	self._ciiWsErrorCounter = self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "CII websocket error: ", url);
	self._ciiWs = new ReconnectingWebSocket(url, [], {
		reconnectInterval: 500,
		reconnectDecay: 2,
		maxReconnectInterval: 30000,
	});
	self._ciiWs.addEventListener('open', function() {
		self._ciiWsErrorCounter.flush();
		self._ciiWsClient = SyncProtocols.CII.createCIIClient(self._ciiWs, {
			callback: self._ciiCallback.bind(self, self._ciiWs),
		});
		self.logger.info("CII client connected to endpoint: " + url);
	});
	self._ciiWs.addEventListener("close", function() {
		self._timelineCfg = {};
		if (self._ciiWsClient) {
			self._ciiWsClient.stop();
			delete self._ciiWsClient;
		}
		self._updateTs();
	});
	self._ciiWs.addEventListener("error", function(err) {
		self._ciiWsErrorFlag.raise();
		self._ciiWsErrorCounter.event();
	});
};

SyncProtocolsCiiSyncHandler.prototype._ciiCallback = function(ws, cii_obj, changemask) {
	if (changemask & CIIChangeMask.FIRST_CII_RECEIVED) {
		this.logger.debug("First CII received: " + JSON.stringify(cii_obj));
		this._ciiWsErrorFlag.clear();
	}
	if (changemask & CIIChangeMask.MRS_URL_CHANGED) {
		this.logger.debug("MRS Url changed to: " + cii_obj.mrsUrl);
	}
	if (changemask & CIIChangeMask.CONTENTID_CHANGED) {
		this.logger.debug("ContentId changed to: " + cii_obj.contentId);
		this._timelineCfg.contentId = cii_obj.contentId;
		this._updateTs();
	}
	if (changemask & CIIChangeMask.CONTENTID_STATUS_CHANGED) {
		this.logger.debug("contentIdStatus changed to: " + cii_obj.contentIdStatus);
	}
	if (changemask & CIIChangeMask.PRES_STATUS_CHANGED) {
		this.logger.debug("presentationStatus changed to: " + cii_obj.presentationStatus);
	}
	if (changemask & CIIChangeMask.WC_URL_CHANGED) {
		this.logger.debug("wcUrl changed to: " + cii_obj.wcUrl);
	}
	if (changemask & CIIChangeMask.TS_URL_CHANGED) {
		let url = cii_obj.tsUrl;
		const uriObj = new URI(url);
		const currentHostname = uriObj.hostname();
		if (currentHostname !== this._expectedHostname) {
			uriObj.hostname(this._expectedHostname);
			const oldUrl = url;
			url = uriObj.toString();
			this.logger.warn("Hostname mismatch in CII TS URL: " + oldUrl + ", expected: " + this._expectedHostname + ", got: " + currentHostname + ", adjusting to: " + url);
		}
		this.logger.debug("tsUrl changed to: " + url);
		this._timelineCfg.url = url;
		this._updateTs();
	}
	if (changemask & CIIChangeMask.TIMELINES_CHANGED) {
		this.logger.debug("timelines changed to: " + JSON.stringify(cii_obj.timelines));
		if (cii_obj.timelines.length > 0) {
			this._timelineCfg.obj = cii_obj.timelines[0];
		} else {
			this._timelineCfg.obj = null;
		}
		this._updateTs();
	}
	this.debugInfo.cii_obj = cii_obj;
};

SyncProtocolsCiiSyncHandler.prototype._updateTs = function() {
	const self = this;
	if (deepEql(self._timelineCfg, self._currentTimelineCfg)) return;

	if (self._ciiTs) {
		self._ciiTs.close();
		delete self._ciiTs;
		self._ciiTsErrorCounter.flush();
	}
	if (self._ciiTsClient) {
		self._ciiTsClient.stop();
		delete self._ciiTsClient;
		self._ciiTsErrorCounter.flush();
	}

	const getSyncEnabled = function() {
		return (self._timelineCfg.contentId && self._timelineCfg.obj && self._timelineCfg.url);
	};
	const syncEnabled = getSyncEnabled();
	if (syncEnabled) {
		self._ciiTsErrorFlag.setMessage("SyncProtocolsCiiSyncHandler: Error connecting/using TS websocket: " + self._timelineCfg.url);
		self._ciiTsErrorCounter = self.logger.makeFlushableLogEventCounter('error', { autoFlushTimeout: 120000 }, "TS websocket error: ", self._timelineCfg.url);
		self._ciiTs = new ReconnectingWebSocket(self._timelineCfg.url, [], {
			reconnectInterval: 500,
			reconnectDecay: 2,
			maxReconnectInterval: 30000,
		});
		self._ciiTs.addEventListener('open', function() {
			self._ciiTsErrorCounter.flush();
			self._ciiTsClient = SyncProtocols.TimelineSynchronisation.createTSClient(self._ciiTs, self._intermediaryClock, {
				contentIdStem: self._timelineCfg.contentId,
				timelineSelector: self._timelineCfg.obj.timelineSelector,
				tickrate: self._timelineCfg.obj.unitsPerSecond / self._timelineCfg.obj.unitsPerTick,
			});
			self.logger.info("TS client connected to endpoint: " + self._timelineCfg.url);
			self._ciiTsErrorFlag.clear();
		});
		self._ciiTs.addEventListener("close", function() {
			if (self._ciiTsClient) {
				self._ciiTsClient.stop();
				delete self._ciiTsClient;
			}
		});
		self._ciiTs.addEventListener("error", function(err) {
			self._ciiTsErrorFlag.raise();
			self._ciiTsErrorCounter.event();
			if (!getSyncEnabled()) self._ciiTsErrorCounter.flush();
		});
	} else {
		self._ciiTsErrorFlag.clear();
	}

	self.dMAppController.timeline.wallclockServiceRemoteClockSyncEnableRefCount.setReferenceRegistered(self, syncEnabled);

	self._currentTimelineCfg = $.extend({}, self._timelineCfg);
};

SyncProtocolsCiiSyncHandler.prototype.unsync = function() {
	this._doUnsync();
	this._timelineCfg = {};
	this._updateTs();
	if (this._ciiWsClient) {
		this._ciiWsClient.stop();
		delete this._ciiWsClient;
	}
	this._ciiWsErrorFlag.clear();
	this._ciiWsErrorCounter.flush();
	delete this._ciiWsErrorCounter;
};

SyncProtocolsCiiSyncHandler.prototype._handleIntermediaryClockAvailabilityChange = function() {
	const available = this._intermediaryClock.availabilityFlag;
	if (available) {
		const change = this.clock.quantifySignedChange(this._intermediaryClock.getCorrelation(), this._intermediaryClock.getSpeed());
		if (change || !this.clock.availabilityFlag) {
			this.logger.debug("Applying clock update, change: ", change * 1000, "ms, speed: ", this._intermediaryClock.getSpeed(), ", due to clock becoming available");
			this.clock.setCorrelationAndSpeed(this._intermediaryClock.getCorrelation(), this._intermediaryClock.getSpeed());
		}
	} else {
		this.logger.debug("Clock unavailable");
	}
	this.clock.setAvailabilityFlag(available);
};

SyncProtocolsCiiSyncHandler.prototype._handleIntermediaryClockChange = function() {
	if (!this._intermediaryClock.availabilityFlag) return;
	const change = this.clock.quantifySignedChange(this._intermediaryClock.getCorrelation(), this._intermediaryClock.getSpeed());
	if (Math.abs(change) >= 0.05) {
		this.logger.debug("Applying clock update, change: ", change * 1000, "ms, speed: ", this._intermediaryClock.getSpeed());
		this.clock.setCorrelationAndSpeed(this._intermediaryClock.getCorrelation(), this._intermediaryClock.getSpeed());
	}
};

try {
	Object.freeze(SyncProtocolsCiiSyncHandler.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = SyncProtocolsCiiSyncHandler;
