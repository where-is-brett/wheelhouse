// tests/helpers/setup-session-steps.js
// Steps for the tests of the session kind: step 3 asks the backup question as the real plan does, and step 9 is the
// real phone-notifications step, each planned with the ctx the engine gives (so ctx.desktop is the engine's own).
import { backupChoice } from '../../scripts/setup/local.js';
import { notifyStep } from '../../scripts/setup/notify.js';
import { SETUP_TITLES } from '../../scripts/state/card-lines.js';

const answerOf = (ctx) => (id) => ctx.answers?.[`3.${id}`] ?? null;

export const STEPS = [
  {
    n: 3,
    title: SETUP_TITLES[3],
    async plan(ctx) {
      const got = backupChoice({ answer: answerOf(ctx), name: 'Shop', root: ctx.folder, machine: false, desktop: ctx.desktop === true });
      if (got.ask) return { ask: got.ask };
      return { changes: [], card: { kind: 'setup' }, director: 'One click' };
    },
    async apply() { return []; },
  },
  { ...notifyStep(), after: [] },
];
