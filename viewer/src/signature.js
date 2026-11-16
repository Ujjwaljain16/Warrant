'use strict';

// Signed-head check in the browser: the same rules as src/log/signing.js (verifyHead), with Ed25519 from WebCrypto.
// The signed message must stay byte-identical to the engine's; test/viewer.test.js checks a record the engine signed.

const DOMAIN = 'warrant-log-head:v1';

function message(r) {
  return [DOMAIN, `key=${r.key_id}`, `spec=${r.spec_digest}`, `entries=${r.entries}`, `head=${r.head}`, `at=${r.signed_at}`].join('\n');
}

function looksLikeSignature(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && value.alg === 'ed25519' && typeof value.signature === 'string' && typeof value.head === 'string';
}

function looksLikePublicKey(text) {
  return /^-----BEGIN PUBLIC KEY-----/.test(String(text).trim());
}

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToDer(text) {
  const m = /-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/.exec(String(text));
  if (!m) throw new Error('not a PEM public key');
  return base64ToBytes(m[1]);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * entries: the parsed log entries; record: the parsed .sig JSON; pemText: the public key file.
 * Returns { valid: true|false|null, reason, key_id, unsigned_entries }. null means this browser cannot check Ed25519.
 */
async function verifySignature(entries, record, pemText, subtle = (globalThis.crypto && globalThis.crypto.subtle) || null) {
  const out = { valid: false, reason: null, key_id: record && record.key_id, unsigned_entries: 0 };
  if (!looksLikeSignature(record) || record.version !== 1) return { ...out, reason: 'the signature file is not a warrant signature record' };
  if (!subtle) return { ...out, valid: null, reason: 'this page has no WebCrypto, so the signature cannot be checked here' };
  let der;
  try { der = pemToDer(pemText); } catch (_error) { return { ...out, reason: 'the public key file could not be read' }; }
  let key;
  try { key = await subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']); } catch (_error) {
    return { ...out, valid: null, reason: 'this browser cannot check Ed25519 signatures (or the key is not an Ed25519 key)' };
  }
  const id = hex(await subtle.digest('SHA-256', der)).slice(0, 16);
  if (record.key_id !== id) return { ...out, reason: `signed with key ${record.key_id}, not with the loaded key ${id}` };
  let ok = false;
  try { ok = await subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(record.signature), new TextEncoder().encode(message(record))); } catch (_error) { ok = false; }
  if (!ok) return { ...out, reason: 'the signature does not verify: the record was edited or made with another key' };
  if (!Number.isInteger(record.entries) || record.entries < 1 || record.entries > entries.length) {
    return { ...out, reason: `the signature covers ${record.entries} entries but the log has ${entries.length}: entries were removed` };
  }
  const at = entries[record.entries - 1];
  if (!at || at.hash !== record.head) return { ...out, reason: `entry ${record.entries} does not have the signed head: the log was rewritten` };
  return { ...out, valid: true, unsigned_entries: entries.length - record.entries };
}

module.exports = { looksLikePublicKey, looksLikeSignature, message, verifySignature };
