/************************************************************************/
/* FILE:                StateMapping.js                                 */
/* DESCRIPTION:         DMApp component shared state mapping            */
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

const inherits = require('inherits');

/**
 * Namespace for shared state mapping descriptors
 *
 * @namespace StateMapping
 */

/**
 * @classdesc
 *
 * Base type of shared state mapping descriptors.
 * This type is not directly constructable.
 *
 * @abstract
 * @memberof StateMapping
 *
 * @constructor
 */
function SharedStateMappingBase() {
}

SharedStateMappingBase.prototype.setup = function(component, logger) {
	Object.defineProperties(this, {
		component:            { value: component },
		logger:               { value: logger },
	});
};

SharedStateMappingBase.prototype.getName = function() {
	return this.name;
};

SharedStateMappingBase.prototype.getGroupPath = function() {
	throw new Error("Unimplemented");
};

SharedStateMappingBase.prototype.setSetupClosure = function(setup) {
	throw new Error("Unimplemented");
};

SharedStateMappingBase.prototype.getPropertyPrefixSeparator = function() {
	return "\u00A7";
};

function ContextGroupSharedStateMappingBase(options) {
	if (!options) options = {};
	Object.defineProperties(this, {
		options:              { value: options },
	});
}
inherits(ContextGroupSharedStateMappingBase, SharedStateMappingBase);

ContextGroupSharedStateMappingBase.prototype.getGroupPath = function() {
	const layoutContextId = this.options.contextIdOverride || (this.options.dynamicContextId ? this.component.dMAppController.layout.contextId : this.component.dMAppComponentContextId);
	if (this.currentStatePath && layoutContextId) {
		return {
			path: '/context/' + layoutContextId + '/' + this.currentStatePath,
			propertyPrefix: this.currentPropertyPrefix,
		};
	} else {
		return null;
	}
};

ContextGroupSharedStateMappingBase.prototype.setSetupClosure = function(setup) {
	if (!this.options.contextIdOverride && this.options.dynamicContextId) {
		this.component.listenerTracker.subscribeTo(this.component.dMAppController.layout).on('contextChange', setup);
	}
	this.setContextPathSetupClosure(function(statePath, propertyPrefix) {
		if (statePath !== this.currentStatePath || propertyPrefix !== this.currentPropertyPrefix) {
			this.currentStatePath = statePath;
			this.currentPropertyPrefix = propertyPrefix;
			setup();
		}
	}.bind(this));
};

ContextGroupSharedStateMappingBase.prototype.setContextPathSetupClosure = function(setPath) {
	throw new Error("Unimplemented");
};

/**
 * @classdesc
 *
 * State mapping of the per-context shared state group defined by the value of a component config parameter. The parameter name defaults to 'groupStateId'.
 *
 * The shared state path is given by: /context/{context ID}/state
 * The property prefix is given by group/{value of (by default 'groupStateId') component parameter}
 * No shared state mapping is created until the component parameter from which the group name is read has a non-empty/truthy value.
 *
 * @memberof StateMapping
 * @extends StateMapping.SharedStateMappingBase
 *
 * @constructor
 * @param {Object=} options Optional options object
 * @param {string=} options.contextIdOverride Optional group mapping context ID override
 * @param {string=} options.parameterName Optional component config parameter name to use for the group name, default: groupStateId, (note that this is the name of the parameter from which the shared state group name is read from, not the group name itself)
 */
function ContextGroupParameterSharedStateMapping(options) {
	ContextGroupSharedStateMappingBase.call(this, options);
	Object.defineProperties(this, {
		paramName:            { value: this.options.parameterName || 'groupStateId' },
	});
	Object.defineProperties(this, {
		name:                 { value: "Per-context state: Group parameter: " + this.paramName },
	});
}
inherits(ContextGroupParameterSharedStateMapping, ContextGroupSharedStateMappingBase);

