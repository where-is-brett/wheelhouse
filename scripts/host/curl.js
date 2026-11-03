// scripts/host/curl.js
// The one place `curl` is run: the system's own `curl`, by full path, to reach a host's REST API where
// the host's tool is not there, through the director's proxy and with the computer's own trust store.
//
// The command line is only `-q --config - --silent --show-error --write-out <marker>`. The `-q` comes
// first, so no .curlrc or _curlrc is read. Everything else (the address, the method, the headers with
// the key in them, the body, the proxy and the limits) goes on standard input as a curl config, quoted
// with curl's own escapes, so the key and the project's path never show in a process list. curl's own
// proxy and certificate variables are removed from its environment: the proxy is the one the director's
// git names (proxy.js), and the certificates are the computer's.
//
// Nothing here switches a certificate check off. A revocation check a company network blocks is retried
// once with `--ssl-revoke-best-effort` on Windows (a certificate known to be withdrawn is still refused);
// a certificate the Mac does not trust is retried once with the file setup made, where there is one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { curlFailure, revocationBlocked } from './company-ca.js';

const CONNECT_SECONDS = 20;
export const READ_SECONDS = 120;
export const MERGE_SECONDS = 300;
export const BODY_LIMIT = 1024 * 1024;
export const ANSWER_LIMIT = 10 * 1024 * 1024;

export const NO_CURL = 'This computer has no curl Wheelhouse can use, so it can only reach GitLab through GitLab\'s own tool. Ask IT for either.';

// ---- Where curl is ----

// The full path of the `curl` to run, or null when there is none; never found through the search path.
// macOS and Linux: /usr/bin/curl. Windows: <SystemRoot>\System32\curl.exe, then the curl.exe beside git
// (`gitPath`, the git setup found). `exists` is for tests.
export function curlPath({ platform = process.platform, systemRoot = process.env.SystemRoot, gitPath, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return exists('/usr/bin/curl') ? '/usr/bin/curl' : null;
  const candidates = [path.win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'curl.exe')];
  if (typeof gitPath === 'string' && path.win32.isAbsolute(gitPath)) candidates.push(path.win32.join(path.win32.dirname(gitPath), 'curl.exe'));
  return candidates.find((file) => exists(file)) ?? null;
}

// ---- The config ----

// A value quoted for a curl config file: inside double quotes, with backslash escapes for the
// backslash, the quote and the control characters curl reads.
export const quoteConfig = (value) => `"${String(value).replace(/[\\"\n\r\t\v]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v' }[c]))}"`;

const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

function addressOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The address for curl must be a full address');
  }
  if (/[\r\n\0]/.test(String(url))) throw new Error('The address for curl holds a line break');
  const local = LOCAL.includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('The address for curl must start with https://');
  return { parsed, local };
}

// The config for one call, as text. `proxy` is readProxy's answer (or null).
function configFor({ url, method, headers, body, proxy, caFile, maxSeconds, revokeBestEffort, local }) {
  const lines = [
    `url = ${quoteConfig(url)}`,
    `request = ${quoteConfig(method)}`,
    `connect-timeout = ${CONNECT_SECONDS}`,
    `max-time = ${maxSeconds}`,
    `max-filesize = ${ANSWER_LIMIT}`,
  ];
  if (!local) lines.push('proto = "=https"', 'proto-redir = "=https"');
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || /[\r\n\0]/.test(String(value))) throw new Error('A header for curl must be a name and a value on one line');
    lines.push(`header = ${quoteConfig(`${name}: ${value}`)}`);
  }
  if (body !== undefined && body !== null) lines.push(`data-binary = ${quoteConfig(body)}`);
  if (proxy) {
    lines.push(`proxy = ${quoteConfig(proxy.proxy)}`);
    lines.push(`proxy-${proxy.auth === 'ntlm' || proxy.auth === 'negotiate' ? proxy.auth : 'anyauth'}`);
    if (proxy.user !== null && proxy.user !== undefined) lines.push(`proxy-user = ${quoteConfig(proxy.user)}`);
    if (proxy.noProxy) lines.push(`noproxy = ${quoteConfig(proxy.noProxy)}`);
  }
  if (caFile) lines.push(`cacert = ${quoteConfig(caFile)}`);
  if (revokeBestEffort) lines.push('ssl-revoke-best-effort');
  return `${lines.join('\n')}\n`;
}

