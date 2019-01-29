#!/bin/sh

../../build-tools/get_version.sh > www/version
exec make -C "$1/../.." test/ios-general-test/www/index.html
