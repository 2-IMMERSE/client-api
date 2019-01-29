### Building

To build all the things (except Cordova apps) (this installs dependencies as necessary):
Run `make all` from the root directory


### Installation

To install all the things (except Cordova and its dependencies), without building anything:
Run `make npm-install` from the root directory


### Browser Tests

For each of the non-Android test subdirectories (general-test).

Run `make build` to build.

To output a single vulcanized HTML file run `make vulcanize` in the directory.
Note that this does not generate source maps, use the non-vulcanized version for debugging.

To install the required subset of general client-api dependencies without building anything or setting up Cordova: run `make preinstall`.


#### Serving pages:

The root dir of your server should the parent of this directory (the client-api repo root) or an ancestor of it.
file:// URLs may be used if using the vulcanized/bundled test pages, or if browser security restrictions are bypassed, see below.


### Android Tests

For each of the Android test subdirectories (android-general-test).

In addition to the dependencies required for Browser Tests, as installed above, you will need Cordova to be installed: `npm install -g cordova`

Run `make build` to build.
Run `make run` to build and run.

To clear the Cordova state: run `make cordova-clean`.
To install the required subset of general client-api dependencies without building anything or setting up Cordova: run `make preinstall`.


### iOS Tests

For each of the iOS test subdirectories (ios-general-test).

You will need a Mac to build for iOS.

In addition to the dependencies required for Browser Tests, as installed above, you will need Cordova and ios-deploy to be installed:

```
[sudo] npm install -g cordova
[sudo] npm install -g [--unsafe-perm=true] ios-deploy
```

It is recommended that the Cordova version is >= *7.0.1*. You can check this by running `cordova -v`.

Whether you have to use `sudo` depends on your permission setup, and the `unsafe-perm` option is required if you are using OSX 10.11 or greater.

If you have not already installed the xcode command line tools, you will need to do so using: `xcode-select --install`

Run `make pre-build`.

This will create an xcode project.
You will need to use xcode to set up iOS dev account team names/etc, and if necessary resolve any other build environment requirements/issues, etc.
The xcode project can be found at `./platforms/ios/2-Immerse iOS General Test 1.xcodeproj/`. Open it in xcode, then double click the project (on the left) and set the developer team name.
See the [documentation](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/#open-a-project-within-xcode) for more details.

Run `make run` to build and run on an iOS device.
(Run `make build` to build for the simulator, note that not all plugins currently support this, so this will fail).

For further details on Cordova setup on iOS, see the [Cordova iOS documentation](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/)

To clear the Cordova state: run `make cordova-clean`, after executing this, the xcode project signing key steps will need to be performed again.
To install the required subset of general client-api dependencies without building anything or setting up Cordova: run `make preinstall`.


##### Resolved issues

>> Note (by Jack): on my machine (OSX 10.12.5, Xcode 8.3.3, npm 3.10.10, cordova 7.0.1) I had to manually add the `AsyncSocket.framework`, `SimpleLogger.framework`, `JSONModelFramework.framework` and `DIALDeviceDiscovery.framework` frameworks to the _Embedded Binaries_ section of _Project Navigator_ -> _Target_ -> _General_. Failure to do so gave an error "_dyld: [.....] image not found_" on run.
>
>This should be fixed as of af4bb8a2 (see also bd69c44b)


### Service URLs:

To use non-default service URLs, use the test pages at `general-test/`, `android-general-test/` or `ios-general-test/`, which include a mechanism to override the service URLs used at run-time.
Otherwise change the defaults in /lib/DMAppController.js
The 'standalone without services' mode of the general test pages do not use local or remote services except where otherwise required.

The layout and websocket services currently do not set CORS headers, browser CORS policies will need to be bypassed.


### Browser security policy

When using chrome/chromium, browser security can be disabled using the `--disable-web-security` switch.
Use of the `--user-data-dir=PATH` switch to use an isolated profile may also be useful.


### Running local services

The `run_local_servers.sh` script can be used to conveniently run services locally, run with no arguments for usage instructions.
In the case where both local services are to be run locally, use: `run_local_servers.sh -T -c`.
