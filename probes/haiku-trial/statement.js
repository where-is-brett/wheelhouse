// probes/haiku-trial/statement.js
// Generated bank statements and the totals they should give. Merchants are made up.

export const CATEGORIES = [
  { key: 'groceries', label: 'Groceries' },
  { key: 'eating_out', label: 'Eating out' },
  { key: 'transport', label: 'Transport' },
  { key: 'bills', label: 'Bills' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'health', label: 'Health' },
  { key: 'income', label: 'Income' },
  { key: 'other', label: 'Other' },
];

export const ALIASES = { dining: 'eating_out' };

export function canonical(key) {
  return ALIASES[key] ?? key;
}

export const MERCHANTS = [
  { name: 'Greenbarrow Fresh', category: 'groceries' },
  { name: 'Pennywhistle Market', category: 'groceries' },
  { name: 'Lowtide Grocers', category: 'groceries' },
  { name: 'Harvest Lane Foods', category: 'groceries' },
  { name: 'Pasta, Pizza & Co', category: 'eating_out' },
  { name: 'Kestrel Coffee Bar', category: 'eating_out' },
  { name: 'Saltbush Noodle House', category: 'eating_out' },
  { name: 'Ember Grill', category: 'eating_out' },
  { name: 'Waverly Fuel Stop', category: 'transport' },
  { name: 'Tramline Fares', category: 'transport' },
  { name: 'Lantern Rideshare', category: 'transport' },
  { name: 'Northgate Parking', category: 'transport' },
  { name: 'Brightfield Power', category: 'bills' },
  { name: 'Clearwater Utilities', category: 'bills' },
  { name: 'Skyline Broadband', category: 'bills' },
  { name: 'Hollis Insurance', category: 'bills' },
  { name: 'Marlowe Homewares', category: 'shopping' },
  { name: 'Quillon Books', category: 'shopping' },
  { name: 'Fernhill Outfitters', category: 'shopping' },
  { name: 'Pixel Parade Tech', category: 'shopping' },
  { name: 'Larkspur Pharmacy', category: 'health' },
  { name: 'Elmgrove Physio', category: 'health' },
  { name: 'Cobalt Dental', category: 'health' },
  { name: 'Sunnyvale Optical', category: 'health' },
  { name: 'Brightwave Payroll', category: 'income' },
  { name: 'Tidepool Interest', category: 'income' },
  { name: 'Oakridge Dividends', category: 'income' },
];

