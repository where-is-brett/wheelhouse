// probes/haiku-trial/score/a11y.js
// Accessibility: axe-core run over the product's four pages in a headless browser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { makeStatement, HELD_BACK } from '../statement.js';
import { startProduct, request } from '../product.js';
import { findBrowser } from '../../../scripts/pictures/browser.js';
import { defaultRun } from './run.js';

export const PLAYWRIGHT_CORE = '1.48.2';
export const AXE_CORE = '4.10.2';

// The real browse(url): installs the pinned tools into toolsDir, then opens each url in a headless browser with axe-core.
export function makeBrowse({ toolsDir, run = defaultRun, browserPath = findBrowser() }) {
  let tools;
  const load = () => {
    if (tools) return tools;
    fs.mkdirSync(toolsDir, { recursive: true });
    const install = run('npm', ['install', '--prefix', toolsDir, '--no-audit', '--no-fund', `playwright-core@${PLAYWRIGHT_CORE}`, `axe-core@${AXE_CORE}`], { cwd: toolsDir });
    if (install.status !== 0) throw new Error(`could not install the accessibility tools: ${install.stderr.slice(0, 300)}`);
    const require = createRequire(path.join(toolsDir, 'package.json'));
    tools = { chromium: require('playwright-core').chromium, axeSource: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') };
    return tools;
  };
  return async function browse(url) {
    if (!browserPath) throw new Error('no Chrome or Edge found to run the accessibility check');
    const { chromium, axeSource } = load();
    const browser = await chromium.launch({ executablePath: browserPath, headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.evaluate(axeSource);
      return await page.evaluate(() => window.axe.run());
    } finally {
      await browser.close();
    }
  };
}

export async function a11y({ dir, browse, start = startProduct, get = request, timeoutMs = 10000 }) {
  const statement = makeStatement(HELD_BACK);
  const first = Object.keys(statement.expected)[0];
  let product;
  try {
    product = await start({ dir });
  } catch (error) {
    return { points: 0, of: 10, pages: {}, notes: [error.message] };
  }
  const pages = {};
  const seriousIds = new Set();
  const notes = [];
  let unchecked = false;
  try {
    await get(`${product.url}/import`, { file: { field: 'statement', name: 'statement.csv', content: statement.csv }, follow: true, timeoutMs });
    const month = await get(`${product.url}/month?m=${first}`, { timeoutMs });
    const id = /\/edit\?id=([^"'&\s>]+)/.exec(month.text)?.[1];
    const paths = ['/', '/import', `/month?m=${first}`, ...(id ? [`/edit?id=${id}`] : [])];
    if (!id) notes.push('the month page has no /edit?id= link, so the edit page was not checked');
    for (const p of paths) {
      let results;
      try {
        results = await browse(`${product.url}${p}`);
      } catch (error) {
        notes.push(`${p}: ${error.message}`);
        unchecked = true;
        continue;
      }
      const violations = results?.violations ?? [];
      const serious = violations.filter((v) => v.impact === 'serious');
      const critical = violations.filter((v) => v.impact === 'critical');
      serious.forEach((v) => seriousIds.add(v.id));
      pages[p] = { serious: serious.length, critical: critical.length, ids: [...new Set([...serious, ...critical].map((v) => v.id))] };
    }
  } finally {
    await product.stop();
  }
  const anyCritical = Object.values(pages).some((p) => p.critical > 0);
  const points = anyCritical || unchecked ? 0 : Math.max(0, 10 - 2 * seriousIds.size);
  return { points, of: 10, pages, notes };
}
