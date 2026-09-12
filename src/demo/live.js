'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { warrantHome } = require('../llm/quota');

// `--live` spends free-tier API quota, so it is refused unless the person asked for it twice: WARRANT_LIVE=1 in the
// environment AND an API key present (the key file under the user profile, or GEMINI_API_KEY). Only the existence of
// the key file is checked here; this module never reads the key.
function liveRefusal(env = process.env, exists = fs.existsSync) {
  if (env.WARRANT_LIVE !== '1') return '--live makes real API calls and spends free-tier quota: set WARRANT_LIVE=1 to allow it';
  const keyFile = path.join(warrantHome(env), 'gemini.key');
  const envKey = typeof env.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim() !== '';
  if (!envKey && !exists(keyFile)) return `--live needs an API key: create ${keyFile} or set GEMINI_API_KEY`;
  return null;
}

function assertLiveAllowed(env = process.env, exists = fs.existsSync) {
  const refusal = liveRefusal(env, exists);
  if (refusal) throw new Error(refusal);
}

module.exports = Object.freeze({ assertLiveAllowed, liveRefusal });
