// scripts/hooks/stop-word.js
// The words "stop" or "all stop" typed as a whole prompt, or /wheelhouse:stop or /wheelhouse:all-stop,
// turn All stop on, in a Wheelhouse project. The app's reminder blocks before the typed line are read
// past (own-words.js); a prompt that still holds a reminder tag after them is not the word.
//
// On an agent whose hooks only read (`writeVia: 'helper'`), STOP is set by the helper (/stop/set, `by: 'prompt'`,
// ruling P5-18), never here. When the helper isn't answering (`helperUp: false`) or doesn't set it, nothing is
// set, and the reply says so with NO_HELPER_STOP (ruling P5-22).
import fs from 'node:fs';
import { answer, runAndExit, projectOf } from './kit.js';
import { ownWords } from '../lib/own-words.js';
import { setStop, NO_HELPER_STOP } from '../lib/stop.js';
import { helperClient } from '../host/helper-client.js';
import { projectForFolder } from '../lib/projects.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const CONTEXT = 'All stop is on. Say in one or two lines what was in progress; lifting it is a card for the director.';
const STOP_WORD = /^(?:(?:all[ \t]+)?stop[.!]*|\/(?:wheelhouse:)?(?:all-)?stop\b.*)$/i;

export async function decide(input, { dir, projectOf: find = projectOf, writeVia = 'self', client, helperUp } = {}) {
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
  if (writeVia !== 'self') {
    if (helperUp === false) return answer.context('UserPromptSubmit', NO_HELPER_STOP);
    const set = await (client ?? helperClient()).stop({ by: 'prompt' });
    return answer.context('UserPromptSubmit', set?.ok === true ? CONTEXT : NO_HELPER_STOP);
  }
  setStop({ by: 'prompt' });
  return answer.context('UserPromptSubmit', CONTEXT);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'UserPromptSubmit' });
}
