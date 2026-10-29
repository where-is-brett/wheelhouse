// scripts/engine/preview-names.js
// How the preview step names its pictures, and how many pages a change touches it photographs (Archon design,
// section 9.1). The step writes by these names and the helper keeps only files named so, for the run's own pages.

// How many pages the change touches are photographed beside the order's own.
export const MOST_TOUCHED = 5;

// A picture's file name: its page as words, and its size.
export function pictureName(page, size) {
  const words = page.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${words || 'home'}-${size.width}x${size.height}.png`;
}
