// scripts/host/company-ca.js
// A company's own certificate authority, and a company GitLab that cannot be reached (check 71).
//
// A company's servers often use certificates from the company's own authority, which programs
// reject unless told. Setup copies the authority out of the computer's own store into one file,
// <wheelhouseHome>/ca/company.pem, and gives it to each tool by that tool's own setting, for that
// one address: Node.js through NODE_EXTRA_CA_CERTS (which adds to the certificates it trusts), `glab`
// through its `ca_cert` setting for the host, and git through a setting keyed to the address, passed
// in the environment of the call that needs it (never git's global or system configuration, and
// never a file of the person's). On Windows git is told to use the system's own store instead.
// Nothing here switches a certificate check off, and nothing accepts a request to.
//
// A failure to reach the server reads two ways, and they are two different cards: a certificate the
// computer does not trust (the fix is the authority above), and a server that is not there (perhaps
// the person is off the company network, and work carries on here). Both are read from error codes
// and from the tools' wording, and neither card repeats the request or the server's own text.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';

// ---- The file ----

// Where the exported certificates are kept: <wheelhouseHome>/ca/company.pem.
export const caFile = (home) => path.join(home, 'ca', 'company.pem');

const BLOCK = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/g;
const LINE = 64;

// Whether a certificate is one to trust as an authority: it can sign others (a CA), and has not
// expired at `now`. A server's own certificate, or an expired authority, is not.
function liveAuthority(pem, now) {
  try {
    const cert = new crypto.X509Certificate(pem);
    return cert.ca === true && Date.parse(cert.validTo) > now.getTime();
  } catch {
    return false; // not a certificate at all
  }
}

// Each certificate in `text` once, in the order found, as well-formed PEM with Unix line endings.
// Anything that is not a certificate block is dropped; with `now`, so is anything that is not an
// authority still in date.
function normalise(text, { now = null } = {}) {
  const seen = new Set();
  const blocks = [];
  for (const match of String(text ?? '').matchAll(BLOCK)) {
    const body = match[1].replace(/\s+/g, '');
    if (body === '' || seen.has(body)) continue;
    const block = `-----BEGIN CERTIFICATE-----\n${body.match(new RegExp(`.{1,${LINE}}`, 'g')).join('\n')}\n-----END CERTIFICATE-----\n`;
    if (now !== null && !liveAuthority(block, now)) continue;
    seen.add(body);
    blocks.push(block);
  }
  return blocks.join('');
}

const MAC_KEYCHAINS = ['/System/Library/Keychains/SystemRootCertificates.keychain', '/Library/Keychains/System.keychain'];
// Windows' certificate store for the machine's trusted roots, which holds the ones a company's
// policy adds. certutil's own listing of it names each certificate but does not hold its bytes, so it
// cannot be turned into a file; PowerShell reads the same store with the bytes.
const WINDOWS_ROOTS = [
  '$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")',
  '$store.Open("ReadOnly")',
  'foreach ($cert in $store.Certificates) { "-----BEGIN CERTIFICATE-----"; [Convert]::ToBase64String($cert.RawData, "InsertLineBreaks"); "-----END CERTIFICATE-----" }',
  '$store.Close()',
].join('; ');
const READ_MS = 60 * 1000;

async function quietly(run, file, args) {
  try {
    return await run(file, args, { timeoutMs: READ_MS });
  } catch {
    return { code: 1, stdout: '', stderr: '' };
  }
}

// The certificates this computer trusts, as PEM text: on macOS the system roots and the System
// keychain (`security find-certificate -a -p`, which only reads); on Windows the machine's Root
// store. Only through `run`. Only authorities that are still in date at `now` are kept (a server's
// own certificate or an expired authority is dropped), whichever system. Throws when none can be read.
export async function exportSystemRoots({ platform = process.platform, run, systemRoot = process.env.SystemRoot, now = () => new Date() } = {}) {
  let texts;
  if (platform === 'darwin') {
    texts = [];
    for (const keychain of MAC_KEYCHAINS) {
      const got = await quietly(run, 'security', ['find-certificate', '-a', '-p', keychain]);
      if (got.code === 0) texts.push(got.stdout);
    }
  } else if (platform === 'win32') {
    const shell = path.win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const got = await quietly(run, shell, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_ROOTS]);
    texts = got.code === 0 ? [got.stdout] : [];
  } else {
    throw new Error('Setup reads the certificate store on macOS and Windows only');
  }
  const pem = normalise(texts.join('\n'), { now: now() });
  if (pem === '') throw new Error('No certificates could be read from this computer\'s certificate store');
  return pem;
}

