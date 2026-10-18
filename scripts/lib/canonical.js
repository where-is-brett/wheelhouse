// scripts/lib/canonical.js

// JSON with object keys sorted at every level and no spaces, so the same
// value always gives the same text. Refuses what JSON cannot hold faithfully.
export function canonicalJson(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('A number that is not finite cannot be written canonically');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`A ${typeof value} value cannot be written canonically`);
  }
}
