// scripts/lib/pasted-address.js
// A project address pasted on step 3's join question, read one way for everyone that needs it: step 3 (which host to
// use and look on), the plan card, the tools step and the answer's record. Nothing here reaches a host.
import { parseRemote } from '../host/gitlab-base.js';

// A pasted project address typed without its https://, read only where its first part is one of the two hosts Wheelhouse
// works with (github.com/ann/cafe-menu). Any other dotted first part (john.smith/cafe-menu, acme.corp/team/app) is a group
// or user name, not a host, and stays owner/name.
export const withScheme = (text) => (/^(?:www\.)?(?:github|gitlab)\.com\/[^\s]/i.test(text) ? `https://${text}` : text);

// Hosts that are other places to keep code, which Wheelhouse does not work with (and github.* hosts that are not github.com).
const OTHER_FORGES = /^(?:www\.)?(?:bitbucket\.org|dev\.azure\.com|codeberg\.org)$/;
const isOtherForge = (hostname) => OTHER_FORGES.test(hostname) || (/^github\./.test(hostname) && hostname !== 'github.com');

// A host that is no company's GitLab: loopback, link-local and bare addresses, in any form a URL reads (127.x, 0x7f.1, [::1]).
const isBareHost = (hostname) => !hostname.includes('.') || hostname.startsWith('[') || /^[\d.]+$/.test(hostname) || /^0x/i.test(hostname)
  || hostname === 'localhost' || hostname.endsWith('.localhost');

// The host a pasted project address names, as parseRemote reads it, or null for text that is no address. Only https://,
// ssh:// and git@host: forms are read. { unreadable: true } is an address-looking text that cannot be read (another scheme,
// a bad port, spaces, a loopback or bare-IP host); { forge: true } is one on another place to keep code.
export function pastedAddress(text) {
  const named = withScheme(String(text ?? '').trim());
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(named)?.[1]?.toLowerCase() ?? null;
  const scp = scheme === null ? /^([^@/\s]+)@[A-Za-z0-9.-]+:(?!\/\/)/.exec(named) : null;
  if (scheme === null && scp === null) return null;
  if (scheme !== null ? scheme !== 'https' && scheme !== 'ssh' : scp[1] !== 'git') return { unreadable: true };
  let parts;
  try {
    parts = parseRemote(named);
  } catch {
    return { unreadable: true };
  }
  if (isBareHost(parts.hostname)) return { unreadable: true };
  return isOtherForge(parts.hostname) ? { forge: true } : parts;
}

// Which code host a pasted address names: 'github' for github.com, else 'gitlab'; null while the join answer is no readable
// address. The one reading step 3 uses (pinOf in host.js), so no host is named here that step 3 then refuses.
export const hostOfAddress = (parts) => (parts === null || parts.unreadable || parts.forge ? null : parts.hostname === 'github.com' || parts.hostname === 'www.github.com' ? 'github' : 'gitlab');


// The text of a pasted address with anything a secret could sit in taken out, for keeping: the user and token written before
// the host of an https:// or ssh:// address, and any query string, ;parameters or #fragment. git@host:path keeps its git@.
// It reads as the same address as the text it came from.
export const withoutSecrets = (text) => String(text ?? '').replace(/^(\s*[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#\s]*@/, '$1').replace(/[;?#].*$/, '');
