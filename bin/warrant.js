#!/usr/bin/env node
'use strict';

require('../src/cli/main').main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
