#!/bin/sh

########################################################################
# FILE:                tv_minimal_run_local_servers.sh                 #
# DESCRIPTION:         Run local servers on TV device: minimal         #
# VERSION:             (see git)                                       #
# DATE:                (see git)                                       #
# AUTHOR:              Jonathan Rennison <jonathan.rennison@bt.com>    #
#                                                                      #
#                      © British Telecommunications plc 2018           #
#                      All rights reserved                             #
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

/usr/local/bin/node ../server-tvemu/server.js -C 7681 &
python ../server-tvemu/node_modules/.bin/dvbcsstv-proxy-server.py &

wait
