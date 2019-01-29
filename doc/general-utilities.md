### General utilities

The client-api includes various general utilities which are useful for development of components, DMApps and the client-api in general.

Information on communications, signalling, ref-counting, etc. mechanisms is in [Intra-client communications, signalling, and data: strategies and suggestions](comms-signalling-data.md) documentation, rather than this document.

General information on component development is in the [General component documentation](component.md), rather than this document.

General information on component parameters is in the [Component parameters documentation](component-params.md), rather than this document.


Full details are included in the relevant documentation, rather than this document.

This document is not exhaustive.


#### Controller
* [DMAppController](../jsdoc/DMAppController.html): Top-level controller class which is the "entry-point" for running instances of the client-api, this has various documented options, methods and members which are worth noting.


#### Logging

* [Logger](../jsdoc/Logger.html): Logger class, components and other entities are allocated these already.
* See also: [component logger instance](../jsdoc/DMAppComponent.html#logger), [createNamedLogger](../jsdoc/DMAppController.html#createNamedLogger).


#### Network communication

* [AjaxPromise](../jsdoc/AjaxPromise.html): Used for making network requests (e.g. HTTP), includes logging, auto-retry, signal-interaction, etc.
* Use [ajaxPromise](../jsdoc/DMAppController.html#ajaxPromise) or [ajaxPromiseNX](../jsdoc/DMAppController.html#ajaxPromiseNX) to get an instance with sensible defaults.


#### Control flow

* [ExecValve](../jsdoc/ExecValve.html): Blockable utility wrapper to queue or exec functions.
* [PromiseExecQueue](../jsdoc/PromiseExecQueue.html): Blockable queue for serialised execution of job functions.
* [Blockable](../jsdoc/Blockable.html), [BlockableWrapper](../jsdoc/BlockableWrapper.html): Useful interfaces related to blockables, see also [BlockCountSignal](../jsdoc/Signal.BlockCountSignal.html) in [Intra-client communications, signalling, and data: strategies and suggestions](comms-signalling-data.md) documentation.
* [RefCountedDelayedDestructor](../jsdoc/ResourceMgmtUtil.RefCountedDelayedDestructor.html): Reference counter with delayed destructor semantics.
* [retryPromise](../jsdoc/global.html#retryPromise): Utilitity to auto-retry a promise-returning job function.
* [waitable](../jsdoc/global.html#waitable): Promise wrapper utility with external resolve/reject methods.
* [PromiseUtil](../jsdoc/PromiseUtil.html): Promise utilities: Promise.all() for objects.
* [UpdateUtil](../jsdoc/UpdateUtil.html): Utilities for updates in async contexts (perform update call(s) when something is in a writable/ready state).
* See [Intra-client communications, signalling, and data: strategies and suggestions](comms-signalling-data.md) documentation in general.


#### Clock management

* See various members and methods of [DMAppTimeline](../jsdoc/DMAppTimeline.html).
* [ClockArrayIntervalScheduler](../jsdoc/ClockArrayIntervalScheduler.html): Clock array interval scheduler
* Low-level media/clock sync tools in: [MediaElementClockSource](../jsdoc/MediaElementClockSource.html), [MediaSynchroniser](../jsdoc/MediaSynchroniser.html).
* Miscellaneous low-level utilities in: [ClockSyncUtil](../jsdoc/ClockSyncUtil.html) and [UpdateSharedStateClockProperty](../jsdoc/DMAppTimeline.SharedStateSyncUtil.html#.UpdateSharedStateClockProperty).


#### Components
* [DMAppComponent](../jsdoc/DMAppComponent.html): DMApp component interface, this has many documented methods, members, etc. which are worth noting.
* [DMAppComponentWrapper](../jsdoc/DMAppComponentWrapper.html): Wrap a generic HTML element as a component.
* [CustomElementUtil](../jsdoc/CustomElementUtil.html): Utilities for custom elements/webcomponents and HTML imports.
* See methods of [DMAppLayout](../jsdoc/DMAppLayout.html), [ComponentContainer](../jsdoc/ComponentContainer.html) for various local operations on components.


#### Local layout
* [DMAppLayout](../jsdoc/DMAppLayout.html): General local layout handling.
* [DMAppLayoutRegionCtl](../jsdoc/DMAppLayoutRegionCtl.html): Local layout region control.


#### Debugging
* See [component dumpDebugInfo](../jsdoc/DMAppComponent.html#dumpDebugInfo) and [DebugDumper](../jsdoc/DebugMiscUtil.DebugDumper.html) for debug dumping from components (into the debug component, for example).


#### Input
 * [InputDocument](../jsdoc/InputDocument.html): Input document handling and processing.
 * [InputUtil](../jsdoc/InputUtil.html): Input handling utilities: check if a string is in the list of permitted values, parse a string into a boolean.


#### Test interface
* [TestConfigTestComponent](../jsdoc/TestComponents.TestConfigTestComponent.html): Test interface component and page: parameters, config, usage, etc.


#### Media

* [Controller key store](../jsdoc/DMAppController.html#keyStore): Key store for encryption keys on local device.
* [DMAppAVPlayerComponent](../jsdoc/DMAppAVPlayerComponent.html): General interface for media player components.
* [Video/audio component](component-params.md): General info and parameter documentation.
* [muteAll](../jsdoc/DMAppController.html#muteAll): Convenient way to mute all media components.


#### Error management

* [ErrorUtil](../jsdoc/ErrorUtil.html): Error flags/signals, see various `errorSignals` and `userError*` members of [DMAppController](../jsdoc/DMAppController.html).


#### TV emulator device
* [DMAppTvEmuController](../jsdoc/DMAppTvEmuController.html): TV emulator discovery server control and app2app functionality.
* [DMAppTvEmuSync](../jsdoc/DMAppTvEmuSync.html): TV emulator DVB-CSS sync master functionality.


#### Companion device
* [DMAppComp](../jsdoc/DMAppComp.html): Companion device module/class.
* [setupCompanionPlatformSpecificDiscovery](../jsdoc/DMAppComp.html#setupCompanionPlatformSpecificDiscovery): Method to setup discovery on companion.
* [DMAppCompDiscoveryFilter](../jsdoc/DMAppCompDiscoveryFilter.html): Utility class to filter a set of discovered devices.


#### Versioning
* [FeatureVersionSet](../jsdoc/VersionUtil.FeatureVersionSet.html): Feature version set, each top-level module has one of these.


#### Miscellaneous

* [argCheck](../jsdoc/global.html#argCheck): Function to do basic validation on function arguments.
* [TimeoutHandler](../jsdoc/TimeoutHandler.html): Utility wrapper around setTimeout with cancellation.
* [EnumUtil](../jsdoc/EnumUtil.html): Utilities for handling of enumeration types.
* [MiscUtil](../jsdoc/MiscUtil.html): Various utilities.
  * Read-only wrappers
  * Object stringification helper
  * Efficient event forwarding
