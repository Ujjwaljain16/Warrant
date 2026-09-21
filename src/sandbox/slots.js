'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A counting semaphore shared by every process on the machine, for "at most N containers at once". The docker CLI fails under memory
// pressure when several containers start together (seen with three parallel task checks), and the benchmark runs several processes
// (the harness, and one gate subprocess per engine run), so an in-process counter is not enough.
//
// Slot i is the file <dir>/slot-<i>, created exclusively and holding the owner's pid. A holder that died is detected by its pid and its slot
// reclaimed. A request for n slots takes n or none (and backs off at random), so two requests for two slots can not deadlock each other.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

class SlotPool {
  constructor({ dir = path.join(os.tmpdir(), 'warrant-sandbox-slots'), limit = 2, pollMs = 120 } = {}) {
    this.dir = dir;
    this.limit = limit;
    this.pollMs = pollMs;
    this.queue = Promise.resolve(); // requests of this process are served one at a time, in order
  }

  _file(i) {
    return path.join(this.dir, `slot-${i}`);
  }

  _tryTake(i) {
    const file = this._file(i);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(file, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
        let owner = NaN;
        try { owner = Number(fs.readFileSync(file, 'utf8')); } catch (_ignored) { /* just released, or being written */ }
        if (Number.isInteger(owner) && owner > 0 && !alive(owner)) { try { fs.unlinkSync(file); } catch (_ignored) { /* someone else reclaimed it */ } continue; }
        return false;
      }
    }
    return false;
  }

  _release(held) {
    for (const i of held) { try { fs.unlinkSync(this._file(i)); } catch (_ignored) { /* already gone */ } }
  }

  async _acquire(n) {
    fs.mkdirSync(this.dir, { recursive: true });
    for (;;) {
      const held = [];
      for (let i = 0; i < this.limit && held.length < n; i++) if (this._tryTake(i)) held.push(i);
      if (held.length === n) return held;
      this._release(held);
      await sleep(this.pollMs + Math.floor(Math.random() * this.pollMs));
    }
  }

  /** Resolves with release() once `n` slots (capped at the limit) are held by this process. */
  acquire(n = 1) {
    const want = Math.min(n, this.limit);
    const taken = this.queue.then(() => this._acquire(want));
    this.queue = taken.then(() => {}, () => {});
    return taken.then((held) => {
      let released = false;
      return () => { if (!released) { released = true; this._release(held); } };
    });
  }
}

module.exports = Object.freeze({ SlotPool });
