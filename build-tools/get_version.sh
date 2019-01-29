#!/bin/sh

########################################################################
# FILE:                get_version.sh                                  #
# DESCRIPTION:         Print repo version                              #
# VERSION:             (see git)                                       #
# DATE:                (see git)                                       #
# AUTHOR:              Jonathan Rennison <jonathan.rennison@bt.com>    #
#                                                                      #
#                      © British Telecommunications plc 2018           #
#                                                                      #
# Licensed under the Apache License, Version 2.0 (the "License");      #
# you may not use this file except in compliance with the License.     #
# You may obtain a copy of the License at                              #
#                                                                      #
#   http://www.apache.org/licenses/LICENSE-2.0                         #
#                                                                      #
# Unless required by applicable law or agreed to in writing, software  #
# distributed under the License is distributed on an "AS IS" BASIS,    #
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or      #
# implied.                                                             #
# See the License for the specific language governing permissions and  #
# limitations under the License.                                       #
########################################################################

VER="`git describe --tags --always --dirty=-m --exact-match 2> /dev/null || git describe --always --match '' --dirty=-m 2> /dev/null`"

SYMREF="`git symbolic-ref -q --short HEAD 2> /dev/null | sed -e 's/^master$//'`"
if [ -n "$SYMREF" ]; then
	VER="$VER ($SYMREF)"
fi
echo "$VER"
