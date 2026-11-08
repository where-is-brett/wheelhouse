// scripts/alerts/send.js
// The phone alert (design section 9 of the director's way of working). It says only that something waits and where: a count and
// the project's name, never a decision's words and never a link. Only the helper sends one, because only the helper holds the ntfy
// topic and the Telegram token (scripts/host/helper.js, /alert); this file is the sending itself, with `fetch` given so a test
// never reaches the network.
//
// Nothing here turns a failure into an answer: an alert that can't be sent is reported, and the decision still waits in the chat.

export const NTFY_SERVER = 'https://ntfy.sh';
export const TELEGRAM_SERVER = 'https://api.telegram.org';
export const CHANNELS = Object.freeze(['ntfy', 'telegram']);
// How long one request may take.
export const SEND_MS = 10 * 1000;

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[0-9]{3,20}:[A-Za-z0-9_-]{20,80}$/;
const CHAT = /^-?[0-9]{1,20}$|^@[A-Za-z][A-Za-z0-9_]{3,31}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// What an alert says: a count and the project's name, and nothing else. The name loses any character that could make it a link.
export function alertText({ count, project }) {
  const name = String(project ?? '').replace(/\s+/g, '-').replace(/[:/\\@]+/g, '') || 'the-project';
  return count === 1 ? `1 decision waits in ${name}` : `${count} decisions wait in ${name}`;
}

// Whether `topic` can be an ntfy topic, `token` a Telegram bot token, and `chat` a Telegram chat.
export const goodTopic = (topic) => typeof topic === 'string' && TOPIC.test(topic);
export const goodToken = (token) => typeof token === 'string' && TOKEN.test(token);
export const goodChat = (chat) => typeof chat === 'string' && CHAT.test(chat);

// Whether `now` falls inside the quiet hours { from, to } (local 'HH:MM'; a span that crosses midnight is allowed). None given, or
// from equal to to, is never quiet.
export function inQuiet(quiet, now) {
  if (!isObject(quiet) || !TIME.test(quiet.from) || !TIME.test(quiet.to) || quiet.from === quiet.to) return false;
  const minutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return false;
  const t = at.getHours() * 60 + at.getMinutes();
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  return from < to ? t >= from && t < to : t >= from || t < to;
}

// Whether a channel is set up in `settings` ({ ntfy: { server?, topic }, telegram: { token, chat } }).
export function isSetUp(channel, settings) {
  if (!isObject(settings)) return false;
  if (channel === 'ntfy') return isObject(settings.ntfy) && goodTopic(settings.ntfy.topic);
  if (channel === 'telegram') return isObject(settings.telegram) && goodToken(settings.telegram.token) && goodChat(settings.telegram.chat);
  return false;
}

// The request for one channel: ntfy gets the text as the body and no header but its type (no click, attach or actions);
// Telegram gets sendMessage with link previews off.
function requestFor(channel, settings, text) {
  if (channel === 'ntfy') {
    const server = String(settings.ntfy.server ?? NTFY_SERVER).replace(/\/+$/, '');
    return { url: `${server}/${settings.ntfy.topic}`, init: { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text } };
  }
  return {
    url: `${TELEGRAM_SERVER}/bot${settings.telegram.token}/sendMessage`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegram.chat, text, disable_web_page_preview: true }),
    },
  };
}

// sendAlert({ channel, settings, text, fetch }) -> { sent: true } or { sent: false, reason }. The reason never holds the topic, the
// token or the address, which a failure's own message might.
export async function sendAlert({ channel, settings, text, fetch = globalThis.fetch }) {
  if (!CHANNELS.includes(channel) || !isSetUp(channel, settings)) return { sent: false, reason: 'the channel is not set up' };
  if (typeof fetch !== 'function') return { sent: false, reason: 'there is no way to send' };
  const { url, init } = requestFor(channel, settings, text);
  try {
    const answer = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(SEND_MS) });
    return answer?.ok === true ? { sent: true } : { sent: false, reason: `the service refused it${Number.isInteger(answer?.status) ? ` (status ${answer.status})` : ''}` };
  } catch {
    return { sent: false, reason: 'the service could not be reached' };
  }
}

// deliverAlert({ count, project, notifications, settings, now, fetch }) -> what happened, as
//   { none: true }                          no channel is both switched on in the director's Notifications setting and set up
//   { held: true }                          inside the quiet hours: nothing is sent, and it is asked again later
//   { sent, failed: [channel, ...] }        each channel tried, and once more when it failed; `sent` when any went
// `notifications` is the setting's value ({ channels, quiet? }). Nothing is retried beyond the one more try.
export async function deliverAlert({ count, project, notifications, settings, now = new Date(), fetch }) {
  const switchedOn = Array.isArray(notifications?.channels) ? notifications.channels : [];
  const channels = CHANNELS.filter((c) => switchedOn.includes(c) && isSetUp(c, settings));
  if (channels.length === 0) return { none: true };
  if (inQuiet(notifications?.quiet, typeof now === 'function' ? now() : now)) return { held: true };
  const text = alertText({ count, project });
  let sent = false;
  const failed = [];
  for (const channel of channels) {
    let result = await sendAlert({ channel, settings, text, fetch });
    if (!result.sent) result = await sendAlert({ channel, settings, text, fetch });
    if (result.sent) sent = true;
    else failed.push(channel);
  }
  return { sent, failed };
}
