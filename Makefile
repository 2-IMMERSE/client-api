VERSION_NEED := 3.78
ifeq ($(MAKE_VERSION),)
$(error Make is too old, does not advertise a version)
endif
ifneq ($(VERSION_NEED),$(firstword $(sort $(MAKE_VERSION) $(VERSION_NEED))))
$(error Make is too old: $(MAKE_VERSION), need at least $(VERSION_NEED))
endif

.PHONY: all libs lib libtvemu libcomp libcompemu libandroid libios vulcanize bundle-dist

.DELETE_ON_ERROR:

libs: lib libtvemu libcomp libcompemu libandroid libios

all: vulcanize libs docs

vulcanize: test/android-general-test/www/index.html test/ios-general-test/www/index.html
vulcanize: test/general-test/dist/index.html
vulcanize: bundle-dist

bundle-dist: bundle/dist/standalone-bundle.html bundle/dist/companion-emulator-bundle.html bundle/dist/tv-emulator-bundle.html
bundle-dist: bundle/dist/android-companion-bundle.html bundle/dist/android-unified-bundle.html bundle/dist/unified-companion-bundle.html

lib: dist/main/lib/client-lib.js
libtvemu: dist/main/libtvemu/tvemu-lib.js
libcomp: dist/main/libcomp/comp-lib.js
libcompemu: dist/main/libcompemu/compemu-lib.js
libandroid: dist/main/libandroid/android-lib.js
libios: dist/main/libios/ios-lib.js

ROOT = $(realpath .)
BUILD = $(ROOT)/build-tools/node_modules/.bin

VERSION = $(shell ./build-tools/get_version.sh)

define browserify
	@mkdir -p dist/smi/$1/ dist/main/$1/
	@echo "module.exports = '$(VERSION)';" > dist/smi/$1/$2.version.js
	"$(BUILD)"/browserify -r $3 -r ./dist/smi/$1/$2.version.js:__VERSION__ -d -o dist/smi/$1/$2.js
	rm dist/smi/$1/$2.version.js
endef

NPMDIRS_NODE_MODULES = lib libtvemu libcomp components server-tvemu server-compemu build-tools
NPMDIRS = $(NPMDIRS_NODE_MODULES) libcompemu

define npm-check-install-node-modules
CHECK_INSTALL_$(1) += $(shell [ -d $(1)/$(3) ] || echo "npm-install-$(1)") Makefile
endef
define npm-check-install-def
CHECK_INSTALL_$(1) += $(shell [ "`cat $(1)/$(2)`" = "`cat $(1)/.$(2).prev 2> /dev/null`" ] || echo "npm-install-$(1)") Makefile
endef
define npm-check-install-shrinkwrap-def
CHECK_INSTALL_$(1) += $(shell [ -e $(1)/npm-shrinkwrap.json ] && [ "`cat $(1)/npm-shrinkwrap.json`" != "`cat $(1)/.npm-shrinkwrap.json.prev 2> /dev/null`" ] && echo "npm-install-$(1)")
endef

UGLIFYJS_PARAMS = -c warnings=false -m -b beautify=true,indent_level=0,indent_start=0,space_colon=0

JSDOC_PARAMS =

-include Makefile.local

$(foreach dir,$(NPMDIRS_NODE_MODULES),$(eval $(call npm-check-install-node-modules,$(dir),package.json,node_modules)))
$(foreach dir,$(NPMDIRS),$(eval $(call npm-check-install-def,$(dir),package.json,node_modules)))
$(foreach dir,$(NPMDIRS),$(eval $(call npm-check-install-shrinkwrap-def,$(dir))))
$(foreach dir,deps,$(eval $(call npm-check-install-def,$(dir),bower.json,bower_components)))