ContextGroupParameterSharedStateMapping.prototype.setContextPathSetupClosure = function(setPath) {
	const self = this;
	const check = function() {
		const parameters = self.component.configParameterSignal.getValue();
		if (parameters[self.paramName]) {
			setPath('state', 'group/' + parameters[self.paramName]);
		} else {
			setPath(null, null);
		}
	};
	self.component.configParameterSignal.on("change", check);
	check();
};

/**
 * @classdesc
 *
 * State mapping of the per-context global shared state group.
 *
 * The shared state path is given by: /context/{context ID}/global
 * or if options.path is given, by: /context/{context ID}/{options.path}
 *
 * The property prefix is given by {options.propertyPrefix}
 *
 * @memberof StateMapping
 * @extends StateMapping.SharedStateMappingBase
 *
 * @constructor
 * @param {Object=} options Optional options object
 * @param {string=} options.contextIdOverride Optional group mapping context ID override
 * @param {string=} [options.path=global] Optional shared state path, this defaults to: 'global'
 * @param {string=} [options.propertyPrefix=] Optional shared state property prefix
 */
function ContextGlobalSharedStateMapping(options) {
	ContextGroupSharedStateMappingBase.call(this, options);
	Object.defineProperties(this, {
		path:                 { value: this.options.path ? this.options.path : 'global' },
		propertyPrefix:       { value: this.options.propertyPrefix ? this.options.propertyPrefix : '' },
	});
	Object.defineProperties(this, {
		name:                 { value: "Per-context state: Global: " + this.path + (this.propertyPrefix ? ", prefix: " + this.propertyPrefix : "") },
	});
}
inherits(ContextGlobalSharedStateMapping, ContextGroupSharedStateMappingBase);

ContextGlobalSharedStateMapping.prototype.setContextPathSetupClosure = function(setPath) {
	setPath(this.path, this.propertyPrefix);
};

/**
 * @classdesc
 *
 * Setup mapping of component parameters or element attributes to a shared state group given by a complete static path.
 * Per-context paths SHOULD NOT be used, use {@link StateMapping.ContextGlobalSharedStateMapping} instead
 *
 * @memberof StateMapping
 * @extends StateMapping.SharedStateMappingBase
 *
 * @constructor
 * @param {string} path Complete shared state path
 * @param {string=} propertyPrefix Optional shared state property prefix
 */
function StaticPathSharedStateMapping(path, propertyPrefix) {
	if (!propertyPrefix) propertyPrefix = null;
	let name = "Static path: " + path;
	if (propertyPrefix) name += ", prefix: " + propertyPrefix;
	Object.defineProperties(this, {
		path:                 { value: path },
		propertyPrefix:       { value: propertyPrefix },
		name:                 { value: name },
	});
}
inherits(StaticPathSharedStateMapping, SharedStateMappingBase);

StaticPathSharedStateMapping.prototype.setup = function() {
	SharedStateMappingBase.prototype.setup.apply(this, arguments);
	if (this.path.indexOf('/context/') === 0) {
		this.logger.warn('Shared state paths starting with "/context/" should not be used with StaticPathSharedStateMapping');
	}
};

StaticPathSharedStateMapping.prototype.getGroupPath = function() {
	return {
		path: this.path,
		propertyPrefix: this.propertyPrefix,
	};
};

StaticPathSharedStateMapping.prototype.setSetupClosure = function(setup) {
	setup();
};

try {
	Object.freeze(SharedStateMappingBase.prototype);
	Object.freeze(ContextGroupSharedStateMappingBase.prototype);
	Object.freeze(ContextGroupParameterSharedStateMapping.prototype);
	Object.freeze(ContextGlobalSharedStateMapping.prototype);
	Object.freeze(StaticPathSharedStateMapping.prototype);
} catch (e) {
	/* swallow: doesn't matter too much if this fails */
}

module.exports = {
	ContextGroupParameterSharedStateMapping: ContextGroupParameterSharedStateMapping,
	ContextGlobalSharedStateMapping: ContextGlobalSharedStateMapping,
	StaticPathSharedStateMapping: StaticPathSharedStateMapping,
};
