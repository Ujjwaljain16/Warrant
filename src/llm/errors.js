'use strict';

// Errors raised by the LLM layer. `code` is stable and machine-readable; messages never contain credentials.

class LlmError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// The daily request quota of a model is gone (locally counted, or reported by the provider).
// Long runs catch this, stop cleanly, and resume after the reset (midnight US Pacific).
class QuotaExhaustedError extends LlmError {
  constructor(model, detail, extra = {}) {
    super('QUOTA_EXHAUSTED', `daily quota exhausted for ${model}: ${detail}`, { model, ...extra });
    this.name = 'QuotaExhaustedError';
  }
}

// A live call was attempted while live calls are not enabled (WARRANT_LIVE != 1).
class LiveDisabledError extends LlmError {
  constructor() {
    super('LIVE_DISABLED', 'live LLM calls are disabled; set WARRANT_LIVE=1 to allow them (tests never do)');
    this.name = 'LiveDisabledError';
  }
}

class MissingKeyError extends LlmError {
  constructor(keyFile) {
    super('NO_API_KEY', `no Gemini API key: set GEMINI_API_KEY or put the key in ${keyFile}`);
    this.name = 'MissingKeyError';
  }
}

// replay-only mode (or replay-then-live without a live client) was asked for a request that was never recorded.
class CassetteMissError extends LlmError {
  constructor(key, occurrence, cassette) {
    super('CASSETTE_MISS', `no recorded response for request ${key.slice(0, 16)}… (occurrence ${occurrence}) in ${cassette}`, { key, occurrence });
    this.name = 'CassetteMissError';
  }
}

module.exports = Object.freeze({ CassetteMissError, LiveDisabledError, LlmError, MissingKeyError, QuotaExhaustedError });
