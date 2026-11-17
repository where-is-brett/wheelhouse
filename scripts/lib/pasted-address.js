// scripts/lib/pasted-address.js
// A project address pasted on step 3's join question, read one way for everyone that needs it: step 3 (which host to
// use and look on), the plan card, the tools step and the answer's record. Nothing here reaches a host.
import { DEFAULT_GITLAB, parseRemote, hostWords } from '../host/gitlab-base.js';

// A pasted project address typed without its https://, read only where its first part is one of the two hosts Wheelhouse
// works with (github.com/ann/cafe-menu). Any other dotted first part (john.smith/cafe-menu, acme.corp/team/app) is a group
// or user name, not a host, and stays owner/name.
export const withScheme = (text) => (/^(?:www\.)?(?:github|gitlab)\.com\/[^\s]/i.test(text) ? `https://${text}` : text);

// Hosts that are other places to keep code, which Wheelhouse does not work with (and github.* hosts that are not github.com).
const OTHER_FORGES = /^(?:www\.)?(?:bitbucket\.org|dev\.azure\.com|codeberg\.org)$/;
const isOtherForge = (hostname) => OTHER_FORGES.test(hostname) || (/^github\./.test(hostname) && hostname !== 'github.com');

// A host name without the root dot a URL allows after it (a public host written with its root dot is the same host).
const unrooted = (hostname) => hostname.replace(/\.$/, '');

// The public GitLab's own host name, from its address.
const PUBLIC_HOST = new URL(DEFAULT_GITLAB).hostname;

// A host that is no company's GitLab: loopback, link-local, internal and bare addresses, in any form a URL reads (127.x, 0x7f.1, [::1]).
const isBareHost = (hostname) => !hostname.includes('.') || hostname.startsWith('[') || /^[\d.]+$/.test(hostname) || /^0x/i.test(hostname)
  || hostname === 'localhost' || /\.(?:localhost|local|internal|home\.arpa|lan|corp|intranet|localdomain)$/.test(hostname);

// The host a pasted project address names, as parseRemote reads it, or null for text that is no address. Only https://,
// ssh:// and git@host: forms are read. { unreadable: true } is an address-looking text that cannot be read (another scheme,
// a bad port, spaces, a loopback or bare-IP host); { forge: true } is one on another place to keep code.
export function pastedAddress(text) {
  const named = withScheme(String(text ?? '').trim());
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(named)?.[1]?.toLowerCase() ?? null;
  const scp = scheme === null ? /^([^@/\s]+)@[A-Za-z0-9.-]+:(?!\/\/)/.exec(named) : null;
  // More than one @ before the host (git@token@host:path) is no address setup reads.
  const many = scheme === null && scp === null && /^[^/\s]+@[^/\s]*@[A-Za-z0-9.-]+:(?!\/\/)/.test(named);
  if (scheme === null && scp === null && !many) return null;
  // Whitespace inside an address means more was pasted than an address, and none of it is read.
  if (many || /\s/.test(named)) return { unreadable: true };
  if (scheme !== null ? scheme !== 'https' && scheme !== 'ssh' : scp[1] !== 'git') return { unreadable: true };
  let parts;
  try {
    parts = parseRemote(named);
  } catch {
    return { unreadable: true };
  }
  // A host written with its root dot (a public host with its root dot, localhost.) is the same host in these checks.
  const hostname = unrooted(parts.hostname);
  if (isBareHost(hostname)) return { unreadable: true };
  // A host in another number form (127.0.0.0x1) is the address a URL reader makes of it, and is checked as that too.
  try {
    if (isBareHost(unrooted(new URL(`https://${hostname}`).hostname))) return { unreadable: true };
  } catch {
    return { unreadable: true };
  }
  return isOtherForge(hostname) ? { forge: true } : parts;
}

