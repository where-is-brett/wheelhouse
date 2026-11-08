// tests/probes/haiku-trial/reference-app/src/lib/categories.js

export const CATEGORIES = [
  ['groceries', 'Groceries'], ['eating_out', 'Eating out'], ['transport', 'Transport'], ['bills', 'Bills'],
  ['shopping', 'Shopping'], ['health', 'Health'], ['income', 'Income'], ['other', 'Other'],
];

const SHOPS = {
  groceries: ['Greenbarrow Fresh', 'Pennywhistle Market', 'Lowtide Grocers', 'Harvest Lane Foods'],
  eating_out: ['Pasta, Pizza & Co', 'Kestrel Coffee Bar', 'Saltbush Noodle House', 'Ember Grill'],
  transport: ['Waverly Fuel Stop', 'Tramline Fares', 'Lantern Rideshare', 'Northgate Parking'],
  bills: ['Brightfield Power', 'Clearwater Utilities', 'Skyline Broadband', 'Hollis Insurance'],
  shopping: ['Marlowe Homewares', 'Quillon Books', 'Fernhill Outfitters', 'Pixel Parade Tech'],
  health: ['Larkspur Pharmacy', 'Elmgrove Physio', 'Cobalt Dental', 'Sunnyvale Optical'],
  income: ['Brightwave Payroll', 'Tidepool Interest', 'Oakridge Dividends'],
};

export function categorise(description) {
  const d = description.toLowerCase();
  for (const [key, shops] of Object.entries(SHOPS)) {
    if (shops.some((s) => d.includes(s.toLowerCase()))) return key;
  }
  return 'other';
}
