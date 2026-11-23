// scripts/lib/seat-card.js
// The card that offers the First Mate's seat to this window, composed from the seat as it stands. The session start
// shows it, and the host helper composes the same one for the window that records the click, so the words always come
// from the seat file and never from a caller.
import { composeCard } from '../cards/compose.js';
import { TAKEOVER_LABEL, LEAVE_LABEL } from '../state/card-lines.js';
import { seatInUse } from './first-mate-seat.js';

// A span of time in the director's words: just now, 5 minutes ago, 1 hour 20 minutes ago.
export const agoWords = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest === 0 ? '' : ` ${rest} ${rest === 1 ? 'minute' : 'minutes'}`} ago`;
};

// { question, card } for the seat `seat` names, as of `now` (a function returning a Date).
export function seatCard({ seat, now }) {
  const ago = agoWords(now().getTime() - Date.parse(seat.seenAt));
  const inUse = seatInUse(seat, { now });
  return composeCard({
    kind: 'take-over',
    level: 3,
    what: `The First Mate is in another window, session ${seat.session}, last active ${ago}; this window can only read and talk until you move it here.`,
    why: 'Only one window is the First Mate at a time, so two never write the same records or answer the same card.',
    options: [
      { label: TAKEOVER_LABEL, says: `The First Mate moves to this window, and window session ${seat.session} becomes an ordinary session.` },
      { label: LEAVE_LABEL, says: 'The First Mate stays in the other window, and this one stays an ordinary session.' },
    ],
    recommend: inUse ? LEAVE_LABEL : TAKEOVER_LABEL,
    because: inUse ? `the other window was in use ${ago}` : `nothing has been written from the other window since ${ago}`,
    meanwhile: 'This window reads and talks, and leaves Wheelhouse\'s records alone.',
    target: { session: seat.session, since: seat.since },
  });
}
