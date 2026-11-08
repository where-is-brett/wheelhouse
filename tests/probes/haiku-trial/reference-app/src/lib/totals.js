// tests/probes/haiku-trial/reference-app/src/lib/totals.js
import { CATEGORIES } from './categories.js';

// Sums whole cents per category key from rows of {category, cents}. Every key is present.
export function monthTotals(rows) {
  const sums = Object.fromEntries(CATEGORIES.map(([key]) => [key, 0]));
  for (const row of rows) sums[row.category] = (sums[row.category] ?? 0) + row.cents;
  return sums;
}
