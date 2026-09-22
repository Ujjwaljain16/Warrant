'use strict';

// Runs in the SOLUTION container. It loads the agent's code on request and answers the verdict side's calls; it holds no
// hidden test, no expectation and no verdict.
const fs = require('node:fs');
const path = require('node:path');
const { Channel } = require('./channel');
const { Membrane } = require('./membrane');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const root = path.resolve(__dirname, '..');
const channel = new Channel({ inFd: cfg.inFd, outFd: cfg.outFd });
const membrane = new Membrane({ channel, label: 'solution', keepAlive: true });

membrane.onLoad = (file) => {
  if (!cfg.outputs.includes(file)) throw new Error(`${String(file).slice(0, 80)} is not a declared output`);
  return require(path.join(root, file));
};
// The verdict side closing the connection (it is done) does not end this process: the host does that, so a solution container that ended on its own
// before the verdict is complete can only mean the solution ended it (exit, crash, kill, out of memory).
membrane.onClose = () => {};
// This process lives until the host removes the container: the port is closed once the connection ends, so a timer holds the event loop open.
setInterval(() => {}, 1 << 30);
process.on('unhandledRejection', (reason) => {
  try { membrane.send({ op: 'urej', v: membrane.encode(reason) }); } catch (_error) { /* nothing to report */ }
});
