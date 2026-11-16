'use strict';
// Adapter between warrant and any command-line coding agent.
//
//   node run-agent.js -- <agent command and arguments...>
//
// warrant runs this in a fresh attempt directory. It copies in what the agent may see (the prompt and the visible tests, never the
// hidden ones), starts the agent there with "{prompt}" in its arguments replaced by the prompt text, and passes the agent's exit code
// through. The agent's output goes to stderr, which warrant keeps (redacted) in the attempt directory when it fails. Whatever the
// agent says about its work is irrelevant: warrant reads the declared output file and gates it with the requirements in the spec.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sep = process.argv.indexOf('--');
const agent = sep < 0 ? [] : process.argv.slice(sep + 1);
if (!agent.length) {
  process.stderr.write('usage: node run-agent.js -- <agent command...>\n');
  process.exit(2);
}

const taskDir = path.join(__dirname, 'task');
for (const name of fs.readdirSync(taskDir)) fs.copyFileSync(path.join(taskDir, name), path.join(process.cwd(), name));
const prompt = fs.readFileSync(path.join(taskDir, 'prompt.md'), 'utf8');

// On Windows a command installed by npm (claude, codex, ...) is a .cmd shim, which cannot be started without a shell, and a shell
// would have to re-quote the prompt. Find the shim on PATH and run the script it points to with Node instead.
function windowsCommand(name) {
  if (process.platform !== 'win32' || /[\\/.]/.test(name)) return null;
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return { command: exe, prefix: [] };
    const shim = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(shim)) {
      const match = /"%dp0%\\([^"]+\.(?:c|m)?js)"/.exec(fs.readFileSync(shim, 'utf8'));
      if (match) return { command: process.execPath, prefix: [path.join(dir, match[1])] };
    }
  }
  return null;
}

const argv = agent.map((arg) => arg.split('{prompt}').join(prompt));
const resolved = argv.slice(1).map((arg) => (/^\.\.?[\\/]/.test(arg) ? path.resolve(__dirname, arg) : arg));
// `node` means the Node binary running this script, so the offline agents work without PATH lookups.
const win = argv[0] === 'node' ? null : windowsCommand(argv[0]);
const command = argv[0] === 'node' ? process.execPath : win ? win.command : argv[0];
const args = win ? [...win.prefix, ...resolved] : resolved;
const result = spawnSync(command, args, { cwd: process.cwd(), stdio: ['ignore', 2, 2], env: process.env, timeout: 15 * 60 * 1000 });
if (result.error) {
  process.stderr.write(`could not start the agent: ${result.error.code || result.error.message}\n`);
  process.exit(127);
}
process.exit(result.status === null ? 1 : result.status);
