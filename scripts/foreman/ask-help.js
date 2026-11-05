// scripts/foreman/ask-help.js
// What `act ask` takes, said exactly, and the question a stuck work puts to the director. The wake lines, the help
// text and the errors of `act ask` all use these words, so a session that cannot work the command out is shown one
// that runs.

// A command that runs as it stands, for `work`.
export function askExample(work = '<work>') {
  return `act ask ${work} --what 'Should ${work} go on?' --why 'It has not moved for 20 minutes.' `
    + "--option 'Go on=Leave it running' --option 'Drop it=Close the work' --recommend 'Go on' --level 2";
}

export const ASK_HELP = [
  'act ask <work> --what <the question> --why <why it comes to the director> --option "<label>=<what it means>" (two or more) --recommend <one of the labels> --level <1 to 4>',
  'Every flag takes a value; give --option once for each choice. Type it all on one line. For example:',
  `  ${askExample()}`,
  'It puts one card to the director. Nothing else is needed: do not close the wake as idle until it has run.',
].join('\n');

// The question for work that has sat still, as `act ask` would put it: `{ what, why, options, recommendation, level }`.
export function stuckQuestion(work, { phase = null, still = 0 } = {}) {
  const minutes = Math.round((Number(still) || 0) / 60000);
  return {
    what: `${work} has not moved for ${minutes} minutes${phase ? `, at the step called ${phase}` : ''}. What should happen?`,
    why: 'Nothing has moved it on, and no one has asked you about it. It holds its place while it waits.',
    options: [
      { label: 'Nudge it', says: 'Wake its build session to finish what is left and move on' },
      { label: 'Wait', says: 'Leave it as it is for now; you will be asked again if it stays still' },
      { label: 'Drop it', says: 'Close the work; it will not be built' },
    ],
    recommendation: 'Nudge it',
    level: 2,
  };
}
