'use strict';
// Runs INSIDE the container as `node -e <this file> <options json>`. It is the only code the image starts with:
//   1. reads a bundle of files from stdin (9-byte length header, then JSON) into /work, which is a size-limited tmpfs,
//      so no host directory is ever mounted into the container;
//   2. starts the real command there with a hard deadline of its own (it still fires if the host process dies);
//   3. in proto mode connects descriptors 3 (input) and 4 (output) of the command to a TCP connection on the loopback interface of the
//      container's network namespace (opts.link: one container listens, the other, which shares that namespace, connects), so two containers can
//      talk without the host in the data path, and merges the command's stdout/stderr into stderr. Without opts.link it relays stdin/stdout.
const fs = require('fs');
const cp = require('child_process');
const net = require('net');
const path = require('path');

const opts = JSON.parse(process.argv[1]);
// Tells the host that the container is up: from here on, whatever is on stderr came from inside, not from the docker CLI.
process.stderr.write('@@warrant-boot\n');
const pause = new Int32Array(new SharedArrayBuffer(4));

function readExact(n) {
  const buf = Buffer.alloc(n);
  let got = 0;
  while (got < n) {
    try {
      const r = fs.readSync(0, buf, got, n - got, null);
      if (r === 0) throw new Error('bundle ended early');
      got += r;
    } catch (e) {
      if (e.code === 'EAGAIN') { Atomics.wait(pause, 0, 0, 5); continue; }
      throw e;
    }
  }
  return buf;
}

const length = parseInt(readExact(9).toString('latin1'), 10);
if (!(length >= 0 && length <= opts.maxBundle)) { process.stderr.write('bad bundle\n'); process.exit(125); }
const bundle = JSON.parse(readExact(length).toString('utf8'));
for (const f of bundle.files) {
  const dest = path.resolve('/work', f.p);
  if (!dest.startsWith('/work/')) { process.stderr.write('bad bundle path\n'); process.exit(125); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(f.d, 'base64'), { mode: 0o644 });
}

const child = cp.spawn(opts.argv[0], opts.argv.slice(1), {
  cwd: '/work', env: process.env, stdio: opts.proto ? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
});
let forwarded = 0;
function relayText(stream) {
  stream.on('data', (chunk) => {
    const room = opts.maxStderr - forwarded;
    if (room <= 0) return;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    forwarded += part.length;
    process.stderr.write(part);
  });
}
if (opts.proto) {
  relayText(child.stdout);
  relayText(child.stderr);
  child.stdio[3].on('error', () => {});
  child.stdio[4].on('error', () => {});
  if (opts.link) {
    // One connection only: the listener closes after the first, so nothing that runs later can take the peer's place.
    const bridge = (sock) => {
      sock.setNoDelay(true);
      sock.on('error', () => { try { child.stdio[3].end(); } catch (e) { /* gone */ } });
      sock.on('close', () => { try { child.stdio[3].end(); } catch (e) { /* gone */ } });
      sock.pipe(child.stdio[3]);
      child.stdio[4].pipe(sock);
    };
    if (opts.link.role === 'listen') {
      const server = net.createServer((sock) => { server.close(); bridge(sock); });
      server.listen(opts.link.port, '127.0.0.1');
    } else {
      const attempt = () => {
        const sock = net.connect(opts.link.port, '127.0.0.1');
        sock.once('connect', () => bridge(sock));
        sock.once('error', () => setTimeout(attempt, 25));
      };
      attempt();
    }
  } else {
    process.stdin.on('error', () => {});
    process.stdin.pipe(child.stdio[3]);
    child.stdio[4].pipe(process.stdout, { end: false });
  }
}
setTimeout(() => {
  try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
  setTimeout(() => process.exit(124), 300);
}, opts.deadlineMs);
child.on('error', (e) => { process.stderr.write(`cannot start: ${e.code}\n`); process.exit(127); });
child.on('close', (code, signal) => process.exit(code === null ? 128 + ({ SIGKILL: 9, SIGTERM: 15, SIGSEGV: 11, SIGABRT: 6 }[signal] || 1) : code));
