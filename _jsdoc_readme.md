## Client API:

### Directory structure:

* `example-boilerplate/`
  Example boilerplate files to get started with
* `lib/`
  Main library common to all in-browser components/libraries
* `libcomp/`
  Companion library common to all companions
* `libcompemu/`
  Companion emulation library, for use with `server-compemu/`
* `libtvemu/`
  TV emulation library, for use with `server-tvemu/`
* `libandroid/`
  Android Cordova interface library
* `libios/`
  iOS Cordova interface library
* `components/`
  DMApp components
* `server-compemu/`
  Companion emulation server, implements DIAL discovery
* `server-tvemu/`
  TV emulation server, implements DIAL server and HbbTV app2app websockets proxy
* `bundle/`
  Source for dist bundles
* `test/`
  Test pages
* `test/general-test/`
  General test page
* `test/android-general-test/`
  General Android Cordova test page app
* `test/ios-general-test/`
  General iOS Cordova test page app
* `test/test-components/`
  General test DMApp components
* `build-tools/`
  Common build tool dependencies
* `deps/`
  Common dependencies
* `doc/`
  General documentation
* `jsdoc/`
  Auto-generated JSDoc documentation is output here
* `dist/`
  Tarball of 'dist' outputs is generated in here, see: `make tarball` below
* `build/`
  Temporary build files

### Building

To build everything, ensure Docker is installed and:
Run `make -f Makefile.docker GIT_PRIVATE_KEY_FILENAME=~/.ssh/<private-git-key> all`

This creates a docker image called 'bbcrd-clientapi-builder' containing the build tools and SDKs necessary to compile the client API and tests. There is no need to install Cordova, Gradle or the Android SDK on your host computer.

To build just the test applications (Android .apks etc.):
Run `make -f Makefile.docker GIT_PRIVATE_KEY_FILENAME=~/.ssh/<private-git-key> android-general-test`

Any target defined in 'Makefile' can be specified to 'Makefile.docker' instead to have the build execute within the docker container instead of the host computer.

The build can be invoked on the host computer. This can be achieved as follows:

To install all the things:
Run `make npm-install` from the root directory

To build all the things:
Run `make all` from the root directory

To build the jsdoc code documentation:
Run `make docs` from the root directory, the output is written into the jsdoc/ directory. The [jsdoc/index.html file](../jsdoc/index.html) file can then be opened in a web browser.

To build just the vulcanized test pages and their dependencies:
Run `make vulcanize` from the root directory

To build just the libs (this is enough to run the non-vulcanized test pages):
Run `make` or `make libs` from the root directory

To make `make` go faster, use the `-j` switch.


### Documentation

JSDoc documentation:
* To build: run `make docs` from the root directory.
* Documentation will be placed in `jsdoc/`.

See the [doc/ directory](../doc/) for general documentation.
This includes:
* [General component documentation](doc/component.html)
* [App2app protocol documentation](doc/app2app-protocol.html)
* [Component parameters documentation](doc/component-params.html)
* [Intra-client communications, signalling, and data: strategies and suggestions](doc/comms-signalling-data.html)
* [General utilities](doc/general-utilities.html)

See [Test page readme](test/readme.html) for documentation of the test pages in the test directory.


### Services

The client library and tests require the use of local and/or remote services.

The `test/run_local_servers.sh` script in the test directory can be used to conveniently run the local services below, see the [test page readme](test/readme.html).

#### Local services, for browser clients

TV emulator clients currently expects local services at the URLs below:
* server-tvemu server: ws://127.0.0.1:7692/
* dvbcsstv-lib server: ws://127.0.0.1:7681/

Companion emulator clients currently expect a local service at the URL below:
* server-compemu server: ws://127.0.0.1:7693/

Local functionality will still work if the remote services are unavailable or not being used.

#### Test pages

The test pages at `test/general-test/`, `test/android-general-test/` and `test/ios-general-test/` include a mechanism to override the service URLs used at run-time.
The 'standalone without services' mode of the general test pages does not use local or remote layout, timeline or websocket services.

See the [test page readme](test/readme.html) for installation, setup, and usage information.

### Other build targets

Individual lib directories or output files can be passed as arguments to make for a partial build.
Partial installs or lints can be specified as `make npm-install-DIR` or `make lint-DIR` respectively.

To delete all built files:
Run `make clean` from the root directory

To lint files:
Run `make lint` from the root directory

To generate a tarball of all the 'dist' outputs:
Run `make tarball` from the root directory, this is output in the `dist/` directory.

### Input documents

Client input documents are JSON files which can be used to launch a DMApp.

The syntax is documented [here](../jsdoc/InputDocument.html#.InputDocumentObject).


### Code policy

#### Backwards compatibility

Where pragmatic, existing DMApps, components, test pages, services, etc. outside of this repo should not be broken by future updates.

If method/etc. is not documented, it is more or less fair game to be removed or refactored away.

If a documented method is not observably used externally by anyone, it may still be removed or refactored away.

Documented methods which are observably used externally may still be replaced with an undocumented stub which implements the old behaviour required for backwards compatibility in terms of a newer mechanism.

#### Versioning

Feature updates/additions which are "significant" should update an appropriate `FeatureVersions.js` file accordingly.  
These may be checked in future by external codebases such as components in the case where both: use of new functionality where available, and backwards compatibilty with older non-supporting client-api versions, are required.


### Licence and Authors

All code and documentation is licensed by the original author and contributors under the Apache License v2.0:

* [British Telecommunications (BT) PLC](http://www.bt.com/) (original author)
* [British Broadcasting Corporation](http://www.bbc.co.uk/rd)
* [Institut für Rundfunktechnik](http://www.irt.de/)
* [Centrum Wiskunde & Informatica](http://www.cwi.nl/)

See AUTHORS.md file for a full list of individuals and organisations that have
contributed to this code.

### Contributing

If you wish to contribute to this project, please get in touch with the authors.



<img src="https://2immerse.eu/wp-content/uploads/2016/04/2-IMM_150x50.png" align="left"/><em>This project was originally developed as part of the <a href="https://2immerse.eu/">2-IMMERSE</a> project, co-funded by the European Commission’s <a hef="http://ec.europa.eu/programmes/horizon2020/">Horizon 2020</a> Research Programme</em>
### Version
Generated from: 8a38266 (public-release)
