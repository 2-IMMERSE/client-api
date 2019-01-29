SYNCKIT_COMMIT=5758a2278442e5129b89e7abb3e7fa6af768f8df
HBBTV_ORIG_COMMIT=64e86762aa5427cb9adbff744902197e3e260a55

.PHONY: build run preinstall pre-build cordova-clean clean default

default: build

pre-build: synckit cordova-plugin-hbbtv www $(shell [ -e ".config.xml.prev" -a "`git show @:./config.xml`" != "`cat .config.xml.prev 2> /dev/null`" ] && echo "cordova-clean")
	git show @:./config.xml > .config.xml.prev
	git -C synckit checkout -q -f $(SYNCKIT_COMMIT)
	[ "`git -C cordova-plugin-hbbtv rev-parse @^{tree}`" = "1818f8a5b409577780aff2eb911229aa34d7e3e6" ] || { git -C cordova-plugin-hbbtv checkout -q -f $(HBBTV_ORIG_COMMIT) ; git -C cordova-plugin-hbbtv am ../cordova-plugin-hbbtv.am ; }
	cordova prepare --no-insight
	[ -d platforms/android ] || cordova platform add android --no-insight

synckit:
	git clone -n https://github.com/2-IMMERSE/cordova-synckit-android.git synckit

cordova-plugin-hbbtv:
	git clone -n https://github.com/fraunhoferfokus/cordova-plugin-hbbtv.git cordova-plugin-hbbtv

build: pre-build
	cordova build android --no-insight

run: pre-build
	cordova run android --no-insight

www:
	mkdir -p www

preinstall:
	$(MAKE) -C ../.. npm-install-lib npm-install-libcomp npm-install-libtvemu npm-install-components npm-install-deps

cordova-clean:
	rm -fr platforms
	rm -fr plugins
	rm -fr .config.xml.prev
	rm -fr package-lock.json
	rm -fr node_modules

clean: cordova-clean
	rm -fr synckit
	rm -fr cordova-plugin-hbbtv
	rm -fr www
