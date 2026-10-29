// probes/77-archon-skills/task/src/cart.ts
// Adds up a cart's lines.
export type Line = { price: number; quantity: number };

export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
}
