// probes/77-archon-skills/task/checks/loop.ts
// The three-round loop's done check: formatPrice, parsePrice and splitBill all behave.
const fail = (m: string) => { console.log(m); process.exit(1); };
const load = async (p: string) => { try { return await import(p); } catch { return {}; } };
const price = await load('../src/price.ts');
const bill = await load('../src/bill.ts');
if (price.formatPrice?.(1234.5) !== '$1,234.50') fail('formatPrice not done');
if (price.parsePrice?.('$1,234.50') !== 1234.5) fail('parsePrice not done');
const split = bill.splitBill?.(10, 3);
if (JSON.stringify(split) !== JSON.stringify([3.34, 3.33, 3.33])) fail('splitBill not done');
console.log('loop done check passes');
