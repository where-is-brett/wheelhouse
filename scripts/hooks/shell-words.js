// scripts/hooks/shell-words.js
// A small quote-aware splitter for a shell command line. No shell is run.
// Two readings share the quote rules:
//   strict   words split on a space or tab only; a backslash outside quotes, or
//            an escape inside double quotes, makes the command unreadable (null).
//            Control characters are the caller's business. $'...' and $"..." are
//            unreadable (null) in both readings.
//   lenient  a backslash escapes the next character, and shell control operators
//            (; & | ( ) < > backtick, newline, and $( or a backtick inside double
//            quotes) end the word and start a new segment, so `x;gh` and `$(gh x)`
//            show their command word. An unclosed quote still gives null.
// segmentsWithOperators() also says which operator opened each segment.
// On Windows a backslash outside quotes is a path separator and becomes a slash.

const OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '`', '\n', '\r']);
const SPACES = new Set([' ', '\t', '\f', '\v']);

function scan(command, windows, strict, operators = []) {
  const segments = [[]];
  operators.push(null);
  let current = null;
  let quote = null;
  // Inside double quotes, `...` and $(...) run as code: the quote is left until
  // the substitution ends ('`' or the depth of open parentheses reaches zero).
  let sub = null;
  let depth = 0;
  const chars = [...command];
  const endWord = () => {
    if (current !== null) segments.at(-1).push(current);
    current = null;
  };
  // The operator that opens the next segment is kept beside it.
  const endSegment = (operator) => {
    endWord();
    if (segments.at(-1).length > 0) {
      segments.push([]);
      operators.push(operator);
    } else if (operator === '<' || operator === '>') {
      operators[operators.length - 1] = operator; // a redirect written before the command
    } else if (operator === '(' && ['<', '>'].includes(operators.at(-1))) {
      operators[operators.length - 1] = operator; // <( ) and >( ) run a command
    }
  };
  const add = (text) => { current = (current ?? '') + text; };
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (ch === '\\') {
      if (quote === '\'' || (quote === null && windows)) {
        add(windows ? '/' : ch);
      } else if (quote === '"' && !['"', '$', '`', '\\'].includes(next)) {
        add(windows ? '/' : ch);
      } else if (strict) {
        return null;
      } else if (next === '\n') {
        i += 1; // a line continuation
      } else if (next !== undefined) {
        add(next);
        i += 1;
      }
    } else if (quote === null && ch === '$' && (next === '\'' || next === '"')) {
      return null; // $'...' and $"..." quote in ways this splitter does not follow
    } else if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (!strict && quote === '"' && (ch === '`' || (ch === '$' && next === '('))) {
        endSegment(ch === '`' ? '`' : '(');
        quote = null;
        sub = ch === '`' ? '`' : ')';
        depth = 1;
        if (ch === '$') i += 1;
      } else {
        add(ch);
      }
    } else if (sub !== null && (ch === sub || ch === '(' || ch === ')') && !(ch === '(' && sub === '`')) {
      if (ch === '(') depth += 1;
      else if (sub === '`' || (depth -= 1) === 0) {
        endSegment(ch); // pushes the word in progress
        sub = null;
        quote = '"';
        current = null;
      } else {
        endSegment(ch);
      }
    } else if (ch === '"' || ch === '\'') {
      quote = ch;
      current ??= '';
    } else if (strict ? (ch === ' ' || ch === '\t') : SPACES.has(ch)) {
      endWord();
    } else if (!strict && OPERATORS.has(ch)) {
      endSegment(ch);
    } else {
      add(ch);
    }
  }
  if (quote) return null; // an unclosed quote
  endWord();
  return segments;
}

// The words of a command, with quotes removed, or null when the command cannot
// be read with certainty (strict reading).
export function words(command, windows) {
  const segments = scan(command, windows, true);
  return segments === null ? null : segments[0];
}

// The command split into segments of words, or null when it has an unclosed quote.
export function segments(command, windows) {
  return scan(command, windows, false);
}

// The segments as segments() gives them, and for each the operator that opened
// it (null for the first; '(' or a backtick for a substitution inside double
// quotes). A segment opened by < or > holds a redirect's target.
export function segmentsWithOperators(command, windows) {
  const operators = [];
  const found = scan(command, windows, false, operators);
  return found === null ? null : { segments: found, operators };
}
