// vscode/nonce.cjs
// The pane's nonce: 32 random bytes made for each draw of the pane and kept in memory only. A message from the
// pane counts only while it carries the nonce of the latest draw, so a pane left open overnight, or reloaded, and
// a message from anywhere else, press nothing. Drawing again replaces it; clear() leaves none.
'use strict';

const crypto = require('node:crypto');

function makeNonces({ bytes = 32, random = crypto.randomBytes } = {}) {
  let current = null;
  return {
    // A new nonce, which replaces the last one.
    renew() {
      current = random(bytes).toString('hex');
      return current;
    },
    // Whether `given` is the latest nonce. Compared without stopping at the first difference.
    matches(given) {
      if (current === null || typeof given !== 'string' || !/^[0-9a-f]+$/.test(given) || given.length !== current.length) return false;
      return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(current));
    },
    clear() {
      current = null;
    },
  };
}

module.exports = { makeNonces };
