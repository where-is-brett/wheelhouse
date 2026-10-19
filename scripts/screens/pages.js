// scripts/screens/pages.js
// Where the helper's browser may be pointed: the plain page paths a project's configuration lists
// (`pages`), on a preview's https address on a public host, never on this computer or its local
// network. It imports nothing, so the gate's configuration check reads pages without loading the
// browser runner.

// A page is a path on the preview: one leading slash, no backslash, no spaces or control characters.
const PAGE = /^\/(?![/\\])[^\s\\]*$/;
// A `.` or `..` path segment, plain or percent-encoded, in any case.
const DOTS = /^(?:\.|%2e){1,2}$/i;

// Whether `page` is a plain path: one leading slash, and no `.` or `..` segment before any query
// or fragment.
export function isPage(page) {
  if (typeof page !== 'string' || !PAGE.test(page)) return false;
  return !page.split(/[?#]/, 1)[0].split('/').some((segment) => DOTS.test(segment));
}

// The IPv4 blocks no preview is on, as [first address, prefix length]: this network (0.0.0.0 among
// it), private (10/8, 172.16/12, 192.168/16), loopback (127/8) and link-local (169.254/16).
const IPV4_REFUSED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]];
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// An IPv4 address as a number, or null when `text` is not one.
function ipv4(text) {
  const parts = IPV4.exec(text)?.slice(1).map(Number);
  if (!parts || parts.some((n) => n > 255)) return null;
  return parts.reduce((sum, n) => sum * 256 + n, 0);
}

// Whether the IPv4 address `n` is in one of IPV4_REFUSED's blocks.
const inIpv4Block = (n) => IPV4_REFUSED.some(([first, bits]) => {
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(ipv4(first) / size);
});

// An IPv6 address as its eight 16-bit groups, or null when `text` is not one. The URL parser
// writes an IPv4 tail in hex, but one written dotted is read too.
function ipv6(text) {
  let hex = text;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const n = ipv4(dotted[2]);
    if (n === null) return null;
    hex = `${dotted[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = hex.split('::');
  if (halves.length > 2) return null;
  const groups = (half) => (half === '' ? [] : half.split(':'));
  const head = groups(halves[0]);
  const back = halves.length === 2 ? groups(halves[1]) : null;
  const known = [...head, ...(back ?? [])];
  if (!known.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const fill = back === null ? 0 : 8 - known.length;
  if (back === null ? known.length !== 8 : fill < 1) return null;
  return [...head, ...Array(fill).fill('0'), ...(back ?? [])].map((g) => parseInt(g, 16));
}

// The IPv6 addresses no preview is on: the first 96 bits zero (unspecified, loopback, and an IPv4
// address written as IPv6), an IPv4-mapped address, unique local (fc00::/7), link-local
// (fe80::/10) and the old site-local (fec0::/10).
function inIpv6Block(g) {
  if (g.slice(0, 6).every((n) => n === 0)) return true;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return true;
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0;
}

// Whether `hostname`, as the URL parser gives it (lower case, an IPv4 address in dotted form, an
// IPv6 one in brackets), is on this computer or its local network.
function isLocalHost(hostname) {
  const name = hostname.replace(/\.+$/, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const four = ipv4(name);
  if (four !== null) return inIpv4Block(four);
  if (name.startsWith('[') && name.endsWith(']')) {
    const six = ipv6(name.slice(1, -1));
    return six === null || inIpv6Block(six);
  }
  return false;
}

// `address` as the URL parser writes it, when it is https on a public host; otherwise null. A
// loopback, private, link-local or unspecified IP address, `localhost` and any name under
// `.localhost` are refused, so the browser only ever opens the host's preview deployment.
export function publicHttps(address) {
  if (typeof address !== 'string') return null;
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.hostname === '' || isLocalHost(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
