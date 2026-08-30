'use strict';

// Free-tier limits per model (requests/minute, tokens/minute, requests/day). Quotas are per project and the daily
// quota resets at midnight US Pacific. Model ids were checked against ai.google.dev (models page, Gemma-on-Gemini page).
const MODEL_LIMITS = Object.freeze({
  'gemini-3.5-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250_000, rpd: 500 },
  'gemma-4-31b-it': { rpm: 30, tpm: 16_000, rpd: 14_400 },
  'gemma-4-26b-a4b-it': { rpm: 30, tpm: 16_000, rpd: 14_400 },
  // Judge spot-checks only: 20 requests a day.
  'gemini-3.8-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3.7-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3.6-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250_000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250_000, rpd: 20 },
});

// Short names people tend to type -> the id the API expects.
const MODEL_ALIASES = Object.freeze({
  'gemma-4-31b': 'gemma-4-31b-it',
  'gemma-4-26b': 'gemma-4-26b-a4b-it',
  'gemini-3-flash': 'gemini-3-flash-preview',
});

function resolveModel(model) {
  return Object.hasOwn(MODEL_ALIASES, model) ? MODEL_ALIASES[model] : model;
}

// Unknown models get the most conservative table entry rather than no limit at all.
function limitsFor(model) {
  const id = resolveModel(model);
  return Object.hasOwn(MODEL_LIMITS, id) ? MODEL_LIMITS[id] : { rpm: 5, tpm: 250_000, rpd: 20 };
}

module.exports = Object.freeze({ MODEL_ALIASES, MODEL_LIMITS, limitsFor, resolveModel });
