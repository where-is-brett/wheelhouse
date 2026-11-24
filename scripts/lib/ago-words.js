// scripts/lib/ago-words.js
// A span of time in the director's words, in a module of its own so a hook that only words a time doesn't load the cards behind a seat card.
// just now, 5 minutes ago, 1 hour 20 minutes ago.
export const agoWords = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest === 0 ? '' : ` ${rest} ${rest === 1 ? 'minute' : 'minutes'}`} ago`;
};
