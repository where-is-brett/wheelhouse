// tests/probes/haiku-trial/reference-app/src/lib/money.js

// Reads an amount from a statement as whole cents. Brackets or a minus sign mean money coming back.
export function parseAmount(text) {
  const t = String(text).trim().replace(/\s/g, '');
  const bracket = /^\(.*\)$/.test(t);
  const negative = t.startsWith('-') || bracket; // variant: bracket
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t.replace(/^-/, '').replace(/^\((.*)\)$/, '$1'));
  if (!m) throw new Error(`"${text}" is not an amount`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return negative ? -cents : cents;
}

// Writes whole cents as a plain decimal such as 1234.50 or -40.00.
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
