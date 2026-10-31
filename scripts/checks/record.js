// scripts/checks/record.js
// The signed record of a check (spec 4.3): the result stands here first, and only then is it reported.
import crypto from 'node:crypto';
import { makeEvent, writeEvent } from '../state/events.js';
import { tailOf } from '../lib/output-tail.js';

const TAIL = 4096;

// What a check names its command by: a changed command is a different check. No command has no digest.
export function commandDigest(command) {
  if (typeof command !== 'string') return null;
  return crypto.createHash('sha256').update(command).digest('hex');
}

// Signs and writes the result. The tail is cut and scanned here, so the event's own secret scan never refuses it.
export async function writeCheck(project, result, { write = writeEvent } = {}) {
  const { commit, command, result: word, minutes, tail } = result;
  const event = makeEvent({ kind: 'check', data: { commit, command, result: word, minutes, tail: tailOf(tail, TAIL) } });
  await write({ project, event });
  return event;
}
