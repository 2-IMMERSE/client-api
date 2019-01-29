#!/usr/bin/env node

/************************************************************************/
/* FILE:                html-script-filter.js                           */
/* DESCRIPTION:         Utility script to run a filtering command on    */
/*                      the contents of script tags in a HTML doc       */
/* VERSION:             (see git)                                       */
/* DATE:                (see git)                                       */
/* AUTHOR:              Jonathan Rennison <jonathan.rennison@bt.com>    */
/*                                                                      */
/*                      © British Telecommunications plc 2018           */
/*                                                                      */
/* Licensed under the Apache License, Version 2.0 (the "License");      */
/* you may not use this file except in compliance with the License.     */
/* You may obtain a copy of the License at                              */
/*                                                                      */
/*   http://www.apache.org/licenses/LICENSE-2.0                         */
/*                                                                      */
/* Unless required by applicable law or agreed to in writing, software  */
/* distributed under the License is distributed on an "AS IS" BASIS,    */
/* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or      */
/* implied.                                                             */
/* See the License for the specific language governing permissions and  */
/* limitations under the License.                                       */
/************************************************************************/

'use strict';

var child_process = require('child_process');

var docText = '';
try {
	process.stdin.setEncoding('utf-8');
	process.stdout.setDefaultEncoding('utf-8');
} catch(e) {
	console.log("Exception in setting stdin/stdout encoding: ", e);
}
process.stdin.on('readable', function() {
	var chunk = process.stdin.read();
	if (chunk !== null) {
		docText += chunk;
	}
});
process.stdin.on('end', function() {
	process.stdout.write(docText.replace(/(<script[^>]*>)([^]*?)(<\/script>)/gm, function(match, p1, p2, p3) {
		if (p1.indexOf('src="') !== -1) return match;

		return p1 + child_process.execSync(process.argv[2], { input: p2 }) + p3;
	}));
});
