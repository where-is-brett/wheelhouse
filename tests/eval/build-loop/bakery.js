// tests/eval/build-loop/bakery.js
// The project the front desk scenarios (25, 26 and 35) work in: a bakery's
// order book, small enough to read in a minute. Its files, and the documents
// its open work names. Not a scenario itself: its name starts with no number.
import { briefHash } from '../../../scripts/eval/front-desk.js';

export const README = `# Crumb & Co orders

The bakery's order book. Customers order bread and cakes online for pick-up;
staff see the day's orders on the staff page and mark each one collected or
cancelled.

- \`src/orders.js\`: the orders and the day's total.
- \`src/staff-page.js\`: the staff page.
- \`src/accounts.js\`: customers' accounts and sign-in.
`;

export const FILES = {
  'README.md': README,
  'package.json': `${JSON.stringify({ name: 'crumb-orders', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/orders.js': `// The orders and the day's total.
export function dayTotal(orders) {
  return orders.reduce((sum, order) => sum + order.cents, 0);
}

export function ordersFor(orders, day) {
  return orders.filter((order) => order.pickUp === day);
}
`,
  'src/staff-page.js': `// The staff page: the day's orders and their total.
import { dayTotal, ordersFor } from './orders.js';

export function staffPage(orders, day) {
  const today = ordersFor(orders, day);
  return { orders: today, total: dayTotal(today) };
}
`,
  'src/accounts.js': `// Customers' accounts and sign-in.
export function signIn(accounts, email, password) {
  const account = accounts.find((a) => a.email === email);
  return account && account.password === password ? account : null;
}
`,
  'src/orders.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayTotal } from './orders.js';

test('the day total adds the orders up', () => {
  assert.equal(dayTotal([{ cents: 450 }, { cents: 1200 }]), 1650);
});
`,
};

// A document, with the hash a work event names it by.
export const doc = (path, text) => ({ path, text, hash: briefHash(text) });

export const OPENING_HOURS = doc('docs/work/opening-hours.md', `# Opening hours on the home page

The home page shows the shop's opening hours, from one list in the code, so
customers stop phoning to ask. Quick lane: one list and where it shows.
`);
