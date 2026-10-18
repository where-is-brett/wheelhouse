// scripts/host/github-app.js
// Signs the director in to the Wheelhouse GitHub App with GitHub's device
// flow: the app shows a short code, the director types it on github.com, and
// the app is handed an access key (8 hours) and a renewal key (6 months).
// Where the app has key expiry switched off, GitHub hands over an access key
// with no expiry and no renewal key; both expiries are then null. Renewing
// needs the app's client ID alone, which is public, so no client secret is
// sent or kept (check 20).
// No function here returns, logs or throws a message holding a key: errors
// name the step and, for GitHub's own error codes, the code.

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const NOT_COMPLETED = 'Sign-in was not completed';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const ERROR_CODE = /^[a-z_]{1,40}$/;
const DEFAULT_INTERVAL = 5;

const defaultSleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function post({ url, fields, fetch, step }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to the ${step}`);
  let body;
  try {
    body = await response.json();
  } catch {
    // The parser's message can quote the answer, so it is not passed on.
    throw new Error(`GitHub's answer to the ${step} was not JSON`);
  }
  return body !== null && typeof body === 'object' ? body : {};
}

// GitHub reports most refusals as a 200 with an "error" code. Only a short
// lowercase code is repeated; anything else is not.
function refusal(body, step) {
  const code = ERROR_CODE.test(body.error ?? '') ? body.error : 'unrecognised';
  return new Error(`GitHub refused the ${step} (${code})`);
}

function plus(now, seconds) {
  return Number.isFinite(seconds) ? new Date(now().getTime() + seconds * 1000).toISOString() : null;
}

function keysFrom(body, now, step) {
  if (typeof body.access_token !== 'string') throw refusal(body, step);
  return {
    accessToken: body.access_token,
    accessExpiresAt: plus(now, body.expires_in),
    refreshToken: body.refresh_token ?? null,
    refreshExpiresAt: plus(now, body.refresh_token_expires_in),
  };
}

export async function startDeviceSignIn({ clientId, fetch = globalThis.fetch }) {
  const body = await post({ url: DEVICE_CODE_URL, fields: { client_id: clientId }, fetch, step: 'request for a sign-in code' });
  if (typeof body.device_code !== 'string') throw refusal(body, 'request for a sign-in code');
  return {
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    deviceCode: body.device_code,
    interval: body.interval,
    expiresIn: body.expires_in,
  };
}

export async function waitForSignIn({ clientId, deviceCode, interval, fetch = globalThis.fetch, sleep = defaultSleep, now = () => new Date() }) {
  let wait = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL;
  for (;;) {
    const body = await post({
      url: ACCESS_TOKEN_URL,
      fields: { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT },
      fetch,
      step: 'sign-in check',
    });
    if (body.error === 'authorization_pending') {
      await sleep(wait);
    } else if (body.error === 'slow_down') {
      wait += 5;
      await sleep(wait);
    } else if (body.error === 'expired_token' || body.error === 'access_denied') {
      throw new Error(NOT_COMPLETED);
    } else {
      return keysFrom(body, now, 'sign-in check');
    }
  }
}

export async function renewKeys({ clientId, refreshToken, fetch = globalThis.fetch, now = () => new Date() }) {
  const fields = { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken };
  const body = await post({ url: ACCESS_TOKEN_URL, fields, fetch, step: 'key renewal' });
  return keysFrom(body, now, 'key renewal');
}

export function installUrl(appSlug) {
  if (!SLUG.test(appSlug)) throw new Error('The app name may use letters, digits and dashes only');
  return `https://github.com/apps/${appSlug}/installations/new`;
}
