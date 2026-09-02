'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SpecError, assertRunSpec } = require('../core/spec');
const { ToolError } = require('./jsonrpc');
const { LIMITS, cleanText } = require('./limits');

// The only way a model can name a spec. No separators, no dots, no colons, nothing a file system treats specially.
const SPEC_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Windows resolves these to devices even with an extension (nul.json is the NUL device), so they are never names.
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

function isSpecName(value) {
  return typeof value === 'string' && SPEC_NAME.test(value) && !RESERVED_DEVICE.test(value);
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The allowlisted directory of human-approved specs. Specs are trusted code (their commands run as the server's user);
 * this class only makes sure the model can pick one of them by name and nothing else.
 */
class SpecStore {
  constructor(dir) {
    if (typeof dir !== 'string' || !dir) throw new TypeError('spec directory is required');
    this.dir = fs.realpathSync(dir);
    if (!fs.statSync(this.dir).isDirectory()) throw new TypeError('spec directory is not a directory');
  }

  // Returns the validated absolute path of <dir>/<name>.json, or throws a ToolError that does not echo any path.
  resolve(name) {
    if (!isSpecName(name)) {
      throw new ToolError('INVALID_SPEC_NAME', 'spec must be a name matching ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase letters, digits and hyphens; no paths or extensions); call warrant_list_specs for the approved names');
    }
    const file = path.join(this.dir, `${name}.json`);
    const notFound = () => new ToolError('SPEC_NOT_FOUND', `no approved spec named ${JSON.stringify(name)}; call warrant_list_specs`);
    let stat;
    try { stat = fs.lstatSync(file); } catch (_error) { throw notFound(); }
    if (stat.isSymbolicLink()) throw new ToolError('SPEC_REFUSED', `spec ${JSON.stringify(name)} is a symbolic link; refused`);
    if (!stat.isFile()) throw notFound();
    let real;
    try { real = fs.realpathSync(file); } catch (_error) { throw notFound(); }
    if (!samePath(real, file)) throw new ToolError('SPEC_REFUSED', `spec ${JSON.stringify(name)} does not resolve inside the spec directory; refused`);
    return { file, stat };
  }

  // Reads, size-limits and validates a spec by name. `raw` is the parsed (unfrozen) JSON, `digest` the sha256 of the file bytes.
  read(name) {
    const { file, stat } = this.resolve(name);
    let text;
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.size > LIMITS.maxSpecBytes) throw new ToolError('SPEC_REFUSED', `spec ${JSON.stringify(name)} is not a regular file of at most ${LIMITS.maxSpecBytes} bytes`);
      if (opened.ino && stat.ino && (opened.ino !== stat.ino || opened.dev !== stat.dev)) throw new ToolError('SPEC_REFUSED', `spec ${JSON.stringify(name)} changed while it was being read`);
      const buf = Buffer.alloc(opened.size);
      fs.readSync(fd, buf, 0, opened.size, 0);
      text = buf.toString('utf8');
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError('SPEC_UNREADABLE', `spec ${JSON.stringify(name)} cannot be read`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    let raw;
    try { raw = JSON.parse(text); } catch (_error) { throw new ToolError('SPEC_INVALID', `spec ${JSON.stringify(name)} is not valid JSON`); }
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    return { name, raw, digest, dir: this.dir };
  }

  // A spec ready to run, with the run id chosen by the server. The id inside the spec file is never used.
  load(name, runId) {
    const loaded = this.read(name);
    if (loaded.raw === null || typeof loaded.raw !== 'object' || Array.isArray(loaded.raw)) throw new ToolError('SPEC_INVALID', `spec ${JSON.stringify(name)} must be a JSON object`);
    let spec;
    try { spec = assertRunSpec({ ...loaded.raw, run_id: runId }); } catch (error) {
      if (error instanceof SpecError) throw new ToolError('SPEC_INVALID', cleanText(`spec ${JSON.stringify(name)} failed validation: ${error.errors.slice(0, 3).join('; ')}`, 400));
      throw error;
    }
    return { ...loaded, spec };
  }

  // Names, task counts and descriptions of the specs in the directory. Files that cannot be a spec name are ignored;
  // ones that are named like a spec but fail to validate are listed as invalid so a human can see why a name is missing.
  list() {
    let entries;
    try { entries = fs.readdirSync(this.dir, { withFileTypes: true }); } catch (_error) { return { specs: [], invalid: [] }; }
    const names = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -5))
      .filter(isSpecName)
      .sort();
    const specs = [];
    const invalid = [];
    for (const name of names.slice(0, LIMITS.maxSpecsListed)) {
      try {
        const loaded = this.load(name, 'mcp-000000000000');
        specs.push({
          name,
          tasks: loaded.spec.tasks.length,
          max_concurrency: loaded.spec.max_concurrency,
          task_ids: loaded.spec.tasks.slice(0, LIMITS.maxTaskIdsListed).map((t) => t.id),
          description: this._description(name) || `${loaded.spec.tasks.length} task(s): ${loaded.spec.tasks.slice(0, 8).map((t) => t.id).join(', ')}`,
        });
      } catch (error) {
        invalid.push({ name, error: cleanText(error instanceof ToolError ? error.message : 'unreadable', 300) });
      }
    }
    return { specs, invalid, more: names.length > LIMITS.maxSpecsListed };
  }

  // Optional one-line human description in <name>.description.txt next to the spec (specs themselves carry no free text).
  _description(name) {
    const file = path.join(this.dir, `${name}.description.txt`);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
      const first = fs.readFileSync(file, 'utf8').split('\n')[0];
      return cleanText(first, LIMITS.maxDescriptionChars) || null;
    } catch (_error) { return null; }
  }
}

module.exports = Object.freeze({ SPEC_NAME, SpecStore, isSpecName });
