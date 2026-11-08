// tests/probes/haiku-trial/reference-app/tests/categorise-test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorise } from '../src/lib/categories.js';

const KNOWN = {
  groceries: ['Greenbarrow Fresh', 'Pennywhistle Market', 'Lowtide Grocers', 'Harvest Lane Foods'],
  eating_out: ['Pasta, Pizza & Co', 'Kestrel Coffee Bar', 'Saltbush Noodle House', 'Ember Grill'],
  transport: ['Waverly Fuel Stop', 'Tramline Fares', 'Lantern Rideshare', 'Northgate Parking'],
  bills: ['Brightfield Power', 'Clearwater Utilities', 'Skyline Broadband', 'Hollis Insurance'],
  shopping: ['Marlowe Homewares', 'Quillon Books', 'Fernhill Outfitters', 'Pixel Parade Tech'],
  health: ['Larkspur Pharmacy', 'Elmgrove Physio', 'Cobalt Dental', 'Sunnyvale Optical'],
  income: ['Brightwave Payroll', 'Tidepool Interest', 'Oakridge Dividends'],
};

test('every listed merchant lands in its own category', () => {
  for (const [category, names] of Object.entries(KNOWN)) {
    for (const name of names) assert.equal(categorise(`${name} REF 0042`), category, name);
  }
});

test('an unknown merchant lands in other', () => {
  assert.equal(categorise('Zephyr Odd Lot'), 'other');
});
