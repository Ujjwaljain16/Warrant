'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../src/util/redact');
const { d, simulate } = require('./sim-helpers');
const { correctContent } = require('../src/sim/truth');

// Secrets are assembled at runtime so the repository's own secret scanner (scripts/check.js) does not flag this file.
const fake = {
  openai: ['sk', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('-'),
  github: ['ghp', 'x'.repeat(36)].join('_'),
  aws: ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
  bearer: `Bearer ${'abcdef0123456789'.repeat(2)}`,
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'].join('.'),
};

test('redact: known secret shapes are removed from text', () => {
  for (const [kind, value] of Object.entries(fake)) {
    const out = redact(`failed while calling the service with ${value} in the header`);
    assert.ok(!out.includes(value.replace('Bearer ', '')), `${kind} survived: ${out}`);
    assert.match(out, /REDACTED/);
  }
  assert.match(redact('password=hunter2hunter2 and api_key: "abcd1234efgh"'), /password=\[REDACTED\].*api_key: \[REDACTED\]/);
});

test('redact: ordinary text is preserved and long text is truncated', () => {
  assert.equal(redact('connection reset by peer'), 'connection reset by peer');
  const long = redact('x'.repeat(2000), 100);
  assert.equal(long.length, 100 + '...[truncated]'.length);
});

test('the run log carries digests and codes, never artifact bodies or free-form worker text', async () => {
  const secret = fake.openai;
  const workerFactory = ({ clock }) => ({
    async execute(info, ctx) {
      if (info.attemptNo === 1) {
        // A failing attempt whose error text and error code are laced with a secret.
        ctx.deliver({ attemptId: info.attemptId, claim: 'failure', errorCode: `leaked ${secret}`, retryable: true });
        return;
      }
      if (info.attemptNo === 2) throw new Error(`crashed with token ${secret}`);
      ctx.deliver({ attemptId: info.attemptId, claim: 'success', artifacts: { out: correctContent(info.taskId, info.inputs), notes: secret } });
    },
  });
  const { report, entries } = await simulate([d('a')], {}, { workerFactory });
  assert.equal(report.tasks.a.status, 'succeeded');
  const everything = JSON.stringify(entries) + JSON.stringify(report);
  assert.ok(!everything.includes(secret), 'secret reached the log or report');
  assert.ok(!everything.includes(correctContent('a', {})), 'artifact body reached the log');
  const crash = entries.find((e) => e.type === 'attempt_failed' && e.data.code === 'WORKER_CRASH') || entries.find((e) => e.data && e.data.detail);
  if (crash && crash.data.detail) assert.ok(!crash.data.detail.includes(secret));
});