dist/smi/lib/client-lib.js: $(wildcard lib/*.js) $(CHECK_INSTALL_lib) $(CHECK_INSTALL_build-tools)
	$(call browserify,lib,client-lib,./lib:DMAppClientLib -r ./lib/node_modules/socket.io-client:socket.io-client -r ./lib/node_modules/dvbcss-clocks/src/main:dvbcss-clocks -r ./lib/node_modules/dvbcss-protocols/src/main_browser:dvbcss-protocols -r events -r ./lib/node_modules/jquery/dist/jquery.js:jquery)

dist/smi/libtvemu/tvemu-lib.js: $(wildcard libtvemu/*.js) $(CHECK_INSTALL_libtvemu) $(CHECK_INSTALL_build-tools)
	$(call browserify,libtvemu,tvemu-lib, ./libtvemu:DMAppTvEmuLib -x DMAppClientLib )

dist/smi/libcomp/comp-lib.js: $(wildcard libcomp/*.js) $(CHECK_INSTALL_libcomp) $(CHECK_INSTALL_build-tools)
	$(call browserify,libcomp,comp-lib, ./libcomp:DMAppCompLib -x DMAppClientLib -x DMAppCompEmuLib -x DMAppAndroid )

dist/smi/libcompemu/compemu-lib.js: $(wildcard libcompemu/*.js) $(CHECK_INSTALL_libcompemu) $(CHECK_INSTALL_build-tools)
	$(call browserify,libcompemu,compemu-lib, ./libcompemu:DMAppCompEmuLib -x DMAppClientLib -x DMAppCompLib )

dist/smi/libandroid/android-lib.js: $(wildcard libandroid/*.js) $(CHECK_INSTALL_build-tools)
	$(call browserify,libandroid,android-lib, ./libandroid:DMAppAndroid -x DMAppClientLib -x DMAppCompLib )

dist/smi/libios/ios-lib.js: $(wildcard libios/*.js) $(CHECK_INSTALL_build-tools)
	$(call browserify,libios,ios-lib, ./libios:DMAppIos -x DMAppClientLib -x DMAppCompLib )

dist/main/%.js: dist/smi/%.js $(CHECK_INSTALL_build-tools)
	"$(BUILD)"/exorcist "$@.map" < "$<" > "$@"

dist/babel/%.js: dist/smi/%.js $(CHECK_INSTALL_build-tools)
	@mkdir -p "$(@D)"
	"$(BUILD)"/babel "$<" --presets "$(BUILD)"/../babel-preset-es2015-nostrict --compact=true -o "$@" -s
	"$(BUILD)"/uglifyjs "$@" $(UGLIFYJS_PARAMS) -o "$@" --in-source-map "$@.map" --source-map "$@.map" --source-map-url "$(@F).map"

dist/babel/test/test-components/%.js: test/test-components/%.js $(CHECK_INSTALL_build-tools)
	@mkdir -p "$(@D)"
	"$(BUILD)"/babel "$<" --presets "$(BUILD)"/../babel-preset-es2015-nostrict --compact=true -o "$@" -s
	"$(BUILD)"/uglifyjs "$@" $(UGLIFYJS_PARAMS) -o "$@" --in-source-map "$@.map" --source-map "$@.map" --source-map-url "$(@F).map"

dist/babel/%.html: %.html $(CHECK_INSTALL_build-tools)
	@mkdir -p $(@D)
	./build-tools/html-script-filter.js '"$(BUILD)"/babel --presets "$(BUILD)"/../babel-preset-es2015-nostrict --compact=true | "$(BUILD)"/uglifyjs $(UGLIFYJS_PARAMS)' < $< > dist/babel/$*.html

define vulcanize
	@mkdir -p dist/babel/$1/$2
	cd dist/babel/$1 && "$(BUILD)"/vulcanize --strip-comments $3.html --exclude cordova.js --redirect "$(ROOT)/dist/babel/deps/|$(ROOT)/deps/" \
			--redirect "$(ROOT)/dist/babel/components/deps/|$(ROOT)/components/deps/" --redirect "$(ROOT)/dist/babel/bundle/|$(ROOT)/bundle/" --redirect "$(ROOT)/dist/babel/dist/main/|$(ROOT)/dist/babel/" | \
			sed -e 's|<script src="\.\./|<script src="\.\./\.\./|g' -e 's|<script src="\([./]*\)/dist/main/|<script src="\1/dist/babel/|g' -e 's|<script src="\([./]*\)/test-components/|<script src="\1/../dist/babel/test/test-components/|g' > "$(ROOT)"/$1/$2/$3.html
endef

define vulcanize_inline
	@mkdir -p dist/babel/$1/$2
	cd dist/babel/$1 && "$(BUILD)"/vulcanize --strip-comments --inline-scripts $3.html --out-html $2/$3.html --exclude cordova.js --redirect "$(ROOT)/dist/babel/deps/|$(ROOT)/deps/" \
			--redirect "$(ROOT)/dist/babel/components/deps/|$(ROOT)/components/deps/" --redirect "$(ROOT)/dist/babel/bundle/|$(ROOT)/bundle/" --redirect "$(ROOT)/dist/babel/dist/main/|$(ROOT)/dist/babel/"
	cp dist/babel/$1/$2/$3.html $1/$2/$3.html
endef

define vulcanize_nomini
	cd $1 && "$(BUILD)"/vulcanize --strip-comments --inline-scripts $3.html --out-html $2/$3.html --exclude cordova.js
endef

VULCANIZE_DEPS_FILES = lib/client-lib.js $(wildcard components/*.html)
VULCANIZE_DEPS_OTHER = $(CHECK_INSTALL_components) $(CHECK_INSTALL_deps) $(CHECK_INSTALL_build-tools) deps/deps/polymer-min/polymer.html deps/deps/polymer-min/polymer-mini.html deps/deps/polymer-min/polymer-micro.html deps/import-polymer.html
VULCANIZE_DEPS = $(addprefix dist/babel/,$(VULCANIZE_DEPS_FILES)) $(VULCANIZE_DEPS_OTHER)
BUNDLE_VULCANIZE_DEPS = $(VULCANIZE_DEPS_FILES) $(VULCANIZE_DEPS_OTHER)
TEST_VULCANIZE_DEPS = $(VULCANIZE_DEPS) $(addprefix dist/babel/,$(wildcard test/test-components/*.html) $(wildcard test/test-components/*.js))

bundle/dist/standalone-bundle.html: bundle/standalone-bundle.html $(VULCANIZE_DEPS) | bundle/dist
	$(call vulcanize,bundle,dist,standalone-bundle)
bundle/dist/companion-emulator-bundle.html: bundle/companion-emulator-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libcompemu/compemu-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,companion-emulator-bundle)
bundle/dist/tv-emulator-bundle.html: bundle/tv-emulator-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libtvemu/tvemu-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,tv-emulator-bundle)
bundle/dist/android-companion-bundle.html: bundle/android-companion-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libandroid/android-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,android-companion-bundle)
bundle/dist/ios-companion-bundle.html: bundle/android-companion-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libios/ios-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,ios-companion-bundle)
bundle/dist/android-unified-bundle.html: bundle/android-unified-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libtvemu/tvemu-lib.js libandroid/android-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,android-unified-bundle)
bundle/dist/unified-companion-bundle.html: bundle/unified-companion-bundle.html $(VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libcompemu/compemu-lib.js libandroid/android-lib.js libios/ios-lib.js) | bundle/dist
	$(call vulcanize,bundle,dist,unified-companion-bundle)

test/general-test/dist/index.html: dist/babel/test/general-test/index.html $(TEST_VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libcompemu/compemu-lib.js libtvemu/tvemu-lib.js) | test/general-test/dist
	$(call vulcanize,test/general-test,dist,index)

test/android-general-test/www/index.html: dist/babel/test/android-general-test/js/index.html $(TEST_VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libandroid/android-lib.js libtvemu/tvemu-lib.js) | test/android-general-test/www
	$(call vulcanize_inline,test/android-general-test/js,../www,index)

test/ios-general-test/www/index.html: dist/babel/test/ios-general-test/js/index.html $(TEST_VULCANIZE_DEPS) $(addprefix dist/babel/,libcomp/comp-lib.js libios/ios-lib.js) | test/ios-general-test/www
	$(call vulcanize_inline,test/ios-general-test/js,../www,index)

SUBDIRS = bundle/dist test/general-test/dist test/android-general-test/www test/ios-general-test/www

$(SUBDIRS) deps/deps/polymer-min:
	mkdir $@

LINTDIRS = lib libtvemu libcomp libcompemu libandroid libios components server-tvemu server-compemu bundle example-boilerplate/base-html-page
LINTDIRS += test/general-test test/android-general-test/js test/ios-general-test/js test/test-components
LINTTARGS = $(addprefix lint-,$(LINTDIRS))

.PHONY: lint $(LINTTARGS)

lint: $(LINTTARGS)

$(LINTTARGS): lint-%: $(CHECK_INSTALL_build-tools)
	"$(BUILD)"/jshint --verbose --extract=auto $(wildcard $*/*.js) $(wildcard $*/*.html) $(addprefix --exclude-path=,$(wildcard $*/.jshintignore))

