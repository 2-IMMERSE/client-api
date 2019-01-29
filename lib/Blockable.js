/************************************************************************/
/* FILE:                Blockable.js                                    */
/* DESCRIPTION:         Utility wrappers for blockable entities         */
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

/**
 * Blockable interface
 *
 * @interface Blockable
 */
 /**
 * Block this instance
 *
 * @method Blockable#block
 */
 /**
 * Unblock this instance
 *
 * @method Blockable#unblock
 */

/**
 * @classdesc
 *
 * Utility wrapper to de-duplicate calls to block/unblock on a Blockable
 *
 * @implements Blockable
 *
 * @constructor
 * @param {!Blockable} blockable
 */
function BlockableWrapper(blockable) {
	this._target = blockable;
	this._isblocked = false;
}

BlockableWrapper.prototype.block = function() {
	if (this._isblocked) return;
	this._target.block();
	this._isblocked = true;
};

BlockableWrapper.prototype.unblock = function() {
	if (!this._isblocked) return;
	this._target.unblock();
	this._isblocked = false;
};

/**
 * Call either block or unblock depending on given parameter
 *
 * @param {boolean} blocked True to block, false to unblock
 */
BlockableWrapper.prototype.setBlocked = function(blocked) {
	if (blocked) {
		this.block();
	} else {
		this.unblock();
	}
};

module.exports = {
	BlockableWrapper: BlockableWrapper,
};
