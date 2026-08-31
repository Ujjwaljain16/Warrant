'use strict';

// A command that follows the receipt protocol (src/workers/receipt.js). It "charges an account" by appending one line
// to an external ledger file, which stands for any effect that must not be repeated.
//
//   node charge.js <ledger file>
//
// Order matters; it is what lets a later process decide, from files alone, whether the charge happened:
//   1. markIntent()   -- before the effect. If this file is absent after a crash, the effect cannot have started.
//   2. the effect     -- append to the ledger.
//   3. write outputs
//   4. writeReceipt() -- last, atomically, with the digest of each output.

const fs = require('node:fs');
const { markIntent, writeReceipt } = require('../../src/workers/receipt');

const ledger = process.argv[2];
if (!ledger) { process.stderr.write('usage: charge.js <ledger file>\n'); process.exit(2); }

markIntent();
fs.appendFileSync(ledger, `charge ${process.env.WARRANT_IDEMPOTENCY_KEY}\n`);
fs.writeFileSync('out', JSON.stringify({ charged: true, key: process.env.WARRANT_IDEMPOTENCY_KEY }));
writeReceipt({ outputs: ['out'] });
