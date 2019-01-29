### Intra-Client Communications, Signalling, and Data: Strategies and Suggestions

The client-api includes a number of different mechanisms and channels for communication, between and within components, DMApps, devices, contexts, etc.

These include:

#### Signals  

Signals are observable variables which can be used for various types of communication and signalling at a number of different scopes. See [here](../jsdoc/Signal.html) for full details.

Key signal types/scopes include:

* Local settable signals: These are scoped to within a single device. These can be anonymous or named.  
  See [../jsdoc/DMAppController.html#localSignalMap](localSignalMap), [SettableSignal](../jsdoc/Signal.SettableSignal.html).
* Local reference count signals: These have reference count semantics and are scoped to within a single device. These can be anonymous or named.  
  Block count signals have similar reference-count functionality but differing semantics (negative instead of positive usage).  
  See [localRefCountSignalMap](../jsdoc/DMAppController.html#localRefCountSignalMap), [RefCountSignal](../jsdoc/Signal.RefCountSignal.html), [BlockCountSignal](../jsdoc/Signal.BlockCountSignal.html).
* Shared signals: These are scoped to within the local set of devices (generally this is the same as the DMApp and Context). These are named. These are by nature asynchronous.  
  See [getSharedSignal](../jsdoc/DMAppController.html#getSharedSignal), [setSharedSignal](../jsdoc/DMAppController.html#setSharedSignal), [setSharedSignalCas](../jsdoc/DMAppController.html#setSharedSignalCas).
* Local per-device signals: These are scoped to within a single device, however an aggregated read-only view (merged per-device signals) of the different per-device values of an individual signal name is scoped to within the local set of devices.  
  These are named. The aggregated views (merged per-device signals) are by nature asynchronous.  
  See [localPerDeviceSignalMap](../jsdoc/DMAppController.html#localPerDeviceSignalMap), [getMergedPerDeviceSignal](../jsdoc/DMAppController.html#getMergedPerDeviceSignal), [SettableSignal](../jsdoc/Signal.SettableSignal.html).

Type-independent access mechanisms for named signals are available, see: [getSignalByName](../jsdoc/DMAppController.html#getSignalByName), [setSignalByName](../jsdoc/DMAppController.html#setSignalByName).

Signals are also used for various other internal uses, and client-api/component interfaces. See [documentation](../jsdoc/) for full details.

Signals should not be used for RPC-style interactions.

Signals support both edge and level triggered semantics, see [documentation](../jsdoc/Signal.html) for full details. Care should be taken to use an appropriate triggering/listening mechanism to ensure proper operation and avoid race conditions or unintended timing dependencies.

When using named signals, care should be taken to choose sensible and descriptive names with a low probability of name collisions.

Local signal changes are not routed via the network and do not impose additional latency, and so are suitable for local UI control.

Shared and merged per-device signals require local network communication between devices and so a small additional latency is incurred. They are still suitable for UI control across the set of local devices.

Reference count signals should be used in scenarios where an arbitrary entity should be allocated/enabled/on/etc. when one or more references to it are held, and deallocated/disabled/off/etc. when zero references to it are held.  
Block count signals should be used in scenarios where an arbitrary entity should be deallocated/disabled/off/etc. when one or more references to it are held, and allocated/enabled/on/etc. when zero references to it are held.  
(For reference count semantics with deallocation/disabling/off timer hysteresis, consider using: [RefCountedDelayedDestructor](../jsdoc/ResourceMgmtUtil.RefCountedDelayedDestructor.html) instead).

It is often useful for interfaces to provide read-only views of signals, in order to prevent undesired/unintentional modification of the current value.  
This can be achieved by mechanisms including: [ConstWrapperSignal](../jsdoc/Signal.ConstWrapperSignal.html), [makeConst](../jsdoc/Signal.SettableSignal.html#makeConst), [setAutoFreeze](../jsdoc/Signal.SettableSignal.html#setAutoFreeze).


#### App2App messaging

App2App messaging is primarily intended for RPC-style interactions between components, whether on the same or on different devices.

Components should generally create sub-handlers with descriptive names for individual sub-functions exposed over the app2app mechanism.

In the case where an action should be automatically taken whenever an item of state changes/has been changed, generally a signal should be used instead.

App2app message receive handlers may reply to messages asynchronously, by means of returning a promise. However the sender will consider the message to have timed out if no response is received within ~10s.

See [setupApp2AppRecvHandler](../jsdoc/DMAppComponent.html#setupApp2AppRecvHandler), [setSubHandler](../jsdoc/App2AppMsgBusCtl.App2AppMsgBusRecvHandler.html#setSubHandler), [sendApp2AppMsg](../jsdoc/DMAppComponent.html#sendApp2AppMsg).


#### Changing component layout and parameters via services

Layout and parameters for top-level components which are created by the timeline/layout services can be altered by sending a request to one or other of the services.

Generally this requires the layout and/or timeline documents to be pre-prepared with support for the desired change.

This requires at least one round trip to the services, is very expensive compared to local signalling/messaging, and imposes a significant latency.

This is most appropriate when it is necessary to make a change which requires the layout service to recalculate a new layout.

See [setDMAppComponentPriority](../jsdoc/DMAppLayoutIO.html#setDMAppComponentPriority), [postDMAppComponentTimelineEvent](../jsdoc/DMAppLayoutIO.html#postDMAppComponentTimelineEvent).


#### Child component parameters/config

In the case where a component creates a child component, the parent component can set and change the parameters and other fields of the child component as required.  
The most convenient way to do this is by using the Signal input type for the config.parameters field of [createChildDMAppComponent](../jsdoc/DMAppComponent.html#createChildDMAppComponent).

In general components should refrain from trying to change the parameters or other fields of components other than themselves and their direct children, however this is still permitted and occasionally useful.


#### Component parameter adjustments

A component can adjust or filter the value of its own parameters as necessary.

Most usefully, this can include parameter type checking/correction, and use of one or more signals as local parameter overrides or filter/transform inputs.

Type checking/correction is useful as the timeline service only supports flat objects with string values, whereas the layout service and client support arbitrary objects.

Parameter transforms are the most robust way to use a parameter (in the timeline document) as an external index or signal name from which to retrieve (a subset of) the actual parameters.

Parameter transforms/filtering are also useful if it is necessary to temporarily override component parameters in reponse to local conditions, without needing to create an additional abstraction layer to handle seperate operating modes.

A component may also perform these operations on its children (or on other components, subject to caveats in child components section above).

See [setExpectedConfigParameterType](../jsdoc/DMAppComponent.html#setExpectedConfigParameterType), [addEffectiveParameterSignalOverlay](../jsdoc/DMAppComponent.html#addEffectiveParameterSignalOverlay), [addEffectiveParameterSignalTransform](../jsdoc/DMAppComponent.html#addEffectiveParameterSignalTransform), [effectiveParameterSignal](../jsdoc/DMAppComponent.html#effectiveParameterSignal)


#### Component timing expressions/signals

Component universal parameters as described in the [component parameters documentation](./component-params.md) can be used to signal timing values between components on the same device.

This does not require any additional code to be written, as the expressions can be encoded in the component parameters, in the timeline document. See [setExpressionSignal](../jsdoc/DMAppController.html#setExpressionSignal) and [expr-eval](https://www.npmjs.com/package/expr-eval) for details of expression strings.

This is somewhat non-obvious to use, so generally should only be used when the more straightforward mechanisms (timeline document structure, and local mechanisms such as child components and signalling) are not suitable.


#### Organisation and topology

The client-api does not impose any topology restrictions on how DMApps/components choose to organise their communications/signalling.

However for maintenance and debugging purposes it is suggested that some form of strategy is used.

Possible suggestions include:

* If there is a need for per-device or per-DMApp centralisation of non-component-specific signals or functions, these should be encapsulated into the DMApp/input document setup component (see setupComponent field of [InputDocumentObject](../jsdoc/InputDocument.html#.InputDocumentObject)).
  * This may include things like loading/processing config files, initialising signals, processing merged per-device signals, etc.
  * Where appropriate this can be performed before the rest of the DMApp is loaded.
  * This may include local control such as adjusting the DOM or region definitions in response to changes in signal values.
* Important/interesting signal values should be exposed in the debug dump interface (typically in that of the DMApp/input document setup component) for inspection. See [dumpDebugInfo](../jsdoc/DMAppComponent.html#dumpDebugInfo).
  * It is sometimes useful to allow these signal values to be manually overridden for debugging purposes.
* Per-DMApp or per-device app2app endpoints should also be encapsulated into the DMApp/input document setup component.


#### Directly accessing other local components

It is sometimes useful for a component to acquire a direct reference to the instance of another component on the same device.  
For example the target component could expose a bespoke interface for other local components to use.

This would typically be controlled by means of specifying the ID of the target component using a parameter.

This functionality should be used with due care and attention as the holder of the reference to the component instance has full access to the target component. This includes the ability to (unintentionally or otherwise) interfere with proper operation of the target component.

In general the most straightforward and robust mechanism to do this for top-level components is by using: [getTopLevelDMAppComponentSignalById](../jsdoc/DMAppComponent.html#getTopLevelDMAppComponentSignalById).


#### Data which is automatically propagated by the client-api

Some important or generally useful data is automatically propagated between devices over the app2app channel and made available to components and other parts of the client-api, to remove the need for this to be manually implemented by DMApp or component authors.

This includes (non-exhaustive list):

* Context, DMApp, inter-context, and session IDs (TV -> companions)
* Device and instance IDs (both directions)
* Clock sync over app2app (when DVB-CSS sync is not available)
* Error signal summaries (both directions)

See [app2app protocol documentation](./app2app-protocol.md) for more details.


#### Shared state service

Components/DMApps can store and retrieve state in the shared state service.

This is organised in the form of shared state groups, which are addressed by a globally-scoped ID, each of which contain 0 or more arbitrary key-value pairs which are scoped within that shared state group.

There is a non-negligible overhead per shared state group connection, and operations on separate groups are not ordered with respect to each other.  
Therefore the number of groups in use by a DMApp is typically minimised. The most typical configuration uses 1 group per DMApp.

A (subset of) a shared state group can be overlaid onto a component parameter set using [setupSharedStateParameterOverlayMapping](../jsdoc/DMAppComponent.html#setupSharedStateParameterOverlayMapping).

Utility methods exist which can be used to automatically propagate state between a (subset of) a shared state group and custom element attributes.  
This is typically used when adding inter-component functionality to existing components which are written as non 2-immerse custom element web-components.  
This does have some caveats on ordering and permitted key values due to the restrictions of the element attribute interface, the documentation should be read carefully before use.  
See: [upgradeCustomElementIntoComponent](../jsdoc/CustomElementUtil.html#.upgradeCustomElementIntoComponent), [setupSharedStateElementAttributeMapping](../jsdoc/DMAppComponent.html#setupSharedStateElementAttributeMapping).

See also: [createSharedStateFromGroupMapping](../jsdoc/DMAppController.html#createSharedStateFromGroupMapping), and [SharedStatePropertySignal](../jsdoc/Signal.SharedStatePropertySignal.html).

All shared state changes require at least one round trip to the shared state service which adds significant latency. Therefore it should not be used for local UI changes on the same device which require immediate propagation.

The shared state service is (currently) a singleton service backed by a single MongoDB database. Therefore changes should be rate-limited and not excessively large to avoid overloading the back-end and globally interfering with shared state operations.

In general more local communications mechanisms are preferable, and use of the shared state service should be reserved for small quanitities of infrequently updated state shared between non-local devices.


#### Websocket service (generic bus)

The websocket service uses socket.io and has a generic bus namespace which can be used to setup arbitrary socket groups.

This could be used to propagate messages between non-local devices/DMApps/components.

As this namespace is shared globally, group IDs which are used should be chosen to avoid name collisions (e.g. by prefixing a suitably unique ID such as the context or session ID).

This is an event-bus type mechanism and so in general does not guarantee reliable delivery to particular clients or store messages/state for disconnected clients.  
Users of this interface will need to provide their own reliability mechanisms on top as necessary if these guarantees are required.  
Socket.io does additionally support point-to-point messaging with acknowledgements between clients and servers, however this does not imply client to client point-to-point messaging.

The client-api does not include an API/interface to use this, but does provide the socket.io client and the URL of the websocket service, which components/DMApps can use as required.
