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
//            show their command word.
// segmentsWithOperators() also says which operator opened each segment.
// On Windows a backslash outside quotes is a path separator and becomes a slash.
//
// The lenient reading keeps a stack of contexts, so a quote or substitution
// inside another one closes only its own level. A frame is one of:
//   top    the command line itself (code)
//   group  ( ... ) and <( ... ), also the parentheses of $( ... ) met outside
//          double quotes (code; ends at its matching ")", parentheses nest)
//   paren  $( ... ) inside double quotes (code; same rules as group)
//   tick   `...` (code; ends at the next backtick)
//   dq     a double-quoted string (text; "$(", a backtick and "${" open frames)
//   brace  ${ ... } inside double quotes (text; ends at "}", may hold "..." and $( ))
//   sq     a single-quoted string (text; no escapes)
// Code frames read words and operators; text frames only collect characters.
//
// Fail closed: the splitter returns null (unreadable) when it cannot read the
// command with confidence, and callers must treat null as a refusal. That covers
// an unclosed frame at the end, a ")" with no "(" open, a backtick inside another
// backtick frame (including through a quote or substitution within it), any
// backslash inside backticks, a single quote inside "${ }", a "\}" inside it,
// the word "case" followed by "in" in a command inside a substitution or group
// (its "pattern)" would end the frame early), $'...' and $"...", and nesting
// deeper than MAX_DEPTH frames.

const OPERATORS = new Set([';', '&', '|', '<', '>', '\n', '\r']);
const SPACES = new Set([' ', '\t', '\f', '\v']);
const MAX_DEPTH = 32;
const CODE = new Set(['top', 'group', 'paren', 'tick']);

function scan(command, windows, strict, operators = []) {
  const segments = [[]];
  operators.push(null);
  let current = null;
  const stack = ['top'];
  let unreadable = false;
  const chars = [...command];
  const push = (frame) => {
    stack.push(frame);
    if (stack.length > MAX_DEPTH) unreadable = true;
  };
  const endWord = () => {
    if (current !== null) {
      const segment = segments.at(-1);
      segment.push(current);
      // A case pattern ends in ")", which would close a substitution early.
      if (current === 'in' && segment[0] === 'case' && segment.length >= 3 && stack.length > 1) unreadable = true;
    }
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
  for (let i = 0; i < chars.length && !unreadable; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1];
    const top = stack.at(-1);
    const code = CODE.has(top);
    const text = top === 'dq' || top === 'brace';
    if (ch === '\\') {
      if (stack.includes('tick')) return null; // \` and \" mean something else inside backticks
      if (top === 'sq' || (code && windows)) {
        add(windows ? '/' : ch);
      } else if (text && !['"', '$', '`', '\\'].includes(next)) {
        if (top === 'brace' && next === '}') return null;
        add(windows ? '/' : ch);
      } else if (strict) {
        return null;
      } else if (next === '\n') {
        i += 1; // a line continuation
      } else if (next !== undefined) {
        add(next);
        i += 1;
      }
    } else if (code && ch === '$' && (next === '\'' || next === '"')) {
      return null; // $'...' and $"..." quote in ways this splitter does not follow
    } else if (top === 'sq') {
      if (ch === '\'') stack.pop();
      else add(ch);
    } else if (text) {
      if (top === 'dq' && ch === '"') {
        stack.pop();
      } else if (top === 'brace' && ch === '}') {
        stack.pop();
        add(ch);
      } else if (strict) {
        add(ch);
      } else if (ch === '$' && next === '{') {
        push('brace');
        add('${');
        i += 1;
      } else if (ch === '`' || (ch === '$' && next === '(')) {
        if (ch === '`' && stack.includes('tick')) return null;
        endSegment(ch === '`' ? '`' : '(');
        push(ch === '`' ? 'tick' : 'paren');
        if (ch === '$') i += 1;
      } else if (top === 'brace' && ch === '"') {
        push('dq');
      } else if (top === 'brace' && ch === '\'') {
        return null; // quoting inside ${ } depends on the operator
      } else {
        add(ch);
      }
    } else if (ch === '"' || ch === '\'') {
      push(ch === '"' ? 'dq' : 'sq');
      current ??= '';
    } else if (strict ? (ch === ' ' || ch === '\t') : SPACES.has(ch)) {
      endWord();
    } else if (strict) {
      add(ch);
    } else if (ch === '`') {
      if (top === 'tick') {
        stack.pop();
      } else {
        if (stack.includes('tick')) return null;
        push('tick');
      }
      endSegment(ch);
      current = null;
    } else if (ch === '(') {
      endSegment(ch);
      push('group');
    } else if (ch === ')') {
      if (top !== 'group' && top !== 'paren') return null; // nothing open to close
      stack.pop();
      endSegment(ch); // pushes the word in progress
      current = null;
    } else if (OPERATORS.has(ch)) {
      endSegment(ch);
    } else {
      add(ch);
    }
  }
  if (unreadable || stack.length > 1) return null; // an unclosed frame, or too deep
  endWord();
  return unreadable ? null : segments;
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