// Writes the certificates to the file, replacing what was there. They are public, so the file is
// readable; it is written whole or not at all.
export function writeCaFile({ home, pem }) {
  const text = normalise(pem);
  if (text === '') throw new Error('There are no certificates to keep');
  const file = caFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o644 });
  fs.renameSync(temporary, file);
  return file;
}

// ---- Giving it to each tool ----

// Node.js: the file, once it exists. NODE_EXTRA_CA_CERTS adds to the certificates Node.js trusts, so
// it is the route that is proved (check 71); `--use-system-ca` is an extra and never the route.
export function caEnv(home) {
  return fs.existsSync(caFile(home)) ? { NODE_EXTRA_CA_CERTS: caFile(home) } : {};
}

// glab: `glab config set ca_cert <file> --host <host>`. `host` is the address as glab names it, with
// its port when there is one.
export function glabCaArgs(host, file) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9[][A-Za-z0-9.:[\]-]*$/.test(host)) throw new Error('The GitLab host must be a host name, with its port when it has one');
  if (typeof file !== 'string' || file === '' || file.startsWith('-')) throw new Error('The certificate file must be a path');
  return ['config', 'set', 'ca_cert', file, '--host', host];
}

// The address as git's per-address settings name it: the origin, no trailing slash.
export function addressOf(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('The GitLab address must start with https://');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('The GitLab address must start with https://');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// git: the settings for that address alone, as { key, value } pairs for the environment of a git
// call (withGitConfig): `http.<base>/.sslCAInfo <file>`, or on Windows `http.<base>/.sslBackend
// schannel`, which makes git use the system's own store.
export function gitCaConfig(base, file, platform = process.platform) {
  const address = addressOf(base);
  if (platform === 'win32') return [{ key: `http.${address}/.sslBackend`, value: 'schannel' }];
  if (typeof file !== 'string' || file === '') throw new Error('The certificate file must be a path');
  return [{ key: `http.${address}/.sslCAInfo`, value: file }];
}

// `env` with git's settings added, through GIT_CONFIG_COUNT, GIT_CONFIG_KEY_<n> and
// GIT_CONFIG_VALUE_<n>, after any already there. A copy: `env` is not changed. A setting that
// would switch a certificate check off is refused, whoever asks.
export function withGitConfig(env, pairs) {
  const out = { ...env };
  const given = out.GIT_CONFIG_COUNT;
  if (given !== undefined && !/^\d+$/.test(String(given))) throw new Error('git\'s settings count in this environment is not a whole number, so the certificate setting was not added');
  let next = given === undefined ? 0 : Number(given);
  for (const { key, value } of pairs) {
    if (/ssl.?verify/i.test(String(key))) throw new Error('Wheelhouse never switches certificate checks off');
    out[`GIT_CONFIG_KEY_${next}`] = key;
    out[`GIT_CONFIG_VALUE_${next}`] = value;
    next += 1;
  }
  out.GIT_CONFIG_COUNT = String(next);
  return out;
}

// ---- Two failures, two cards ----

export const HOST_UNREACHABLE = (base) => `Your company's GitLab, ${base}, can't be reached from here, perhaps off the company network. Work carries on here and is sent when it can be.`;
export const CERTIFICATE_NOT_TRUSTED = (base) => `The certificate GitLab, ${base}, shows isn't one this computer trusts. Wheelhouse never switches certificate checks off; it can add your company's own certificate for that address instead.`;

// The codes Node.js puts on the cause of a failed request.
const CERTIFICATE_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT']);

// The code on a failed request: a short upper-case word, or null. Only a code is kept, never the
// error's message, which can quote the request.
export function causeCode(error) {
  for (const code of [error?.cause?.code, error?.code]) if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  return null;
}

// 'certificate', 'unreachable' or 'other' for an error that carries a code.
export function failureKind(error) {
  const code = causeCode(error);
  if (code === 'CERTIFICATE_NOT_TRUSTED' || CERTIFICATE_CODES.has(code)) return 'certificate';
  if (code === 'HOST_UNREACHABLE' || UNREACHABLE_CODES.has(code)) return 'unreachable';
  return 'other';
}

// What `glab` and git print. The certificate wording is read first: some of it also names a connection.
const CERTIFICATE_WORDS = /x509|tls: failed to verify certificate|certificate is not trusted|signed by unknown authority|SSL certificate problem|unable to get local issuer certificate|SEC_E_UNTRUSTED_ROOT|issued by an authority that is not trusted|unable to check revocation|certificate revocation/i;
const UNREACHABLE_WORDS = /dial tcp|connection refused|no such host|i\/o timeout|context deadline exceeded|could not resolve host|failed to connect to|couldn't connect to server|connection timed out|network is unreachable/i;

// 'certificate' or 'unreachable' for a tool's output, or null for anything else.
export function outputKind(output) {
  const text = String(output ?? '').replace(/\s+/g, ' ');
  if (CERTIFICATE_WORDS.test(text)) return 'certificate';
  return UNREACHABLE_WORDS.test(text) ? 'unreachable' : null;
}

// Whether the output says the command waited and gave up, so whether it took effect is not known.
export const timedOut = (output) => /i\/o timeout|context deadline exceeded|timed out/i.test(String(output ?? ''));

// The line for a kind, and the code it carries.
export const lineFor = (kind, base) => (kind === 'certificate' ? CERTIFICATE_NOT_TRUSTED(base) : HOST_UNREACHABLE(base));
const CODES = { certificate: 'CERTIFICATE_NOT_TRUSTED', unreachable: 'HOST_UNREACHABLE' };

// A tool's output read as an error of ours (the plain line, with its code), or null when the output
// says neither.
export function hostFailure(output, base = DEFAULT_GITLAB) {
  const kind = outputKind(output);
  return kind === null ? null : Object.assign(new Error(lineFor(kind, base)), { code: CODES[kind] });
}

// The GitLab address of a project record, or null when its host is not a GitLab.
export const gitlabBaseOf = (record) => (record?.host === 'gitlab' ? (record.connection?.baseUrl ?? DEFAULT_GITLAB) : null);

// HOST_UNREACHABLE's line for a project record when its host is a GitLab, else null (GitHub keeps
// the words it has).
export const awayLine = (record) => {
  const base = gitlabBaseOf(record);
  return base === null ? null : HOST_UNREACHABLE(base);
};

// A failed git command's output read for a project record: the line when it is GitLab that is not
// there, else null (a different failure keeps its own words).
export function unreachableRefusal(record, stderr) {
  return outputKind(stderr) === 'unreachable' ? awayLine(record) : null;
}

// ---- Where the helper and setup use it ----

// Whether a git setting is the certificate's (and so no key): an address's `sslCAInfo` or `sslBackend`.
export const certificateSetting = (key) => /\.(?:sslcainfo|sslbackend)$/i.test(String(key ?? ''));

// `env` for a git call to a company's GitLab, with the certificate setting for that address added
// once setup has made the file (<wheelhouse home>/ca/company.pem). The public service, any other host
// and a computer with no file get `env` as it is. The setting is for that address only.
export function companyGitEnv(env, { host, base } = {}, { home = wheelhouseHome(), platform = process.platform } = {}) {
  if (host !== 'gitlab' || typeof base !== 'string') return env;
  try {
    if (addressOf(base) === addressOf(DEFAULT_GITLAB) || !fs.existsSync(caFile(home))) return env;
    return withGitConfig(env, gitCaConfig(base, caFile(home), platform));
  } catch {
    return env;
  }
}

// What the helper has lately found out about GitLab being out of reach, by project: `set` when a push,
// a merge or a read could not reach it, `clear` when one did, and `fresh` the projects still away
// (within `keepMs`), for the board.
export function makeAwayLog({ now = () => new Date(), keepMs = 15 * 60 * 1000 } = {}) {
  const seen = new Map();
  return {
    set: (project, base) => { seen.set(project, { base, at: now().getTime() }); },
    clear: (project) => { seen.delete(project); },
    fresh() {
      const out = {};
      for (const [project, { base, at }] of seen) if (now().getTime() - at < keepMs) out[project] = base;
      return out;
    },
  };
}

// Whether GitLab's certificate is trusted from here, asked without signing in: 'ok' when a TLS
// connection is made (whatever GitLab then answers), 'certificate' when the certificate is not
// trusted, 'unreachable' when the server is not there, else 'other'.
export async function probeCertificate({ fetch = globalThis.fetch, base, timeoutMs = 8000 } = {}) {
  try {
    const answer = await fetch(`${addressOf(base)}/api/v4/version`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    try { await answer?.body?.cancel?.(); } catch { /* nothing to read */ }
    return 'ok';
  } catch (error) {
    const kind = failureKind(error);
    return kind === 'other' ? 'other' : kind;
  }
}