NPMTARGS = $(addprefix npm-install-,$(NPMDIRS))

.PHONY: npm-install $(NPMTARGS)

npm-install: $(NPMTARGS) npm-install-deps

$(NPMTARGS): npm-install-%:
	cd $* && npm install && cp package.json .package.json.prev $(if $(wildcard $*/npm-shrinkwrap.json),&& cp npm-shrinkwrap.json .npm-shrinkwrap.json.prev)

npm-install-deps: $(CHECK_INSTALL_build-tools)
	cd deps && "$(BUILD)"/bower-installer && cp bower.json .bower.json.prev

deps/deps/polymer/polymer.html deps/deps/polymer/polymer-mini.html deps/deps/polymer/polymer-micro.html: $(CHECK_INSTALL_deps)
deps/deps/polymer-min: | $(CHECK_INSTALL_deps)

deps/deps/polymer-min/%.html: deps/deps/polymer/%.html $(CHECK_INSTALL_deps) | deps/deps/polymer-min
	./build-tools/html-script-filter.js '"$(BUILD)"/uglifyjs $(UGLIFYJS_PARAMS)' < "$<" > "$@"

CLEANTARGS = $(addprefix clean-,$(SUBDIRS))

.PHONY: clean $(CLEANTARGS) clean-jsdoc clean-dist clean-deps-polymer-min

