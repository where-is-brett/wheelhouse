// probes/64-usage/fake-gh.js
// A stand-in for gh, used only by `run.js --dry-run`. Environment WHEELHOUSE_FAKE_GH picks the answer:
// "refused" gives 403 with a message about scopes, "missing" gives 404 for every endpoint, "signedout" fails sign-in.
const args = process.argv.slice(2);
const mode = process.env.WHEELHOUSE_FAKE_GH ?? 'ok';
if (args[0] === 'api' && args[1] === 'user') {
  if (mode === 'signedout') { console.error('gh: not logged in'); process.exit(4); }
  console.log('standin-login');
  process.exit(0);
}
const endpoint = args.at(-1);
const reply = (status, headers, body) => { console.log(`HTTP/2.0 ${status}\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${JSON.stringify(body)}`); process.exit(status.startsWith('2') ? 0 : 1); };
if (mode === 'refused') reply('403 Forbidden', { 'x-oauth-scopes': 'repo', 'x-accepted-oauth-scopes': 'user' }, { message: 'Resource not accessible (stand-in) standin-login', documentation_url: 'https://docs.github.com/rest' });
if (mode === 'missing' || /ai_credit/.test(endpoint) && mode === 'ai-missing') reply('404 Not Found', {}, { message: 'Not Found' });
reply('200 OK', { 'x-oauth-scopes': 'repo' }, { timePeriod: { year: 2026 }, user: 'standin-login', usageItems: [{ product: 'copilot', sku: 'x', quantity: 12.5, netAmount: 1.5 }] });
