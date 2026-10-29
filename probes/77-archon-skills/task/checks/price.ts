// probes/77-archon-skills/task/checks/price.ts
// The done check's examples for formatPrice. Exits 1 on the first mismatch.
const cases: Array<[number, string]> = [[1234.5, '$1,234.50'], [0, '$0.00'], [-5, '-$5.00'], [1000000, '$1,000,000.00']];
let mod: { formatPrice?: (n: number) => string };
try { mod = await import('../src/price.ts'); } catch { console.log('src/price.ts is missing'); process.exit(1); }
for (const [input, want] of cases) {
  const got = mod.formatPrice?.(input);
  if (got !== want) { console.log(`formatPrice(${input}) gave ${got}, wanted ${want}`); process.exit(1); }
}
console.log('done check passes');
