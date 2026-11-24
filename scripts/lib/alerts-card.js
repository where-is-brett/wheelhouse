// scripts/lib/alerts-card.js
// The card that asks before a phone-alert channel is kept or forgotten. The director's click on it, in the chat, is what lets the
// helper save or remove the channel's key: the card names the channel and the step, and its set line carries the first twelve
// characters of the hash of the request, so a click is for that request and no other. What the request holds (a topic, a chat)
// stays with the helper and is never in the card.
import crypto from 'node:crypto';
import { canonicalJson } from './canonical.js';

export const ALERTS_LINE = /^Phone alerts: (keep-ntfy|keep-telegram|forget-ntfy|forget-telegram) ([0-9a-f]{12})$/;
export const ALERTS_STEPS = Object.freeze(['keep-ntfy', 'keep-telegram', 'forget-ntfy', 'forget-telegram']);

// The sha256, in full, of the request: its step and what it holds.
export const alertsHash = (step, request) => crypto.createHash('sha256').update(canonicalJson({ step, request })).digest('hex');
export const alertsLine = (step, hash) => `Phone alerts: ${step} ${hash.slice(0, 12)}`;

const WHAT = {
  'keep-ntfy': (where) => `Keep an ntfy topic for phone alerts on the server ${where}?`,
  'keep-telegram': (where) => `Keep Telegram for phone alerts, sending to the chat ${where}? You will be asked for the bot token next, in the system's own hidden-entry box.`,
  'forget-ntfy': () => 'Forget the ntfy channel for phone alerts? No more alerts will go through it.',
  'forget-telegram': () => 'Forget the Telegram channel for phone alerts? No more alerts will go through it.',
};

// The card for `step` and the request's hash; `where` is the server or chat it names, shown as the director would know it.
export function alertsCard(step, hash, where = '') {
  return {
    question: [
      WHAT[step](where),
      'Alerts say only that decisions wait and in which project. You can change this later.',
      alertsLine(step, hash),
    ].join('\n'),
    header: 'Phone alerts',
    options: ['Yes', 'Not now'],
    kind: 'runbook',
    level: 3,
    line: alertsLine(step, hash),
  };
}