clean: $(CLEANTARGS) clean-jsdoc clean-dist clean-deps-polymer-min

$(CLEANTARGS): clean-%:
	$(if $(wildcard $*/*),rm $(wildcard $*/*))
	$(if $(wildcard $*/),rmdir $*)

clean-jsdoc:
	$(if $(wildcard jsdoc/),rm -rf jsdoc/)

clean-dist:
	$(if $(wildcard dist/),rm -rf dist/)

clean-deps-polymer-min:
	$(if $(wildcard deps/deps/polymer-min/),rm -rf deps/deps/polymer-min/)

.PHONY: docs jsdocs
DOCDIRS = lib libcomp libcompemu libtvemu libandroid libios test/test-components

docs: jsdocs $(patsubst %.md,jsdoc/%.html,$(wildcard doc/*.md) $(wildcard test/*.md))

jsdocs: $(CHECK_INSTALL_build-tools)
	@mkdir -p jsdoc
	@sed -e 's/\.md)/.html)/g' -e 's/\](\.\//](..\//g' < readme.md > jsdoc/_jsdoc_readme.md
	@echo "### Version" >> jsdoc/_jsdoc_readme.md
	@echo "Generated from: $(VERSION)" >> jsdoc/_jsdoc_readme.md
	"$(BUILD)"/jsdoc -d jsdoc/ $(DOCDIRS) -R jsdoc/_jsdoc_readme.md -c ./.jsconf.json $(JSDOC_PARAMS)
	@echo "#main { overflow-x: auto; }" >> jsdoc/styles/jsdoc-default.css

jsdoc/%.html: %.md $(CHECK_INSTALL_build-tools)
	@mkdir -p "$(@D)"
	@echo '<!DOCTYPE html><html><meta charset="UTF-8" /><link type="text/css" rel="stylesheet" href="../styles/jsdoc-default.css">' > "$@"
	"$(BUILD)"/showdown makehtml -u UTF8 -i "$<" -q --tables --literalMidWordUnderscores --disableForced4SpacesIndentedSublists | sed -e 's|<a href="\.\./jsdoc/|<a href="\.\./|g' -e 's|\(<a href="[^/"]*\)\.md"|\1.html"|g' >> "$@"
	@echo '</html>' >> "$@"

.PHONY: tarball
tarball: vulcanize libs docs
	mkdir -p dist
	tar -czf dist/dist.tar.gz --mode='g-ws' --no-acls --numeric-owner $(sort $(SUBDIRS) doc/ jsdoc/ readme.md deps/deps example-boilerplate/ components/deps dist/babel/ dist/main/)

#------------------------------------------------------------------------------
# Build Android test application
#------------------------------------------------------------------------------

.PHONY: android-general-test

android-general-test:
	$(MAKE) -C test/android-general-test
