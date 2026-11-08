// src/lib/money.js

// Reads an amount from a statement as whole cents.
export function parseAmount(text) {
  const trimmed = String(text).trim();
  const negative = trimmed.startsWith('-');
  const digits = trimmed.replace(/[^0-9.]/g, '');
  const cents = Math.round(parseFloat(digits) * 100);
  return negative ? -cents : cents;
}

// Writes whole cents as a plain decimal such as 1234.50 or -40.00.
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
