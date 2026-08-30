'use strict';

const { canonicalRequest } = require('./canonical');
const { LlmError } = require('./errors');

/**
 * Deterministic scripted LlmClient for tests. `script` is an array of replies, or a function (request, callIndex) -> reply.
 * A reply is a string (the model's text) or {text, usage?, finishReason?} or an Error instance (thrown on that call).
 * Every request seen is kept in `calls` so tests can inspect exactly what the agent sent.
 */
class FakeLlm {
  constructor(script) {
    if (!Array.isArray(script) && typeof script !== 'function') throw new TypeError('script must be an array or a function');
    this.script = script;
    this.calls = [];
  }

  async generate(rawRequest) {
    const request = canonicalRequest(rawRequest);
    const index = this.calls.length;
    this.calls.push(structuredClone(request));
    const reply = typeof this.script === 'function' ? this.script(request, index) : this.script[index];
    if (reply === undefined) throw new LlmError('FAKE_EXHAUSTED', `FakeLlm script has no reply for call ${index}`);
    if (reply instanceof Error) throw reply;
    const body = typeof reply === 'string' ? { text: reply } : reply;
    const inputChars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      text: body.text,
      usage: body.usage || { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(body.text.length / 4) },
      finishReason: body.finishReason || 'stop',
    };
  }
}

module.exports = Object.freeze({ FakeLlm });
