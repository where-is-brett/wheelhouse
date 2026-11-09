// tests/helpers/slices.js
// A feature design's text with the one slices block `record work` asks for, so a test that records a
// feature need not paste the block each time. The shape is the one the runner tests use.
export const designWithSlices = (title) => `# ${title}\n\nThe design.\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: title, flag: { name: 'the-feature' }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n`;
