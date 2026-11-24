// adapters/claude-code/sign-in-patterns.js
// How Claude Code words a start that couldn't sign in. The core's sign-in gate (scripts/lib/sign-in-gate.js) classifies a
// failed start's output with these; each agent words its own, so they live with its adapter. A program that wasn't found
// (`no-program`) is told by the system's error, not by words, so it has no pattern here.

// "Not logged in", an invalid key or an expired token: signing in again mends it.
const notSignedIn = Object.freeze([
  /not logged in/i,
  /please run \/login/i,
  /invalid api key/i,
  /oauth token (?:has )?expired/i,
  /authentication[_ ]error/i,
  /\b401\b[^\n]{0,80}(?:unauthori[sz]ed|authenticat)/i,
]);

// An authentication error naming a forbidden organisation or a policy (403): signing in again does not mend it.
const blocked = Object.freeze([
  /\b403\b[^\n]{0,120}(?:organi[sz]ation|polic)/i,
  /(?:organi[sz]ation|polic)[^\n]{0,120}\b403\b/i,
  /forbidden[^\n]{0,120}(?:organi[sz]ation|polic)/i,
  /(?:organi[sz]ation|polic)[^\n]{0,120}forbidden/i,
]);

export const signInPatterns = Object.freeze({ notSignedIn, blocked });

export default signInPatterns;
