// vscode/lean.cjs
// The helper inside VS Code's own process, for a Lean project on a computer where no Node.js can be started (design for
// other agents, section 8.5). The helper is Wheelhouse's own script loaded with dynamic import() from the add-on's
// `wheelhouse/` folder, like the desk (desk.cjs), and listens at the usual address. With ADDON_LEAN_READY off it starts
// nothing. VS Code's own program is never run as a Node.js process: the helper's run takes nothing but git, the project's
// test command and the window's own programs, and the one route that starts a Node.js (the foreman's) refuses here.
// A helper that is already answering, another window's or a real one, is used as it is, and this window is its client.
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The scripts this loads, relative to the add-on's `wheelhouse/` folder. The pack walks their imports (scripts/addon/pack.js).
const LEAN_LOADS = Object.freeze({
  helper: 'scripts/host/helper.js',
  numbers: 'scripts/lib/copilot-numbers.js',
  run: 'scripts/lib/run.js',
  paths: 'scripts/lib/paths.js',
  lean: 'scripts/lean/project.js',
});

// The program this extension host is: VS Code's own, which is never run.
const OWN_PROGRAM = process.execPath;
const NODE_NAMES = /^(?:node|nodejs|electron|code|code-insiders|cursor|codium)(?:\.exe)?$/i;
const NO_PROGRAM = 'VS Code\'s own program is never run as Node.js, so Wheelhouse started nothing';

const load = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);

// `run` with a program that is VS Code's own, or a Node.js, refused. Everything else goes on to `run` as it was given.
function guardedRun(run) {
  return async (file, args, options) => {
    const name = path.basename(String(file));
    if (file === OWN_PROGRAM || NODE_NAMES.test(name)) throw new Error(NO_PROGRAM);
    return run(file, args, options);
  };
}

// The helper answers at `address`, by a request of its own.
async function answers(address) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const req = http.get({ socketPath: address, path: '/health', agent: false, timeout: 2000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (text.length < 4096) text += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(text)?.ok === true); } catch { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const nothing = (mode, reason) => ({ mode, reason, stop: async () => {} });

// startLean({ address, root, run, isLean, node, modules })
//   -> Promise<{ mode: 'off' | 'helper' | 'client' | 'failed', stop() }>
// 'off': the switch is off, the project isn't Lean, or a Node.js runs and the usual start serves. 'client': a helper
// answers, so this window uses it. 'helper': the real helper runs in this process, and stop() closes it. 'failed':
// nothing answers and it could not be started. `modules` ({ helper, numbers }) stands in for the add-on's scripts in
// tests. Never throws.
async function startLean({ address, root, run, isLean, node = null, modules } = {}) {
  try {
    const numbers = modules?.numbers ?? await load(root, LEAN_LOADS.numbers);
    if (numbers.ADDON_LEAN_READY !== true) return nothing('off', 'switch');
    if (isLean !== true) return nothing('off', 'not-lean');
    if (typeof node === 'string' && node !== '') return nothing('off', 'node');
    if (await answers(address)) return nothing('client');
    const helperModule = modules?.helper ?? await load(root, LEAN_LOADS.helper);
    const realRun = run ?? (await load(root, LEAN_LOADS.run)).run;
    let helper;
    try {
      helper = await helperModule.startHelper({
        address,
        run: guardedRun(realRun),
        inEditor: true,
        // A Lean project has no host and no connection (its requests are served before either is made).
        adapterFor: async () => { throw new Error('a Lean project has no code host'); },
        envFor: async () => { throw new Error('a Lean project has no connection'); },
        onStop: async () => {},
      });
    } catch {
      // The address was taken between the look and the bind: another window or a real helper has it.
      return (await answers(address)) ? nothing('client') : nothing('failed', 'start');
    }
    let closed = false;
    return {
      mode: 'helper',
      stop: async () => {
        if (closed) return;
        closed = true;
        try { await helper.close(); } catch { /* It was closing already. */ }
      },
    };
  } catch {
    return nothing('failed', 'error');
  }
}

module.exports = { LEAN_LOADS, NO_PROGRAM, guardedRun, answers, startLean };
