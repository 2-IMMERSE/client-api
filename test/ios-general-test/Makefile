.PHONY: build run preinstall pre-build cordova-clean clean default

default: build

pre-build: cordova-dialclient $(shell [ -e ".config.xml.prev" -a "`git show @:./config.xml`" != "`cat .config.xml.prev 2> /dev/null`" ] || echo "cordova-clean")
	git show @:./config.xml > .config.xml.prev
	[ "`git -C cordova-dialclient rev-parse @^{tree}`" = "0d801abd56c3a155b92e8fe0b1f9691ee2d15adb" ] || { git -C cordova-dialclient checkout -q -f "d103ef9b1bf84a63e478916c381eac66a42135b0" ; git -C cordova-dialclient am ../cordova-plugin-dialclient.am ; }
	mkdir -p www
	[ -d platforms/ios ] || cordova platform add ios --nosave

cordova-dialclient:
	git clone -n https://github.com/bbc/cordova-plugin-dialclient.git cordova-dialclient

build: pre-build
	cordova build ios

run: pre-build
	cordova run ios

preinstall:
	$(MAKE) -C ../.. npm-install-lib npm-install-libcomp npm-install-components npm-install-deps

cordova-clean:
	rm -fr platforms
	rm -fr plugins
	rm -fr .config.xml.prev
	rm -fr package-lock.json
	rm -fr node_modules

clean: cordova-clean
	rm -fr cordova-dialclient
	rm -fr www