// curl's own proxy and certificate variables, taken out of the environment it is given.
const OWN_VARIABLES = /^(?:.*_proxy|curl_ca_bundle|ssl_cert_file|curl_ssl_backend)$/i;
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !OWN_VARIABLES.test(name)));

// ---- The call ----

// One request. Gives { status, body, connect } (the HTTP status straight from curl, the body, and the proxy's
// answer to the tunnel, 0 when there was none), or throws an error with a plain line and a code:
// HOST_UNREACHABLE (with `timedOut` when curl gave up waiting, so whether a merge took effect is not known),
// CERTIFICATE_NOT_TRUSTED, PROXY_REFUSED, NO_CURL, or HOST_REQUEST_FAILED for anything else. curl's own text is
// never in the line: it can quote the address and the request.
//
// `run` runs a program (scripts/lib/run.js; a stand-in in tests); `curl` is curlPath's answer; `headers` hold
// the key (PRIVATE-TOKEN for GitLab, Authorization for GitHub); `proxy` is readProxy's answer; `caFile` is
// setup's file, used on the Mac only; `maxSeconds` is READ_SECONDS or MERGE_SECONDS; `baseEnv` is the
// environment to start from.
export async function request({
  run = realRun, curl, url, method = 'GET', headers = {}, body, proxy = null, caFile = null,
  maxSeconds = READ_SECONDS, platform = process.platform, baseEnv = process.env, base,
} = {}) {
  const { parsed, local } = addressOf(url);
  if (typeof curl !== 'string' || curl === '') throw Object.assign(new Error(NO_CURL), { code: 'NO_CURL' });
  if (body !== undefined && body !== null && Buffer.byteLength(String(body)) > BODY_LIMIT) throw new Error('The request body is too large to send (over 1 MB)');
  const origin = base ?? (parsed.origin === new URL(DEFAULT_GITLAB).origin ? DEFAULT_GITLAB : parsed.origin);
  const nonce = crypto.randomBytes(12).toString('hex');
  const args = ['-q', '--config', '-', '--silent', '--show-error', '--write-out', `\\n${nonce}%{http_code} %{http_connect}`];
  const env = cleanEnv(baseEnv);
  const once = async (options) => {
    const got = await run(curl, args, { input: configFor({ url, method, headers, body, proxy, maxSeconds, local, ...options }), baseEnv: env, env: {}, timeoutMs: (maxSeconds + 15) * 1000 });
    const stdout = String(got.stdout ?? '');
    const at = stdout.lastIndexOf(`\n${nonce}`);
    const marker = at < 0 ? null : /^(\d+) (\d+)/.exec(stdout.slice(at + 1 + nonce.length));
    return {
      code: got.code, stderr: String(got.stderr ?? ''), timedOut: got.timedOut === true,
      status: marker === null ? 0 : Number(marker[1]), connect: marker === null ? 0 : Number(marker[2]),
      body: at < 0 ? '' : stdout.slice(0, at),
    };
  };

  let got = await once({ caFile: null, revokeBestEffort: false });
  // A blocked revocation check on Windows: once more, still refusing a certificate known to be withdrawn.
  if (got.code === 35 && platform === 'win32' && revocationBlocked(got.stderr)) got = await once({ caFile: null, revokeBestEffort: true });
  // The Mac's own store does not cover the company's authority: once more with the file setup made.
  else if (got.code === 60 && platform === 'darwin' && caFile) got = await once({ caFile, revokeBestEffort: false });

  if (got.timedOut) throw curlFailure(28, { base: origin });
  const failure = curlFailure(got.code, { connect: got.connect, stderr: got.stderr, base: origin })
    ?? (got.status === 407 ? curlFailure(0, { connect: 407, base: origin }) : null);
  if (failure !== null) throw failure;
  if (got.code !== 0 || got.body.length > ANSWER_LIMIT) {
    throw Object.assign(new Error(`The request to ${origin} did not complete, so nothing was changed that Wheelhouse can confirm.`), { code: 'HOST_REQUEST_FAILED' });
  }
  return { status: got.status, body: got.body, connect: got.connect };
}
