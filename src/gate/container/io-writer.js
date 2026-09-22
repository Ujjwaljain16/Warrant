'use strict';

// Worker thread: writes protocol lines to the output descriptor (a socket or pipe) in order, so the main thread never waits for it.
const net = require('node:net');
const { parentPort, workerData } = require('node:worker_threads');

const { fd, prefix } = workerData;
const socket = new net.Socket({ fd, readable: false, writable: true });
socket.on('error', () => {});

parentPort.on('message', (text) => { socket.write(`${prefix}${text}\n`); });
