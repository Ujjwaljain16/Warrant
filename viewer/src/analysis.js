'use strict';

// The whole pipeline in one call: parse -> verify chain -> fold into a model -> audit -> summarise.
// The page and the tests both go through this function.

const { LIMITS, parseLog } = require('./parse');
const { verifyChain } = require('./chain');
const { auditLog, invariantReport } = require('./audit');
const { buildModel, tally } = require('./model');
const { summarize } = require('./summary');
const { sha256Digest } = require('./canonical');

const SPEC_LIMITS = Object.freeze({ maxTasks: 512 });

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// Only the fields the audit reads, each checked; anything else in the file is ignored. Returns { ok, spec | error }.
function normalizeSpec(value) {
  if (!isObj(value)) return { ok: false, error: 'the spec must be a JSON object' };
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > SPEC_LIMITS.maxTasks) return { ok: false, error: `the spec needs a tasks array of 1..${SPEC_LIMITS.maxTasks} tasks` };
  if (!Number.isInteger(value.max_concurrency) || value.max_concurrency < 1) return { ok: false, error: 'the spec needs an integer max_concurrency >= 1' };
  const seen = new Set();
  const tasks = [];
  for (const t of value.tasks) {
    if (!isObj(t) || typeof t.id !== 'string') return { ok: false, error: 'every spec task needs a string id' };
    if (seen.has(t.id)) return { ok: false, error: `duplicate task id in the spec: ${t.id}` };
    seen.add(t.id);
    if (!Array.isArray(t.deps) || !t.deps.every((d) => typeof d === 'string')) return { ok: false, error: `task ${t.id}: deps must be an array of ids` };
    if (!Number.isInteger(t.max_attempts) || t.max_attempts < 1) return { ok: false, error: `task ${t.id}: max_attempts must be an integer >= 1` };
    tasks.push(t);
  }
  return { ok: true, spec: { ...value, tasks } };
}

async function specDigestOf(rawSpec) {
  try { return await sha256Digest(rawSpec); } catch (_error) { return null; }
}

/**
 * @param {string} text  log contents (JSONL)
 * @param {{ specValue?: object, name?: string, limits?: object }} [options]  specValue is an already parsed spec JSON
 */
async function analyze(text, { specValue = null, name = null, limits = LIMITS } = {}) {
  const parsed = parseLog(text, limits);
  const chain = await verifyChain(parsed);

  let spec = null;
  let specError = null;
  let specMatch = null;
  let digest = null;
  if (specValue !== null) {
    const normalized = normalizeSpec(specValue);
    if (normalized.ok) {
      spec = normalized.spec;
      digest = await specDigestOf(specValue);
      const recorded = parsed.entries.find((e) => isObj(e) && e.type === 'run_started' && isObj(e.data) && typeof e.data.spec_digest === 'string');
      specMatch = recorded && digest ? recorded.data.spec_digest === digest : null;
    } else specError = normalized.error;
  }

  const usable = chain.status === 'broken' ? parsed.entries.slice(0, chain.verified) : parsed.entries;
  const violations = auditLog(spec, usable, chain.status === 'broken' ? null : chain, spec ? digest : null);
  if (chain.status === 'broken') violations.unshift({ code: 'I8_CHAIN', seq: null, message: chain.broken.message });
  const chainBroken = chain.status === 'broken';
  const invariants = invariantReport(violations, { hasSpec: spec !== null, chainBroken });

  const model = buildModel(parsed.entries, { spec });
  const counts = tally(model);
  const summary = summarize({ model, counts, chain, violations, hasSpec: spec !== null, specMatch, name });
  return { parsed, chain, spec, specError, specMatch, model, counts, violations, invariants, summary, limits };
}

module.exports = { analyze, normalizeSpec };
