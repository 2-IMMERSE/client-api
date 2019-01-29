.PHONY: build vulcanize preinstall

build:
	$(MAKE) -C ../.. lib libtvemu libcomp libcompemu

vulcanize:
	$(MAKE) -C ../.. test/general-test/dist/index.html

preinstall:
	$(MAKE) -C ../.. npm-install-lib npm-install-components npm-install-libtvemu npm-install-libcomp npm-install-libcompemu npm-install-test
