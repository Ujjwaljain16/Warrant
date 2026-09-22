'use strict';

// Worker thread: reads the protocol input descriptor (a socket or pipe) with its own event loop, so that terminating the
// process never has to wait for a blocked read. Every complete line that starts with the prefix is posted to the main
// thread, which may be blocked in Atomics.wait, so the thread also bumps a shared counter and wakes it.
const net = require('node:net');
const { workerData } = require('node:worker_threads');

const { fd, port, flag, prefix, maxLine } = workerData;
const prefixBytes = Buffer.from(prefix);
let pending = [];
let pendingBytes = 0;
let closed = false;

function publish(message) {
  port.postMessage(message);
  Atomics.add(flag, 0, 1);
  Atomics.notify(flag, 0);
}

function end() {
  if (closed) return;
  closed = true;
  publish(null);
}

function line(buf) {
  if (buf.length > prefixBytes.length && buf.subarray(0, prefixBytes.length).equals(prefixBytes)) publish(buf.subarray(prefixBytes.length).toString('utf8'));
}

const socket = new net.Socket({ fd, readable: true, writable: false });
socket.on('error', end);
socket.on('close', end);
socket.on('end', end);
socket.on('data', (chunk) => {
  let start = 0;
  for (;;) {
    const nl = chunk.indexOf(10, start);
    if (nl === -1) break;
    pending.push(chunk.subarray(start, nl));
    line(pending.length === 1 ? pending[0] : Buffer.concat(pending));
    pending = [];
    pendingBytes = 0;
    start = nl + 1;
  }
  if (start < chunk.length) {
    pending.push(chunk.subarray(start));
    pendingBytes += chunk.length - start;
    if (pendingBytes > maxLine) { socket.destroy(); end(); }
  }
});