export const UNKNOWN_MERCHANT = 'Zephyr Odd Lot';

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function monthsFrom(start, count) {
  let [year, month] = start.split('-').map(Number);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function lastDay(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function categoryOf(name) {
  if (name === UNKNOWN_MERCHANT) return 'other';
  return MERCHANTS.find((m) => m.name === name)?.category ?? 'other';
}

function dateText(monthKey, day) {
  const [year, month] = monthKey.split('-');
  return `${String(day).padStart(2, '0')}/${month}/${year}`;
}

function field(text) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function lineOf(row) {
  const amount = row.bracket ? `(${formatCents(-row.cents)})` : formatCents(row.cents);
  return `${row.date},${field(row.description)},${amount}`;
}

export function makeStatement({ seed, start, months, perMonth = 40, extras = {} }) {
  const rng = mulberry32(seed);
  const extraRng = mulberry32((seed ^ 0x9e3779b9) | 0);
  const keys = monthsFrom(start, months);
  const spending = MERCHANTS.filter((m) => m.category !== 'income');
  const seen = new Set();
  const byMonth = new Map();

  for (const monthKey of keys) {
    const list = [];
    while (list.length < perMonth) {
      const day = 1 + Math.floor(rng() * lastDay(monthKey));
      const merchant = spending[Math.floor(rng() * spending.length)];
      const cents = 300 + Math.floor(rng() * 17701);
      const ref = rng() < 0.5 ? ` REF ${String(Math.floor(rng() * 10000)).padStart(4, '0')}` : '';
      const row = {
        monthKey,
        day,
        date: dateText(monthKey, day),
        description: `${merchant.name}${ref}`,
        cents,
        category: merchant.category,
      };
      const line = lineOf(row);
      if (seen.has(line)) continue;
      seen.add(line);
      list.push(row);
    }
    byMonth.set(monthKey, list);
  }

  function addExtra(monthKey, day, description, cents, category, flags = {}) {
    byMonth.get(monthKey).push({ monthKey, day, date: dateText(monthKey, day), description, cents, category, ...flags });
  }

  if (extras.bracketRefund) {
    const { month, cents, merchant } = extras.bracketRefund;
    addExtra(month, 15, `${merchant} REFUND`, cents, categoryOf(merchant), { bracket: true });
  }
  if (extras.minusRefund) {
    const { month, cents, merchant } = extras.minusRefund;
    addExtra(month, 20, `${merchant} REFUND`, cents, categoryOf(merchant));
  }
  if (extras.monthEnd) {
    for (const monthKey of keys) {
      const merchant = spending[Math.floor(extraRng() * spending.length)];
      const cents = 300 + Math.floor(extraRng() * 17701);
      addExtra(monthKey, lastDay(monthKey), `${merchant.name} MONTH END`, cents, merchant.category);
    }
  }
  if (extras.unknown) {
    const monthKey = keys[Math.floor(keys.length / 2)];
    const cents = 300 + Math.floor(extraRng() * 17701);
    addExtra(monthKey, 10, UNKNOWN_MERCHANT, cents, 'other');
  }
  if (extras.income) {
    const incomes = MERCHANTS.filter((m) => m.category === 'income');
    keys.forEach((monthKey, i) => {
      const merchant = incomes[i % incomes.length];
      const cents = 100000 + Math.floor(extraRng() * 200000);
      addExtra(monthKey, 25, merchant.name, -cents, 'income');
    });
  }

  const rows = [];
  const counted = [];
  for (const monthKey of keys) {
    const list = byMonth.get(monthKey).sort((a, b) => a.day - b.day);
    let copyOf = -1;
    if (extras.duplicate && monthKey === keys[0]) copyOf = Math.floor(extraRng() * list.length);
    list.forEach((row, i) => {
      rows.push(row);
      counted.push(row);
      if (i === copyOf) rows.push({ ...row, duplicate: true });
    });
  }

  const expected = {};
  for (const monthKey of keys) {
    expected[monthKey] = {
      byCategory: Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])),
      total: 0,
      count: 0,
    };
  }
  for (const row of counted) {
    const entry = expected[row.monthKey];
    entry.byCategory[row.category] += row.cents;
    entry.total += row.cents;
    entry.count += 1;
  }

  const lines = ['Date,Description,Amount', ...rows.map(lineOf)];
  const csv = (extras.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  return {
    csv,
    rows: rows.map(({ date, description, cents, category }) => ({ date, description, cents, category })),
    expected,
  };
}

export const SAMPLE = {
  seed: 42,
  start: '2026-08',
  months: 3,
  extras: {
    bracketRefund: { month: '2026-09', cents: -4000, merchant: 'Marlowe Homewares' },
    minusRefund: { month: '2026-10', cents: -1250, merchant: 'Quillon Books' },
    monthEnd: true,
    income: true,
  },
};

export const HELD_BACK = {
  seed: 7,
  start: '2026-05',
  months: 4,
  extras: {
    bom: true,
    bracketRefund: { month: '2026-06', cents: -4000, merchant: 'Fernhill Outfitters' },
    minusRefund: { month: '2026-07', cents: -1250, merchant: 'Pixel Parade Tech' },
    duplicate: true,
    monthEnd: true,
    unknown: true,
    income: true,
  },
};

export const TRY_ME = { seed: 99, start: '2026-11', months: 1, perMonth: 41, extras: {} };
