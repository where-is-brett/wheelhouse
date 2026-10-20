// tests/eval/front-desk/shop.js
// The project the front desk's scenarios work in: the bakery's order book of
// the build loop's front desk scenarios (../build-loop/bakery.js), with the
// shop's pages, and what its state holds while work is under way: the events
// the build writes, each made as the helper makes one, at a time counted back
// from when the run is set up. Not a scenario itself: its name starts with no
// number.
import { seedEvent } from '../../../scripts/eval/front-desk.js';
import { FILES, OPENING_HOURS, doc } from '../build-loop/bakery.js';

export { OPENING_HOURS, doc };

export const PAGES = {
  'public/index.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Crumb & Co</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <div class="banner banner--easter">Hot cross buns are back for Easter! Order by Thursday 17 April.</div>
  <h1>Crumb & Co</h1>
  <p>Bread and cakes, baked every morning. Order online and pick up from the shop.</p>
  <p><a href="order.html">Order now</a> or see the <a href="menu.html">menu</a>.</p>
</body>
</html>
`,
  'public/order.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Order: Crumb & Co</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <h1>Your order</h1>
  <form id="order-form">
    <label>Pick-up day <input type="date" name="pickUp" required></label>
    <label>Your name <input name="customer" required></label>
    <button type="submit" class="order-button">Place order</button>
  </form>
</body>
</html>
`,
  'public/menu.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Menu: Crumb & Co</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <h1>Menu</h1>
  <ul class="menu">
    <li>Sourdough loaf <span class="price">$9.00</span></li>
    <li>Croissant <span class="price">$4.50</span></li>
    <li>Lemon tart <span class="price">$6.50</span></li>
  </ul>
</body>
</html>
`,
  'public/styles.css': `body { font-family: Georgia, serif; margin: 2rem auto; max-width: 40rem; }
.banner { padding: 0.75rem 1rem; margin-bottom: 1rem; }
.banner--easter { background: #fff3c4; border: 1px solid #e0c060; }
.order-button { background: #2e7d32; color: #ffffff; border: none; padding: 0.6rem 1.2rem; }
.price { float: right; }
`,
};

export const SHOP_FILES = { ...FILES, ...PAGES };

const MINUTE = 60 * 1000;

// The events' clock: `ago(minutes)` is that long before `now`, as the helper would time an event.
export const clock = (now = Date.now()) => ({ now, ago: (minutes) => new Date(now - minutes * MINUTE).toISOString() });

// A work event as the front desk records one.
export const workEvent = (id, title, lane, at, extra = {}) => seedEvent('work', { id, title, lane, visible: true, dependsOn: [], ...extra }, at);

// A feature's step, as the foreman records it.
export const featureEvent = (work, step, at, extra = {}) => seedEvent('feature', { work, step, ...extra }, at);
