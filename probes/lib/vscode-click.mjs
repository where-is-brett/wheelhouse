// probes/lib/vscode-click.mjs
// Trial harness only: answers a card in a scratch VS Code window by a real mouse click, for an agent that cannot click it
// (VS Code is "click" tier for computer-use, and a scratch window is often not visible to it). It talks to the window over
// Chromium's debugging port, so the window must be a scratch one started with --remote-debugging-port, a profile of its own
// (--user-data-dir) and no CLAUDE_* variables. Nothing in the product reads this, and nothing here types an answer: it finds
// the card's button on the screen and sends the mouse press and release to its middle, as a person's hand does.
//
//   node probes/lib/vscode-click.mjs list  [--port 9333] [--within <css selector>]
//   node probes/lib/vscode-click.mjs click "<button label>" [--port 9333] [--within <css selector>]
//
// `list` prints the visible buttons and options. `click` presses the one whose text is exactly the label (or the only
// one that starts with it), and says what it pressed; it refuses when none or several match. The agent reads the card
// first (list) and presses what the card offers; it does not press Approve for a card it has not read.
import process from 'node:process';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const port = flag('port', '9333');
const within = flag('within', 'body');
const [command, label] = args;

async function workbench() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && /workbench\.html/.test(t.url));
  if (!page) throw new Error('no VS Code window answers on that port');
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  };
  const ready = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('cannot connect')); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => socket.close() };
}

// The visible clickable things inside `within`, with the middle of each one on the screen.
const FIND = (scope) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
  const seen = [];
  for (const el of root.querySelectorAll('button, [role="button"], [role="option"], [role="radio"], [role="checkbox"], a.monaco-button, .monaco-button')) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || style.visibility === 'hidden' || style.display === 'none' || el.disabled) continue;
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    if (text) seen.push({ text, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  }
  return seen;
})()`;

async function main() {
  if (!['list', 'click'].includes(command) || (command === 'click' && !label)) {
    process.stderr.write('usage: vscode-click.mjs list | click "<label>"  [--port N] [--within selector]\n');
    process.exit(2);
  }
  const client = connect(await workbench());
  await client.ready;
  const { result } = await client.send('Runtime.evaluate', { expression: FIND(within), returnByValue: true });
  const buttons = result.value ?? [];
  if (command === 'list') {
    for (const b of buttons) process.stdout.write(`${b.text}\n`);
    client.close();
    return;
  }
  let found = buttons.filter((b) => b.text === label);
  if (found.length === 0) found = buttons.filter((b) => b.text.startsWith(label));
  if (found.length !== 1) {
    process.stderr.write(found.length === 0 ? `No button says "${label}". Seen: ${buttons.map((b) => b.text).join(' | ')}\n` : `${found.length} buttons match "${label}"; narrow it with --within.\n`);
    client.close();
    process.exit(1);
  }
  const { x, y, text } = found[0];
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  process.stdout.write(`Pressed "${text}"\n`);
  client.close();
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
