#!/bin/bash

########################################################################
# FILE:                run_local_servers.sh                            #
# DESCRIPTION:         Run local servers for testing purposes          #
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

function show_help() {
	echo "Executes local services" >&2
	echo "Usage: run_local_servers.sh [OPTIONS]" >&2
	echo "-T: TV Emu" >&2
	echo "-c: Comp Emu" >&2
	echo "-s: Silent running: suppress service output" >&2
	echo "-p: Prefix: prefix service output with name and timestamp" >&2
	echo "-L: Log: log service output to auto-named file" >&2
	echo "-h: Show this help" >&2
	echo "" >&2
	echo "NB: Use docker-compose instead for v4 layout and timeline services" >&2
}

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT

DIR="$( dirname "${BASH_SOURCE[0]}" )"/../../

if which nodejs &> /dev/null; then
	NODE=nodejs
elif which node &> /dev/null; then
	NODE=node
else
	echo "Can't find node.js"
	exit 1
fi

TVEMU=
COMPEMU=
SILENT=
PREFIX=
LOG=
while getopts ":awltTcspLh" opt; do
	case $opt in
		T)
			TVEMU=1
			;;
		c)
			COMPEMU=1
			;;
		s)
			SILENT=1
			;;
		p)
			PREFIX=1
			;;
		L)
			LOG=1
			;;
		h | \?)
			show_help
			exit 1
			;;
	esac
done

if [ "$#" -eq 0 -o "$#" -ne "$((OPTIND-1))" ]; then
	show_help
	exit 1
fi

if [ -n "$PREFIX" -o -n "$LOG" ]; then
	if [ -n "$SILENT" ]; then
		show_help
		exit 1
	fi
fi

if [ -n "$SILENT" ]; then
	function exec_service() {
		shift
		exec "$@" &> /dev/null
	}
else
	if [ -n "$LOG" ]; then
		FILE=log-"`date +%s`".log
		echo "Logging to $FILE"
		exec 3> >(tee -a "$FILE")
	else
		exec 3>&1
	fi
	if [ -n "$PREFIX" ]; then
		function exec_service() {
			NAME="$1"
			shift
			exec "$@" 2>&1 | stdbuf -oL ts "$NAME: %F %H:%M:%.S %z    " >&3
		}
	else
		function exec_service() {
			shift
			exec "$@" >&3 2>&3
		}
	fi
fi

if [ -n "$TVEMU" ]; then
	echo "Running TV emu service"
	NETWORK_IFACE=$(ifconfig | egrep "(en|eth)[a-z0-9]+:" | sed -e "s/\:.*$//g" | sort | { read first rest ; echo $first ; })
	DIAL_UUID=$(ifconfig ${NETWORK_IFACE} | grep -o -E '([a-zA-Z0-9]{2}:){5}[a-zA-Z0-9]{2}' | sed -e s/://g)
	DIAL_FRIENDLY_NAME=2Immerse_$(echo ${DIAL_UUID} | tail -c 5)
	exec_service "T" $NODE "$DIR"/client-api/server-tvemu/server.js -C 7681 -u ${DIAL_UUID} -f ${DIAL_FRIENDLY_NAME} -l "$DIR"/client-api/server-tvemu/launch.sh -s "$DIR"/client-api/server-tvemu/stop.sh &
	echo "Running dvbcsstv-lib service"
	exec_service "d" python "$DIR"/client-api/server-tvemu/node_modules/.bin/dvbcsstv-proxy-server.py &
fi
if [ -n "$COMPEMU" ]; then
	echo "Running comp emu service"
	exec_service "c" $NODE "$DIR"/client-api/server-compemu/server-compemu.js &
fi

wait
