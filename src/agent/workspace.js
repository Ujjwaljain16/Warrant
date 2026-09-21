'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A directory the agent may read and write, and nothing else. Every path from the model is untrusted text:
// it is validated lexically, then checked again against the real (symlink-resolved) location.
const DEFAULT_LIMITS = Object.freeze({ maxReadChars: 20_000, maxFiles: 200, maxTotalWriteBytes: 1 << 20, maxListEntries: 200, maxReadBytes: 1 << 20 });
const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules']);

class WorkspaceError extends Error {}

class Workspace {
  constructor(root, limits = {}) {
    this.root = fs.realpathSync(root);
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.bytesWritten = 0;
  }

  // Lexical validation. Returns the absolute candidate path; throws WorkspaceError with a message safe to show the model.
  resolve(rel) {
    if (typeof rel !== 'string' || rel.length === 0) throw new WorkspaceError('path must be a non-empty string');
    if (rel.includes('\0')) throw new WorkspaceError('path contains a NUL byte');
    if (rel.includes('\\')) throw new WorkspaceError('use forward slashes in paths');
    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) throw new WorkspaceError('absolute paths are not allowed; use a path relative to the project root');
    const segments = rel.split('/').filter((s) => s !== '' && s !== '.');
    if (segments.includes('..')) throw new WorkspaceError('".." is not allowed in paths');
    // Windows file systems know a name by more than one spelling: GIT~1 (short name), .git::$INDEX_ALLOCATION (stream), ".git." and ".git "
    // (trailing dot/space are dropped). None of those spellings are accepted, so the blocklist below can not be walked around.
    if (segments.some((s) => /[:~*?<>|"]/.test(s) || /[. ]$/.test(s))) throw new WorkspaceError('that name is not allowed (no ":", "~", wildcard characters, or trailing dot or space)');
    if (segments.some((s) => BLOCKED_SEGMENTS.has(s.toLowerCase()))) throw new WorkspaceError('that directory is not accessible');
    const candidate = path.resolve(this.root, ...segments);
    if (candidate !== this.root && !candidate.startsWith(this.root + path.sep)) throw new WorkspaceError('path escapes the project root');
    return candidate;
  }

  // The real location of the deepest existing ancestor must still be inside the root (defeats symlinks).
  _assertContained(candidate) {
    let probe = candidate;
    for (;;) {
      try {
        const real = fs.realpathSync(probe);
        if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new WorkspaceError('path escapes the project root');
        return;
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        if (error.code !== 'ENOENT') throw new WorkspaceError('path cannot be accessed');
        const parent = path.dirname(probe);
        if (parent === probe) throw new WorkspaceError('path cannot be accessed');
        probe = parent;
      }
    }
  }

  read(rel) {
    const file = this.resolve(rel);
    this._assertContained(file);
    let stat;
    try { stat = fs.lstatSync(file); } catch (_error) { throw new WorkspaceError(`no such file: ${rel}`); }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new WorkspaceError(`not a regular file: ${rel}`);
    // The size is known before a byte is read: a huge file is never loaded whole (only the head that can be shown).
    const big = stat.size > this.limits.maxReadBytes;
    const text = big ? this._head(file, Math.min(stat.size, this.limits.maxReadChars * 4)) : fs.readFileSync(file, 'utf8');
    const totalChars = big ? stat.size : text.length;
    return big || text.length > this.limits.maxReadChars
      ? { content: text.slice(0, this.limits.maxReadChars), truncated: true, totalChars }
      : { content: text, truncated: false, totalChars };
  }

  _head(file, bytes) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const n = fs.readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  write(rel, content) {
    const file = this.resolve(rel);
    if (file === this.root) throw new WorkspaceError('cannot write to the project root itself');
    this._assertContained(file);
    if (typeof content !== 'string') throw new WorkspaceError('content must be a string');
    const bytes = Buffer.byteLength(content);
    if (this.bytesWritten + bytes > this.limits.maxTotalWriteBytes) throw new WorkspaceError('write budget for this task is used up');
    let existing = null;
    try { existing = fs.lstatSync(file); } catch (_error) { /* new file */ }
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new WorkspaceError(`cannot overwrite ${rel}: not a regular file`);
    if (!existing && this._countFiles() >= this.limits.maxFiles) throw new WorkspaceError('too many files in the project');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this._assertContained(file);
    fs.writeFileSync(file, content);
    this.bytesWritten += bytes;
    return { bytes };
  }

  list(rel = '.') {
    const dir = this.resolve(rel);
    this._assertContained(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { throw new WorkspaceError(`no such directory: ${rel}`); }
    const names = entries
      .filter((e) => !BLOCKED_SEGMENTS.has(e.name.toLowerCase()))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return { entries: names.slice(0, this.limits.maxListEntries), truncated: names.length > this.limits.maxListEntries };
  }

  // Counts files, stopping as soon as the limit is reached (a directory with a million entries is never walked to the end).
  _countFiles(dir = this.root, limit = this.limits.maxFiles) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (n >= limit) return n;
      if (e.isDirectory() && !BLOCKED_SEGMENTS.has(e.name)) n += this._countFiles(path.join(dir, e.name), limit - n); else if (e.isFile()) n++;
    }
    return n;
  }
}

module.exports = Object.freeze({ DEFAULT_LIMITS, Workspace, WorkspaceError });
