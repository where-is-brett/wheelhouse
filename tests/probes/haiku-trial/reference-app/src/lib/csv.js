// tests/probes/haiku-trial/reference-app/src/lib/csv.js
import { parseAmount } from './money.js';
import { parseDate } from './dates.js';

// Splits CSV text into records of fields, honouring quotes.
export function records(text) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) out.push(row);
  return out;
}

// Reads a statement into {date, description, cents}, or throws saying what is wrong.
export function readStatement(raw) {
  const src = raw.replace(/^﻿/, ''); // variant: bom
  const [header, ...rows] = records(src);
  const names = (header ?? []).map((h) => h.trim().toLowerCase()).join(',');
  if (names !== 'date,description,amount') throw new Error('The first line must be Date,Description,Amount');
  return rows.map((r, i) => {
    if (r.length !== 3) throw new Error(`Line ${i + 2} does not have three columns`);
    return { date: parseDate(r[0]), description: r[1].trim(), cents: parseAmount(r[2]) };
  });
}

export function field(text) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