// Which code host a pasted address names: 'github' for github.com, else 'gitlab'; null while the join answer is no readable
// address. The one reading step 3 uses (pinOf in host.js), so no host is named here that step 3 then refuses.
export const hostOfAddress = (parts) => (parts === null || parts.unreadable || parts.forge ? null : ['github.com', 'www.github.com'].includes(unrooted(parts.hostname)) ? 'github' : 'gitlab');

// A typed answer to the join question as a repository's name: owner/name (groups too) or a bare
// name, without .git; null for anything else. A pasted project address (https://host/owner/name,
// ssh://git@host/owner/name or git@host:owner/name, with or without .git) reads as its owner/name;
// an address with no path (a bare host) names no project.
export function repoNamed(text) {
  let named = withScheme(String(text ?? '').trim());
  const web = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]*)(.*)$/.exec(named);
  const scp = web ? null : /^[A-Za-z0-9_.-]+@([A-Za-z0-9.-]+):(?!\/\/)(.*)$/.exec(named);
  if (web || scp) {
    const host = (web ? web[1] : scp[1]).replace(/^.*@/, '').replace(/:\d*$/, '').toLowerCase();
    named = (web ? web[2] : scp[2]).split(/[?#]/)[0].replace(/^\/+/, '');
    // A GitLab page's address goes on after '/-/' (ann/cafe-menu/-/tree/main); GitHub's has no such mark, and its
    // repositories are always owner/name, so only the first two parts count (ann/cafe-menu/pulls).
    named = named.replace(/\/-(?:\/.*)?$/, '').replace(/\/+$/, '');
    if (['github.com', 'www.github.com'].includes(unrooted(host))) named = named.split('/').slice(0, 2).join('/');
  }
  named = named.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)*$/.test(named)) return null;
  return named.split('/').some((part) => /^\.+$/.test(part)) ? null : named;
}

// What is kept in place of a join answer that still held a secret once its address was cleaned: nothing of what was typed,
// only these words, which no step reads as a name, so the join card is asked again saying why.
export const HELD_SECRET = 'an address holding a password or key';

