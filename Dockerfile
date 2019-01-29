# (c) BBC Research & Development, 2018. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM runmymind/docker-android-sdk:ubuntu-standalone

ENV OUTPUT="/build" LANG=C.UTF-8
ENV GRADLE_HOME /opt/gradle
ENV GRADLE_VERSION 4.7
ENV PATH=$PATH:$(ANDROID_HOME)/platform-tools:$(ANDROID_HOME)/tools:

RUN mkdir -p $OUTPUT

RUN apt-get update \
    && apt-get -yq --no-install-recommends install nodejs python-pip python-setuptools python-wheel npm git ssh make sudo build-essential \
    && apt-get clean \
    && pip install awscli

RUN npm install -g npm \
	&& npm install -g cordova@7 \
	&& cordova telemetry off

RUN wget --no-verbose --output-document=gradle.zip "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
	&& unzip gradle.zip \
	&& rm gradle.zip \
	&& mv "gradle-${GRADLE_VERSION}" "${GRADLE_HOME}/" \
	&& ln -s "${GRADLE_HOME}/bin/gradle" /usr/bin/gradle

RUN /opt/android-sdk-linux/tools/bin/sdkmanager "build-tools;26.0.2"

VOLUME ${OUTPUT}
USER android
WORKDIR /build
