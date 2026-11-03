// scripts/host/proxy.js
// The director's proxy, read the way their own git reads it, so `curl` reaches the host by the
// same road. The source is the director's git settings for the host's address (`http.proxy` and
// `http.proxyAuthMethod`, by `git config --get-urlmatch`); with none set, the environment
// (`HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`). Nothing here is written anywhere.
//
// A proxy address that holds a password is never copied to `curl`: it is refused, with a line that
// does not quote it. Where the address names no user, `curl` is told to sign in as the computer's
// user (SSPI on Windows, a Kerberos ticket on the Mac) by an empty `proxy-user`.

export const PROXY_HAS_PASSWORD = 'Your git settings keep your proxy password in plain text. Wheelhouse won\'t copy it. Ask IT whether your proxy accepts your Windows sign-in instead; it usually does.';

// The sign-in method git names, as the option `curl` is given: 'ntlm', 'negotiate' or 'anyauth'.
export function authFor(method) {
  const named = String(method ?? '').trim().toLowerCase();
  return named === 'ntlm' || named === 'negotiate' ? named : 'anyauth';
}

async function gitSetting(ask, name, address) {
  try {
    const got = await ask(['config', '--get-urlmatch', name, address]);
    if (got.code !== 0) return null;
    // Asked for one name, git prints the value alone; the name is stripped if it is there.
    return String(got.stdout ?? '').split('\n')[0].replace(new RegExp(`^${name.replace('.', '\\.')}\\s`, 'i'), '').trim();
  } catch {
    return null; // no git to ask
  }
}

const fromEnvironment = (env, names) => {
  for (const name of names) {
    for (const key of [name, name.toLowerCase()]) if (typeof env?.[key] === 'string' && env[key].trim() !== '') return env[key].trim();
  }
  return null;
};

// Whether `host` is one the NO_PROXY list names: an exact name, a suffix (`.internal` or `internal`
// matches the name and its subdomains), or `*`.
function noProxyNames(list, host) {
  return String(list ?? '').split(',').map((item) => item.trim().toLowerCase().replace(/^\*?\./, '')).filter(Boolean)
    .some((item) => item === '*' || host.split('.').some((_, i, labels) => labels.slice(i).join('.') === item));
}

// The proxy address as a URL, with a scheme (git reads `host:port` as http), or null when it is not one.
function parse(value) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    return null;
  }
}

// The proxy for `address`, or null for none:
//   { proxy, auth: 'ntlm' | 'negotiate' | 'anyauth', user: ':' | null, noProxy, source: 'git' | 'environment' }
// `user` is ':' when the proxy address names no user, so `curl` signs in as the computer's user.
// Throws an error with code PROXY_HAS_PASSWORD when the address holds a password.
// `ask(args)` runs the director's own git, with their global and system settings in force (the fenced route
// shuts those out, so the caller gives a runner that is a listed exception) and gives { code, stdout };
// `env` is the environment to read.
export async function readProxy({ address, ask, env = process.env } = {}) {
  let host;
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    return null;
  }
  const noProxy = fromEnvironment(env, ['NO_PROXY']);
  let value = await gitSetting(ask, 'http.proxy', address);
  let source = 'git';
  if (value === '') return null; // git is told to use no proxy at all
  let method = null;
  if (value === null) {
    value = fromEnvironment(env, ['HTTPS_PROXY', 'ALL_PROXY']);
    source = 'environment';
    if (value === null) return null;
  } else {
    method = await gitSetting(ask, 'http.proxyAuthMethod', address);
  }
  if (noProxyNames(noProxy, host)) return null;
  const url = parse(value);
  if (url === null) return null;
  if (url.password !== '') throw Object.assign(new Error(PROXY_HAS_PASSWORD), { code: 'PROXY_HAS_PASSWORD' });
  const proxy = url.username === '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? `http://${value}` : value;
  return { proxy, auth: authFor(method), user: url.username === '' ? ':' : null, noProxy, source };
}
