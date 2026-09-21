'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Files that are copied into a container (instead of bind-mounting a host directory): { p: 'relative/posix/path', data: Buffer }.
const LIMITS = Object.freeze({ maxFiles: 400, maxFileBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 });

class BundleError extends Error {
  constructor(message) { super(message); this.name = 'BundleError'; }
}

const safeRel = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');

// Reads a directory tree into memory. Symbolic links, oversized files and oversized trees are refused (never followed, never read
// whole: the size is checked before the bytes are read).
function bundleFromDir(dir, { skip = () => false, limits = LIMITS } = {}) {
  const files = [];
  let total = 0;
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip(r)) continue;
      if (entry.isSymbolicLink()) throw new BundleError(`refusing to copy symbolic link ${r}`);
      if (entry.isDirectory()) { walk(full, r); continue; }
      if (!entry.isFile()) throw new BundleError(`refusing to copy special file ${r}`);
      const size = fs.statSync(full).size;
      if (size > limits.maxFileBytes) throw new BundleError(`${r} is larger than ${limits.maxFileBytes} bytes`);
      total += size;
      if (files.length + 1 > limits.maxFiles || total > limits.maxTotalBytes) throw new BundleError('too many or too large files to copy into the sandbox');
      files.push({ p: r, data: fs.readFileSync(full) });
    }
  };
  walk(dir, '');
  return files;
}

// Wire form: 9 ASCII bytes (8 digits + newline) of length, then JSON {files:[{p, d: base64}]}.
function encodeBundle(files, limits = LIMITS) {
  let total = 0;
  for (const f of files) {
    if (!safeRel(f.p)) throw new BundleError(`bad path in bundle: ${String(f.p).slice(0, 80)}`);
    total += f.data.length;
  }
  if (files.length > limits.maxFiles * 2 || total > limits.maxTotalBytes * 2) throw new BundleError('bundle too large');
  const body = Buffer.from(JSON.stringify({ files: files.map((f) => ({ p: f.p, d: Buffer.from(f.data).toString('base64') })) }), 'utf8');
  return Buffer.concat([Buffer.from(`${String(body.length).padStart(8, '0')}\n`, 'latin1'), body]);
}

module.exports = Object.freeze({ BundleError, LIMITS, bundleFromDir, encodeBundle, safeRel });
