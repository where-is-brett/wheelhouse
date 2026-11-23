// vscode/nonce.cjs
// The panel's nonce: 32 random bytes made for each draw of the panel and kept in memory only. A message from the
// panel counts only while it carries the nonce of the latest draw, so a panel left open overnight, or reloaded, and
// a message from anywhere else, press nothing. Drawing again replaces it; clear() leaves none.
'use strict';

const crypto = require('node:crypto');

// Two nonces compared without stopping at the first difference. Anything that isn't a non-empty string never matches.
function sameNonce(given, latest) {
  if (typeof given !== 'string' || typeof latest !== 'string' || latest === '' || given.length !== latest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(latest));
}

function makeNonces({ bytes = 32, random = crypto.randomBytes } = {}) {
  let current = null;
  return {
    // A new nonce, which replaces the last one.
    renew() {
      current = random(bytes).toString('hex');
      return current;
    },
    // The latest nonce, or null before the first draw: what press() compares a message's nonce with.
    latest() {
      return current;
    },
    // Whether `given` is the latest nonce.
    matches(given) {
      return sameNonce(given, current);
    },
    clear() {
      current = null;
    },
  };
}

module.exports = { makeNonces, sameNonce };
