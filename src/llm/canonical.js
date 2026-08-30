'use strict';

const crypto = require('node:crypto');

// The canonical form of an LlmClient request. Only fields that determine the model's answer are included;
// transport details (headers, keys, timeouts, signals) are never part of a request key.

const ROLES = Object.freeze(['user', 'assistant']);

function canonicalRequest(request) {
  if (request === null || typeof request !== 'object') throw new TypeError('request must be an object');
  const { model, system = '', messages, maxOutputTokens, temperature } = request;
  if (typeof model !== 'string' || !model) throw new TypeError('request.model must be a non-empty string');
  if (typeof system !== 'string') throw new TypeError('request.system must be a string');
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('request.messages must be a non-empty array');
  const canonicalMessages = messages.map((m, i) => {
    if (!m || !ROLES.includes(m.role) || typeof m.content !== 'string') throw new TypeError(`request.messages[${i}] must be {role: user|assistant, content: string}`);
    return { role: m.role, content: m.content };
  });
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new TypeError('request.maxOutputTokens must be a positive integer');
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) throw new TypeError('request.temperature must be a finite number');
  return { model, system, messages: canonicalMessages, maxOutputTokens, temperature };
}

// Fixed key order, so the same request always serialises to the same bytes.
function canonicalJson(request) {
  const r = canonicalRequest(request);
  return JSON.stringify({
    model: r.model, system: r.system, messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
    maxOutputTokens: r.maxOutputTokens, temperature: r.temperature,
  });
}

function requestKey(request) {
  return crypto.createHash('sha256').update(canonicalJson(request), 'utf8').digest('hex');
}

module.exports = Object.freeze({ canonicalJson, canonicalRequest, requestKey });
