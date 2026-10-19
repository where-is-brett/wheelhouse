// probes/20-github-app/register.js
// Check 20: prints the link to GitHub's "Register new GitHub App" page with
// the test app already filled in from Wheelhouse's app manifest
// (scripts/host/app-manifest.json), as setup fills in a person's own app:
// private, no webhook, and the manifest's permissions. The director opens it,
// ticks "Enable Device Flow" (GitHub has no URL parameter for that) and clicks
// Create. Parameter names are from GitHub's "Registering a GitHub App using URL
// parameters" page.
import crypto from 'node:crypto';
import { newAppUrl, readManifest } from '../../scripts/setup/own-app.js';

const url = newAppUrl({
  manifest: readManifest(),
  owner: { kind: 'user' },
  name: `Wheelhouse check ${crypto.randomBytes(2).toString('hex')}`,
});

console.log('Open this link, tick "Enable Device Flow", then click "Create GitHub App":');
console.log(url);
