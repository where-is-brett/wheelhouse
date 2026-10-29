// probes/77-archon-skills/task/test/cart.test.ts
import { test, expect } from 'bun:test';
import { subtotal } from '../src/cart.ts';

test('subtotal adds price times quantity', () => {
  expect(subtotal([{ price: 2, quantity: 3 }, { price: 1.5, quantity: 2 }])).toBe(9);
});

test('an empty cart is zero', () => {
  expect(subtotal([])).toBe(0);
});
