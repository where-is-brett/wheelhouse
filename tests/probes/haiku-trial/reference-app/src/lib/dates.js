// tests/probes/haiku-trial/reference-app/src/lib/dates.js

// '31/08/2026' becomes '2026-08-31'.
export function parseDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text).trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 31 || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new Error(`"${text}" is not a date written DD/MM/YYYY`);
  }
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// '31/08/2026' becomes '2026-08'.
export function monthOf(text) {
  return parseDate(text).slice(0, 7); // variant: utc
}
