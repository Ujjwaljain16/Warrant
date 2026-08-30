'use strict';

// Provider-neutral LLM layer.
//
//   LlmClient: generate({ model, system, messages: [{role: 'user'|'assistant', content}], maxOutputTokens, temperature },
//                       { signal }?) -> Promise<{ text, usage: { inputTokens, outputTokens }, finishReason }>
//   finishReason is one of 'stop' | 'length' | 'blocked' | 'other'.
const { canonicalJson, canonicalRequest, requestKey } = require('./canonical');
const { CassetteClient, loadCassette } = require('./cassette');
const errors = require('./errors');
const { FakeLlm } = require('./fake');
const { GeminiClient, loadApiKey } = require('./gemini');
const { MODEL_LIMITS, limitsFor, resolveModel } = require('./limits');
const { DailyCounter, RateLimiter, pacificDay, warrantHome } = require('./quota');
const { redactSecrets } = require('./secrets');

module.exports = Object.freeze({
  ...errors,
  CassetteClient, DailyCounter, FakeLlm, GeminiClient, MODEL_LIMITS, RateLimiter,
  canonicalJson, canonicalRequest, limitsFor, loadApiKey, loadCassette, pacificDay, redactSecrets, requestKey, resolveModel, warrantHome,
});
