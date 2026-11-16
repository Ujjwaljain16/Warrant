'use strict';

// Signed log heads. The hash chain makes a log tamper-evident but not authentic: anyone who rewrites an entry can recompute every
// later hash, and the chain verifies again (the viewer's "forged success" sample is exactly that). A signature over the head binds
// the whole chain, and so every entry, to whoever holds the private key. Ed25519 from node:crypto; no dependency.
//
// What a valid signature means: the holder of this key signed a log whose head and length are these. It does not mean the work was
// correct (that is the gate's job, recorded inside the log), and it is only as trustworthy as the way the public key reached you.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SIG_VERSION = 1;
const DOMAIN = 'warrant-log-head:v1';

class SigningError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function keyId(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

// The exact bytes that are signed. Every field is part of the message, so none can be edited without breaking the signature.
function message({ head, entries, spec_digest: specDigest, signed_at: signedAt, key_id: kid }) {
  return Buffer.from([DOMAIN, `key=${kid}`, `spec=${specDigest}`, `entries=${entries}`, `head=${head}`, `at=${signedAt}`].join('\n'), 'utf8');
}

/** Writes an Ed25519 key pair; the private key file is created owner-only and never overwritten. */
function generateKeyPair(dir, name = 'warrant-signing') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(dir, { recursive: true });
  const priv = path.join(dir, `${name}.key`);
  const pub = path.join(dir, `${name}.pub`);
  for (const file of [priv, pub]) if (fs.existsSync(file)) throw new SigningError('KEY_EXISTS', `${file} already exists; refusing to overwrite a key`);
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  return { privateKeyFile: priv, publicKeyFile: pub, keyId: keyId(publicKey) };
}

function loadPrivateKey(file) {
  let key;
  try { key = crypto.createPrivateKey(fs.readFileSync(file)); } catch (error) { throw new SigningError('BAD_KEY', `cannot read a private key from ${file}: ${error.code || error.message}`); }
  if (key.asymmetricKeyType !== 'ed25519') throw new SigningError('BAD_KEY', `${file} is a ${key.asymmetricKeyType} key; an ed25519 key is required`);
  return key;
}

function loadPublicKey(file) {
  let key;
  try { key = crypto.createPublicKey(fs.readFileSync(file)); } catch (error) { throw new SigningError('BAD_KEY', `cannot read a public key from ${file}: ${error.code || error.message}`); }
  if (key.asymmetricKeyType !== 'ed25519') throw new SigningError('BAD_KEY', `${file} is a ${key.asymmetricKeyType} key; an ed25519 key is required`);
  return key;
}

/** Signs the current head of a verified log. `entries` are the parsed, chain-verified entries. */
function signHead(entries, privateKey, { now = new Date() } = {}) {
  if (!entries.length) throw new SigningError('EMPTY_LOG', 'an empty log has no head to sign');
  const publicKey = crypto.createPublicKey(privateKey);
  const first = entries[0]; // run_started: its spec digest names the run
  const body = {
    version: SIG_VERSION,
    alg: 'ed25519',
    key_id: keyId(publicKey),
    spec_digest: (first.data && first.data.spec_digest) || null,
    entries: entries.length,
    head: entries[entries.length - 1].hash,
    signed_at: now.toISOString(),
  };
  return { ...body, signature: crypto.sign(null, message(body), privateKey).toString('base64') };
}

/**
 * Checks a signature record against a log's entries and a public key. Returns {valid, reason, ...}; never throws for a bad
 * signature, only for unusable input. A log that grew after it was signed is reported, not silently accepted: the signature then
 * covers only its first `entries` entries.
 */
function verifyHead(entries, record, publicKey) {
  const out = { valid: false, key_id: record && record.key_id, head: record && record.head, entries: record && record.entries };
  if (!record || record.version !== SIG_VERSION || record.alg !== 'ed25519' || typeof record.signature !== 'string') return { ...out, reason: 'not a warrant signature record' };
  if (record.key_id !== keyId(publicKey)) return { ...out, reason: `signed with key ${record.key_id}, not with the given key ${keyId(publicKey)}` };
  let ok = false;
  try { ok = crypto.verify(null, message(record), publicKey, Buffer.from(record.signature, 'base64')); } catch (_error) { ok = false; }
  if (!ok) return { ...out, reason: 'signature does not verify: the record was edited or made with another key' };
  if (!Number.isInteger(record.entries) || record.entries < 1 || record.entries > entries.length) {
    return { ...out, reason: `the signature covers ${record.entries} entries but the log has ${entries.length}: entries were removed` };
  }
  if (entries[record.entries - 1].hash !== record.head) return { ...out, reason: `entry ${record.entries} does not have the signed head: the log was rewritten` };
  const unsigned = entries.length - record.entries;
  return { ...out, valid: true, reason: null, unsigned_entries: unsigned };
}

const sigFileFor = (logFile) => `${logFile}.sig`;

module.exports = Object.freeze({ SIG_VERSION, SigningError, generateKeyPair, keyId, loadPrivateKey, loadPublicKey, sigFileFor, signHead, verifyHead });