// A typed GitLab address as { base, host }: https only, a host name with an optional port, no path.
// `base` is the address as the tools use it, `host` the entry `gitlabHosts` takes (the port with it).
// The public service's own address gives { base: DEFAULT_GITLAB }. Anything else gives { why }.
export function companyAddress(text) {
  const typed = String(text ?? '').trim();
  const shown = typed.length > 50 ? `${typed.slice(0, 50)}...` : typed;
  // Only one run of characters can be an address someone typed: words with spaces in them are a placeholder or a
  // sentence, and the card never quotes them back as the director's address.
  const called = /^\S+$/.test(typed) ? `"${shown}"` : 'What came back';
  if (/^http:\/\//i.test(typed)) return { why: `${called} is not https, and a company's GitLab is reached over https only` };
  // A project's full address is taken too: its host is the GitLab, and its path names the project.
  const [hostPart, ...rest] = typed.replace(/^https:\/\//i, '').split('/');
  const bare = hostPart;
  let repo;
  const segments = rest.join('/').replace(/[?#].*$/, '').split('/-/')[0].replace(/\.git$/i, '').split('/').filter(Boolean);
  // A group's page (the host and one group) is trimmed to the host; a path of two or more names a project.
  if (segments.length > 0) {
    if (!segments.every((part) => /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(part) && !/^\.+$/.test(part))) {
      return { why: `${called} is not a GitLab address: it is a host name and a port if it has one, with no path; or a project's whole address, the host then group/project` };
    }
    if (segments.length > 1) repo = segments.join('/');
  }
  const match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/i.exec(bare);
  if (match === null) return { why: `${called} is not a GitLab address: it is a host name and a port if it has one, with no path` };
  const [, name, port] = match;
  if (!name.includes('.') && name.toLowerCase() !== 'localhost') return { why: `${called} is not a GitLab address: it needs the whole host name, such as gitlab.example.org` };
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return { why: `${called} has a port that is not a port` };
  const url = new URL(`https://${name.toLowerCase()}${port === undefined ? '' : `:${port}`}`);
  if (url.origin === DEFAULT_GITLAB) return { base: DEFAULT_GITLAB, ...(repo === undefined ? {} : { repo }) };
  return { base: url.origin, host: url.host, ...(repo === undefined ? {} : { repo }) };
}

// Where a pasted address says the product is, so no host card is asked: null for text that is no address;
// { unreadable: true } for one setup can't read; { forge: true } for one on another place to keep code; { host: 'github' }
// for github.com; else { host: 'gitlab', company } with the GitLab as the which-GitLab cards give it ({ base } for the
// public service, { base, host } for a company's).
export function pinOf(text) {
  const there = pastedAddress(text);
  if (there === null || there.unreadable || there.forge) return there;
  if (hostOfAddress(there) === 'github') return { host: 'github' };
  const hostname = unrooted(there.hostname);
  if (hostname === PUBLIC_HOST || hostname === `www.${PUBLIC_HOST}`) return { host: 'gitlab', company: { base: DEFAULT_GITLAB } };
  const company = companyAddress(hostWords({ ...there, hostname }));
  if (company.why !== undefined) return { unreadable: true };
  // The address the company's base becomes is checked again, whatever form the host was written in.
  return isBareHost(new URL(company.base).hostname) ? { unreadable: true } : { host: 'gitlab', company };
}

// The text of a pasted address with anything a secret could sit in taken out, for keeping: the user and token written before
// the host, and any query string, ;parameters or #fragment. git@host: keeps its git@. An http(s) address is rebuilt from the
// address a URL reader makes of it (so a backslash cannot turn one host into another); ssh:// and user@host:path are cut.
// It reads as the same address as the text it came from.
export function withoutSecrets(text) {
  // Only the first run of characters is an address: whatever follows whitespace is dropped before anything is parsed, since
  // a URL reader would glue it to the path.
  const named = String(text ?? '').trim().split(/\s/)[0];
  if (/^https?:\/\//i.test(named)) {
    try {
      const url = new URL(named);
      url.hostname = unrooted(url.hostname);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      url.pathname = url.pathname.replace(/;.*$/, '');
      return url.toString();
    } catch { /* kept as the cut below */ }
  }
  return named.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#\s]*@/, '$1')
    // user@host:path keeps git@ alone, and drops everything before the last @ otherwise.
    .replace(/^([^/\s]*)@([A-Za-z0-9.-]+:(?!\/\/))/, (all, user, rest) => (user === 'git' ? all : rest))
    .replace(/^((?:ssh:\/\/)?(?:git@)?[A-Za-z0-9.-]*[A-Za-z0-9])\.(?=[:/])/, '$1')
    .replace(/[;?#].*$/, '');
}

// ssh://git@host/path and git@host:path, the common forms whose one bare user is no secret.
const BARE_GIT_USER = /^(?:ssh:\/\/git@[A-Za-z0-9.-]+(?::\d{1,5})?\/|git@[A-Za-z0-9.-]+:(?!\/\/))[^@]*$/;

// What is kept of a typed answer to step 3's join question. Any word holding an @ (or a %40, which reads as one) is held whole, as
// HELD_SECRET, whatever else is in it: a user and password may be written in any form, with a / ? or # inside, and no cutting
// could tell where one ends. Only a word that is exactly a bare git@ address is let through. Where the first word holds a / it is
// the whole answer (words after a space are dropped); otherwise the text is a name or a sentence and stays as typed. An address
// is then cleaned (withoutSecrets) and other text loses anything from a ?, # or ; on.
export function joinKept(text) {
  const typed = String(text ?? '').trim();
  const words = typed.split(/\s+/);
  if (words.some((word) => /@|%40/i.test(word) && !BARE_GIT_USER.test(word))) return HELD_SECRET;
  const run = /[/@]/.test(words[0]) ? words[0] : typed;
  return pastedAddress(run) !== null ? withoutSecrets(run) : run.replace(/[?#;].*$/s, '');
}
