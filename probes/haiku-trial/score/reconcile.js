// probes/haiku-trial/score/reconcile.js
// Reconciliation: the held-back statement imported into a fresh product, every month's totals read back to the cent.
import { makeStatement, HELD_BACK, canonical } from '../statement.js';
import { startProduct, request } from '../product.js';
import { totalsOf, centsOfDecimal } from '../lib/html.js';

// Exact integer cents from a plain decimal such as 12.30 or -0.10; null for anything else, three decimals included.
export function centsOf(text) {
  const cents = centsOfDecimal(text);
  return cents === 0 ? 0 : cents;
}

export async function reconcile({ dir, statement = makeStatement(HELD_BACK), start = startProduct, get = request, timeoutMs = 10000 }) {
  let product;
  try {
    product = await start({ dir });
  } catch (error) {
    return { points: 0, mismatches: [{ month: null, key: 'start', want: 'the product starts', got: error.message }] };
  }
  const mismatches = [];
  try {
    await get(`${product.url}/import`, { file: { field: 'statement', name: 'statement.csv', content: statement.csv }, follow: true, timeoutMs });
    for (const [month, want] of Object.entries(statement.expected)) {
      const res = await get(`${product.url}/month?m=${month}`, { timeoutMs });
      const got = res.status === 200 ? totalsOf(res.text) : {};
      const seen = Object.fromEntries(Object.entries(got).map(([key, cents]) => [canonical(key), cents]));
      const keys = [...Object.keys(want.byCategory).filter((key) => want.byCategory[key] !== 0), 'all'];
      for (const key of keys) {
        const wanted = key === 'all' ? want.total : want.byCategory[key];
        const found = seen[key] ?? null;
        if (found !== wanted) mismatches.push({ month, key, want: wanted, got: res.status === 200 ? found : `status ${res.status}` });
      }
    }
  } finally {
    await product.stop();
  }
  return { points: mismatches.length === 0 ? 15 : 0, mismatches };
}
