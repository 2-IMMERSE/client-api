#!/bin/sh

../../build-tools/get_version.sh > www/version
date --rfc-3339=seconds > www/build-date
exec make -C "$1/../.." test/android-general-test/www/index.html
