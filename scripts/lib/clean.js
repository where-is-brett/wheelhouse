// scripts/lib/clean.js
// Keeping secrets out of what the helper says (scripts/host/helper.js): a connection's own secrets
// and the sign-in in any address (`scheme://user@` or `scheme://user:password@`) become [hidden].
// The setup engine (scripts/setup/engine.js) cleans each card with these before it stores it, so
// the card it stores is the card the helper sends: cleaning a clean text again changes nothing.
// Nothing here imports the helper or setup's writers.

export const CREDENTIAL_URL = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@'"]+@/g;

// The text with each of `secrets` (longest first, as secretsOf gives them) and every address's
// sign-in hidden.
export function hide(text, secrets) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[hidden]');
  return out.replace(CREDENTIAL_URL, '$1[hidden]@');
}

// A value with every string inside it hidden as `hide` does; anything else is left as it is.
export function cleanDeep(value, secrets) {
  if (typeof value === 'string') return hide(value, secrets);
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v, secrets)]));
  }
  return value;
}
