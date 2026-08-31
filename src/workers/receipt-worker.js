'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CommandWorker } = require('./command-worker');
const { FILES, ReceiptError, readRecord, verifyReceipt, writeFileAtomic } = require('./receipt');

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * CommandWorker plus `reconcile`, for commands that follow the receipt protocol (src/workers/receipt.js) and are marked
 * `"exec": { "argv": [...], "receipt": true }` in the spec. A task without that flag runs exactly as it does under
 * CommandWorker and has no reconcile evidence.
 *
 * The protocol, for a command: write `effect.intent` just before the external effect; write the declared output files;
 * then write `receipt.json` (output digests + the idempotency key) atomically as the very last step.
 *
 * What `reconcile` concludes for an attempt, strictly from files and the process table:
 *   receipt.json valid and its output digests match   -> applied, with those artifacts (the engine still runs the gate)
 *   no receipt, process certainly gone, command exited non-zero or was killed, and it never wrote effect.intent
 *                                                     -> not applied (the engine may run the task again)
 *   anything else (the process may still be running, effect.intent exists without a receipt, exit 0 without a receipt,
 *   an unreadable or inconsistent record)             -> inconclusive: reconcile throws, the engine leaves the task `unknown`
 *
 * Limits, honestly: "not applied" is only as true as the command's promise to write effect.intent before its effect;
 * a command that breaks that promise can cause a repeated effect. Liveness is a pid check (pid reuse errs toward
 * "alive", i.e. toward unknown); grandchildren that outlive their parent are not tracked. Receipts are crash-safe, not
 * power-loss-safe. This is not a sandbox and it does not authenticate the command: a command can forge its own receipt.
 */
class ReceiptWorker extends CommandWorker {
  _usesReceipt(task) {
    return Boolean(task && task.exec && task.exec.receipt === true);
  }

  _record(dir, patch) {
    const file = path.join(dir, FILES.attempt);
    writeFileAtomic(file, `${JSON.stringify({ ...readRecord(file), ...patch })}\n`);
  }

  _prepare(info, dir) {
    if (!this._usesReceipt(info.task)) return;
    // Written before the process exists, so "no record" can only mean "this attempt never got as far as starting".
    writeFileAtomic(path.join(dir, FILES.attempt), `${JSON.stringify({
      version: 1, run_id: info.runId, task: info.taskId, attempt: info.attemptId, idempotency_key: info.idempotencyKey, pid: null, exit: null,
    })}\n`);
  }

  _onSpawn(info, dir, pid) {
    if (this._usesReceipt(info.task)) this._record(dir, { pid });
  }

  _onExit(info, dir, result) {
    if (this._usesReceipt(info.task)) this._record(dir, { exit: result.exitCode });
  }

  // A receipt command that exits 0 must have a valid receipt. If it does not, the effect may or may not have happened,
  // so this throws: the engine treats that as a crash, asks reconcile, and (finding the same evidence) ends `unknown`.
  _collect(info, dir) {
    if (!this._usesReceipt(info.task)) return super._collect(info, dir);
    const verified = verifyReceipt({
      dir, idempotencyKey: info.idempotencyKey, outputs: info.task.outputs, readOutput: (d, name) => this._readOutput(d, name),
    });
    if (verified === null) throw new ReceiptError('RECEIPT_MISSING', 'command exited 0 without writing a receipt');
    return verified.artifacts;
  }

  async reconcile(info) {
    const { runId, taskId, attemptId, idempotencyKey, task } = info;
    const dir = this.attemptDir(runId, attemptId);
    const attempt = readRecord(path.join(dir, FILES.attempt));
    if (attempt === null) throw new ReceiptError('NO_ATTEMPT_RECORD', 'no attempt record: the task does not use receipts, or the attempt never started');
    if (attempt.run_id !== runId || attempt.task !== taskId || attempt.attempt !== attemptId || attempt.idempotency_key !== idempotencyKey) {
      throw new ReceiptError('ATTEMPT_RECORD_MISMATCH', 'attempt record belongs to a different attempt');
    }
    const verified = verifyReceipt({ dir, idempotencyKey, outputs: task.outputs, readOutput: (d, name) => this._readOutput(d, name) });
    if (verified !== null) return { applied: true, artifacts: verified.artifacts };

    // No receipt. Absence proves nothing unless every route to an unrecorded effect is closed.
    if (!Number.isInteger(attempt.pid)) throw new ReceiptError('PID_UNKNOWN', 'the process may have started without being recorded');
    if (processAlive(attempt.pid)) throw new ReceiptError('PROCESS_MAY_BE_RUNNING', `process ${attempt.pid} is still alive`);
    if (attempt.exit === 0) throw new ReceiptError('EXITED_WITHOUT_RECEIPT', 'the command reported success but left no receipt');
    if (fs.existsSync(path.join(dir, FILES.intent))) throw new ReceiptError('INTENT_WITHOUT_RECEIPT', 'the command began its effect and left no receipt');
    return { applied: false };
  }
}

module.exports = Object.freeze({ ReceiptWorker });
