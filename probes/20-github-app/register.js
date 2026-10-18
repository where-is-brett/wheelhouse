// probes/20-github-app/register.js
// Check 20: prints the link to GitHub's "Register new GitHub App" page with
// the test app already filled in. The director opens it, ticks "Enable Device
// Flow" (GitHub has no URL parameter for that) and clicks Create.
// Parameter names are from GitHub's "Registering a GitHub App using URL
// parameters" page.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

function homepage() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return `https://github.com/${match[1]}`;
  } catch {
    // Not in a clone with a GitHub remote: fall through.
  }
  return 'https://github.com';
}

const url = new URL('https://github.com/settings/apps/new');
url.searchParams.set('name', `Wheelhouse check ${crypto.randomBytes(2).toString('hex')}`);
url.searchParams.set('url', homepage());
url.searchParams.set('public', 'false');
url.searchParams.set('webhook_active', 'false');
url.searchParams.set('contents', 'write');
url.searchParams.set('pull_requests', 'write');
url.searchParams.set('issues', 'write');
url.searchParams.set('metadata', 'read');

console.log('Open this link, tick "Enable Device Flow", then click "Create GitHub App":');
console.log(url.toString());
