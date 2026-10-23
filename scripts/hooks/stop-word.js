// scripts/hooks/stop-word.js
// The word "stop" typed as a whole prompt turns STOP on, in a Wheelhouse project. The app's
// reminder blocks before the typed line are read past (own-words.js); a prompt that still holds a
// reminder tag after them is not the word.
import fs from 'node:fs';
import { answer, runAndExit, projectOf } from './kit.js';
import { ownWords } from '../lib/own-words.js';
import { setStop } from '../lib/stop.js';
import { projectForFolder } from '../lib/projects.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const CONTEXT = 'STOP is on. Say in one or two lines what was in progress; lifting it is a card for the director.';
const STOP_WORD = /^(?:stop[.!]*|\/(?:wheelhouse:)?stop\b.*)$/i;

export async function decide(input, { dir, projectOf: find = projectOf } = {}) {
  if (typeof input.prompt !== 'string') return undefined;
  const own = ownWords(input.prompt);
  if (own === null || !STOP_WORD.test(own.replace(/\p{Cf}/gu, '').trim())) return undefined;
  // If the project cannot be told, STOP goes on: stopping too much is the safe error.
  let applies = true;
  try {
    applies = find(input.cwd, { dir }) !== null || projectForFolder(fs.realpathSync.native(input.cwd)) !== null;
  } catch {
    applies = true;
  }
  if (!applies) return undefined;
  setStop({ by: 'prompt' });
  return answer.context('UserPromptSubmit', CONTEXT);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'UserPromptSubmit' });
}
