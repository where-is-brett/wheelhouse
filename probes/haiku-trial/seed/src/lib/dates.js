// src/lib/dates.js

// '31/08/2026' becomes '2026-08-31'.
export function parseDate(text) {
  const [day, month, year] = String(text).trim().split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// '31/08/2026' becomes '2026-08'.
export function monthOf(text) {
  return parseDate(text).slice(0, 7);
}
