'use strict';

const path = require('node:path');
const { MessageChannel, Worker, receiveMessageOnPort } = require('node:worker_threads');

const PREFIX = '@@wrp ';
const MAX_LINE = 64 * 1024 * 1024;

// A duplex line channel over two inherited descriptors, with a synchronous receive path.
// Reading and writing happen in worker threads; the main thread either gets messages through the port's 'message' event
// (event loop running) or pulls them with poll()/block() while it is waiting synchronously for a reply.
class Channel {
  constructor({ inFd, outFd, prefix = PREFIX }) {
    this.flag = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.reader = new Worker(path.join(__dirname, 'io-reader.js'), { workerData: { fd: inFd, port: port2, flag: this.flag, prefix, maxLine: MAX_LINE }, transferList: [port2] });
    this.writer = new Worker(path.join(__dirname, 'io-writer.js'), { workerData: { fd: outFd, prefix } });
    this.reader.unref();
    this.writer.unref();
  }

  send(text) { this.writer.postMessage(text); }

  // The port is unref'd by default: a process that has nothing else to do must be able to finish (node:test ends its run when the
  // event loop drains). Whoever waits for a message on purpose calls ref() for as long as it waits.
  onMessage(handler) { this.port.on('message', handler); this.port.unref(); }

  ref() { this.port.ref(); }

  unref() { this.port.unref(); }

  // One message if one is waiting, else undefined (null means the peer closed the stream).
  poll() {
    const m = receiveMessageOnPort(this.port);
    return m === undefined ? undefined : m.message;
  }

  // Blocks until something may have arrived. The counter is read before the final poll so a wake-up can not be lost.
  wait(pollFirst, timeoutMs = 1000) {
    const seen = Atomics.load(this.flag, 0);
    const m = pollFirst();
    if (m !== undefined) return m;
    Atomics.wait(this.flag, 0, seen, timeoutMs);
    return undefined;
  }
}

module.exports = { Channel, PREFIX };
