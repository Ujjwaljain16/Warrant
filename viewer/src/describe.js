'use strict';

// One-line, display-safe descriptions of log entries, and small formatters. Every log-derived string goes
// through clip(), so hostile text is length-capped and its invisible characters are made visible.

const { clip, show } = require('./text');

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function shortDigest(d) {
  if (typeof d !== 'string') return '';
  const body = d.startsWith('sha256:') ? d.slice(7) : d;
  return `sha256:${clip(body.slice(0, 10), 12)}`;
}

function list(x) {
  return Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, 8).map((s) => clip(s, 40)).join(', ') : '';
}

function describeEvent(e) {
  const d = isObj(e.data) ? e.data : {};
  switch (e.type) {
    case 'run_started': return `${show(d.tasks, 12)} tasks · spec ${shortDigest(d.spec_digest)}${d.resumed === true ? ' · resumed' : ''}`;
    case 'attempt_started': return `attempt ${show(d.no, 12)} · ${show(d.effect, 40)}`;
    case 'attempt_result': {
      if (d.claim === 'success') return `worker claims success · ${shortDigest(d.digest)}`;
      return `worker claim ${show(d.claim, 24)}${d.code !== undefined ? ` · ${show(d.code, 40)}` : ''}`;
    }
    case 'gate_verdict': {
      const parts = [`gate ${show(d.status, 24)}`];
      if (Array.isArray(d.passed) && d.passed.length) parts.push(`passed ${list(d.passed)}`);
      if (Array.isArray(d.failed) && d.failed.length) parts.push(`FAILED ${list(d.failed)}`);
      if (Array.isArray(d.not_verified) && d.not_verified.length) parts.push(`not verified ${list(d.not_verified)}`);
      if (d.claim_only === true) parts.push('claim-only');
      return parts.join(' · ');
    }
    case 'attempt_ambiguous': return `outcome unknown · ${show(d.code, 40)}`;
    case 'reconcile': return `reconcile: ${show(d.outcome, 40)}`;
    case 'attempt_failed': return `${show(d.code, 40)} · ${d.retry === true ? `retry${typeof d.backoff_ms === 'number' ? ` after ${show(d.backoff_ms, 12)} ms` : ''}` : 'no retry'}`;
    case 'task_settled': return `${show(d.status, 24)}${d.code !== undefined ? ` · ${show(d.code, 40)}` : ''}${d.effect_maybe_applied === true ? ' · effect may have applied' : ''}`;
    case 'duplicate_ignored': return `ignored: ${show(d.reason, 40)}`;
    case 'cancel_requested': return `cancel requested${d.reason !== undefined ? ` · ${show(d.reason, 40)}` : ''}`;
    case 'run_finished': return `run ${show(d.status, 24)}`;
    default: return '';
  }
}

// Time relative to the first entry, in a compact unit. `t` is the writer's clock (epoch ms or simulated ms).
function formatT(t, model) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return '';
  const rel = model && model.tMeaningful ? t - model.tMin : t;
  if (Math.abs(rel) >= 10000) return `${(rel / 1000).toFixed(1)} s`;
  if (Math.abs(rel) >= 1000) return `${(rel / 1000).toFixed(2)} s`;
  return `${rel} ms`;
}

function shortHash(h, n = 12) {
  return typeof h === 'string' ? clip(h.replace(/^sha256:/, '').slice(0, n), n + 2) : '';
}

module.exports = { describeEvent, formatT, shortDigest, shortHash };
