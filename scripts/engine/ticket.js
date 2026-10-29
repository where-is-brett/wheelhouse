// scripts/engine/ticket.js
// A run's ticket: the proof a step of the run gives the helper's /engine/ routes. The helper makes one when it starts
// a run, keeps only its hash, and writes the ticket into the run's own artefacts folder, which only that run's steps
// can read (the sandbox keeps every other run's artefacts from an agent). A process that knows a run's id but can't
// read its artefacts can call nothing for it. The pack's steps name the folder with `--artefacts "$ARTIFACTS_DIR"`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TICKET_FILE = '.wheelhouse-ticket';
const TICKET = /^[0-9a-f]{64}$/;
// How long a step waits for its ticket: the helper writes it just after the engine takes the run.
const WAIT_MS = 10000;
const STEP_MS = 200;

export const newTicket = () => crypto.randomBytes(32).toString('hex');
export const ticketHash = (ticket) => crypto.createHash('sha256').update(String(ticket)).digest('hex');

// Whether `ticket` is the one whose hash is `hash`, compared in constant time.
export function ticketMatches(ticket, hash) {
  if (typeof ticket !== 'string' || !TICKET.test(ticket) || typeof hash !== 'string' || !TICKET.test(hash)) return false;
  return crypto.timingSafeEqual(Buffer.from(ticketHash(ticket), 'hex'), Buffer.from(hash, 'hex'));
}

// Writes the run's ticket into its artefacts folder, readable by this user only.
export function writeTicket(artefacts, ticket) {
  fs.mkdirSync(artefacts, { recursive: true });
  fs.writeFileSync(path.join(artefacts, TICKET_FILE), `${ticket}\n`, { mode: 0o600 });
}

// The ticket in `artefacts`, waiting up to `waitMs` for the helper to write it; null when there is none.
export async function readTicket(artefacts, { waitMs = WAIT_MS } = {}) {
  if (typeof artefacts !== 'string' || !path.isAbsolute(artefacts)) return null;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const text = fs.readFileSync(path.join(artefacts, TICKET_FILE), 'utf8').trim();
      if (TICKET.test(text)) return text;
    } catch { /* not written yet */ }
    if (Date.now() >= until) return null;
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
  }
}

// `client` with each of its engine calls carrying the run's ticket, read from `--artefacts <folder>` in `argv`.
export function withTicket(client, argv, { waitMs } = {}) {
  if (!client?.engine) return client;
  let ticket;
  const at = Array.isArray(argv) ? argv.indexOf('--artefacts') : -1;
  const folder = at >= 0 ? argv[at + 1] : null;
  const theTicket = async () => (ticket ??= await readTicket(folder, { waitMs }));
  const engine = Object.fromEntries(Object.entries(client.engine).map(([name, call]) => [name, async (args = {}) => {
    const found = await theTicket();
    return call(found ? { ...args, ticket: found } : args);
  }]));
  return { ...client, engine };
}
