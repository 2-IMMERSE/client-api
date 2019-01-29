### Component Requirements

A 'component' is defined as an object meeting the interface defined by `DMAppComponent`, which is
defined in terms of exposing and/or overriding all properties the of mixin: `DMAppComponentBehaviour`.

A component MUST:
* Satisfy the interface defined by `DMAppComponent` which is defined in terms of `DMAppComponentBehaviour`.
* Mix-in, inherit, extend, or otherwise expose all properties of `DMAppComponentBehaviour` which are not overridden
  by the component, either directly or via intermediary behaviours/mixins/classes.
* Return a valid `HTMLElement` from the `getComponentElement()` method, or null/undefined.

A component SHOULD:
* Always return the same value from the `getComponentElement()` method.
  If the return value changes during the lifetime of the component, the resulting behaviour is undefined.

A component MAY:
* Return a reference to itself in the `getComponentElement()` method (i.e. `return this;`)
  (this is the default defined in `DMAppComponentBehaviour`).
  This requires that the component is itself a `HTMLElement`.
* Return a reference to a seperate `HTMLElement` object in the `getComponentElement()` method.
  This requires that the default implementation in `DMAppComponentBehaviour` is overriden.
* Return null/undefined in the `getComponentElement()` method.

The HTMLElement returned by the `getComponentElement()` method MAY be a Web Component and/or a custom element.

### Component Construction

* Components construction is specified using the tuple formed by: component ID, component class, component URL.
* See 'HTML Imports' section for the meaning of 'component URL'.
* The `dMAppComponentTypes` map contains key value pairs of component class to `DMAppComponentConstructorFunction` constructor function.
* If the `dMAppComponentTypes` map contains a key equal to the component class, the corresponding constructor function is invoked using `operator new(DMAppController)`. The return value is the constructed component.
  * If invoking `operator new(DMAppController)` throws a TypeError which includes (case-insensitive) the string: 'This constructor should be called without arguments', construction is re-tried using `operator new()`, this is for compatability with custom elements.
* The `DMAppComponentConstructorFunction` constructor function SHOULD NOT call `initDMAppComponent()`, this will be called after construction.
* The `DMAppComponentConstructorFunction` constructor function MUST return a valid component.
* If the `dMAppComponentTypes` map does not contains a key equal to the component class, and the component class looks like a custom element tag name
  (matches the regexes: `/^[-0-9a-z]+$/i` and `/[0-9a-z]-+[0-9a-z]/i`), an element is created using a tag name equal to the component class.
  * If the created element is a valid component, it is used as-is.
  * If the created element is not a valid component:
      * If the created element appears to have constructed from a registered custom element, it is wrapped using `DMAppComponentWrapper`.
      * Otherwise, component construction is aborted.
* If construction by means of a custom element tag name is not intended, it is RECOMMENDED that component class names and the corresponding keys in the `dMAppComponentTypes` map
  use CamelCased names which cannot be used to create a custom element, instead of dash-separated names.

### HTML Imports
* The component URL MAY be null/blank/empty, in which case no HTML import is used.
* If the component URL is non-null and has non-zero length, the URL is loaded as a HTML import (i.e. by appending
  a `<link rel="import" />` tag to the document), and component construction occurs after the import and its dependencies
  have completed loading.
* A HTML import MAY recursively load further HTML imports.
* A HTML import MAY:
  * Add zero or more `DMAppComponentConstructorFunction` constructors to the `dMAppComponentTypes` map.
  * Register zero or more custom elements.
  * Perform zero or more other actions.
* A HTML import SHOULD avoid polluting the global JavaScript scope as much as possible.
* A HTML import SHOULD avoid assuming that global JavaScript variables have been defined, except where documented.
* A HTML import SHOULD define any local JavaScript variables that are required within an IIFE or equivalent isolated scope.
* A HTML import SHOULD avoid adding/removing/modifying JavaScript, CSS, DOM nodes, etc. in the global scope which are likely
  to interfere with operation of other components, functionality and/or modules.
* It is RECOMMENDED that a HTML import which is specified as a component URL, defines the constructor and/or custom element
  which is referenced by the corresponding component class, but this is not strictly required.

### Component Implementation Options
* The variable `Polymer` SHALL be available at global scope. The Polymer library MAY be used to create custom elements.
  * The created custom element MAY itself be a component, by use of the Polymer's behaviour mechanism.
      * The return value of the Polymer() method is a constructor function which MAY be inserted directly into the `dMAppComponentTypes` map.
      * Any other constructor function which creates such an element MAY be inserted directly into the `dMAppComponentTypes` map.
  * The Polymer documentation should be read, in particular component developers should familiarise themselves with the concepts of shadow/shady DOM, and the Polymer-specific DOM and CSS manipulation functions.
      * Particularly useful/relevant methods include: `scopeSubtree`, `updateStyles`, `$$`, `Polymer.dom`.
  * The Polymer library is loaded with the global settings: `lazyRegister: true`, `passiveTouchGestures: true`, and `useNativeCSSProperties: true`.
* Custom elements and/or Web Components MAY be created using other libraries/mechanisms/etc,
  or an arbitrary `HTMLElement` which is not a Web Component, custom element and/or the output of Polymer may be used.
  * The created element MAY itself be a component, by use of prototype extension and/or equivalent mechanisms.
      * A constructor function which creates such an element MAY be inserted directly into the `dMAppComponentTypes` map.
* A constructor function which creates a valid component which returns an element of one or more of the forms above
  in its `getComponentElement()` method MAY be inserted directly into the `dMAppComponentTypes` map.
  * This constructor function MAY be implemented by extension of the `DMAppComponentWrapper` class, or by implementing equivalent functionality.
* A custom element MAY be registered using Polymer, `document.registerElement()`, or any other equivalent mechanism.
  * The component class MAY be set to the registered element's tag name to construct the custom element directly,
    if no constructors is defined in the `dMAppComponentTypes` map with the same component class name.
      * If the custom element is not itself a valid component, it will be wrapped using `DMAppComponentWrapper`.
        This is useful for static UI elements.
* It is RECOMMENDED that components which are AV players, mix-in, inherit, extend and/or otherwise include the `DMAppAVPlayerComponentBehaviour`
  behaviour mix-in; this extends the `DMAppComponentBehaviour` mix-in.

### Non-Requirements
* Use of Polymer is not required.
* Use of Web Components is not required.
* Use of custom elements is not required.
* Components are not required to also be their own element.
* Components are not required to be a separate object from their own element.
* Implementation of 2-Immerse specific code for components is not required if the component is a custom element which
  does not require 2-Immerse functionality and can therefore be automatically wrapped using `DMAppComponentWrapper`.
* Implementation of 2-Immerse specific code is not required to be in the same file, module, scope or object as a custom element
  or other form of element and/or object/class/function/module implementing functionality to be exposed by the component. A component
  may be written which wraps zero or more external items of functionality. This may be implemented by use, extension or re-implementation
  of the `DMAppComponentWrapper` class or otherwise. This can be conveniently done by use of a HTML import which recursively loads its own dependencies.
