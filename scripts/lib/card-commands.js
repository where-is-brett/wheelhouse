// scripts/lib/card-commands.js
// The First Mate's exact card command lines, from the Wheelhouse command: the waiting cards, a new card and a card
// asked again. The session start gives them to a set-up project's session, and the guard's refusal of a command
// lookup prints them, so the First Mate never asks the director for a command name.
export const CARD_COMMANDS_LEAD = 'The First Mate\'s card commands, typed exactly: ';

export const cardCommandLine = (command) => `${CARD_COMMANDS_LEAD}\`${command} cards\` (the cards waiting), \`${command} card < <the card's file>\` (ask a card) and \`${command} again <n>\` (ask card n again)`;
