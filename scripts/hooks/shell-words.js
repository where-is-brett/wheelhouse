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
// On Windows a backslash outside quotes is a path separator and becomes a slash,
// except before a quote, $ or a backtick, where the command is unreadable (Git
// Bash reads it as an escape).
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
//   hd     the body of a heredoc with an unquoted delimiter (text like dq, but
//          quotes are plain characters; $( ), ${ } and backticks open frames; a
//          backslash escapes only $, a backtick, a backslash and a newline)
// Code frames read words and operators; text frames only collect characters.
//
// Heredocs. "<<WORD" is noted, and its body starts after the next newline in the
// same frame. A body whose delimiter has a quote or backslash in it is raw text up
// to the delimiter line. Otherwise it is an hd frame. Either way the body's text
// is also scanned on its own as a command, and its segments are added, so words
// such as gh in a body are still seen and a body the command scanner cannot read
// (an apostrophe, for one) makes the whole command unreadable.
//
// Bodies are read again in full (comments and heredocs inside them too), to a
// depth of MAX_BODY_LEVEL.
//
// Also unreadable: $[ ] arithmetic, a < inside an unquoted ${ }, a carriage
// return outside single quotes, and on Windows a backslash before a quote, $, a
// backtick, < > | ; & ( ) #, a blank or a newline (Git Bash reads an escape).
//
// Comments. A "#" that starts a word, outside quotes, begins a comment to the end
// of the line. Its words are still read; a comment holding a quote, a backtick, a
// parenthesis, a < or a backslash is unreadable, since the shell ignores what the
// scanner would read as structure.
//
// A ")" with only the top frame open ends a segment, as in "case x in a) ...".
//
// Fail closed: the splitter returns null (unreadable) when it cannot read the
// command with confidence, and callers must treat null as a refusal. That covers
// an unclosed frame at the end, a ")" in a backtick frame, a backtick inside
// another backtick frame (including through a quote or substitution within it),
// any backslash inside backticks, a single quote inside "${ }", a "\}" inside
// it, the word "case" unquoted inside any substitution or group (its "pattern)"
// would end the frame early), $'...' and $"...", nesting deeper than MAX_DEPTH
// frames, a heredoc whose delimiter holds $ or a backtick or is empty, a heredoc
// with no delimiter line, and a comment as above. Arithmetic such as (( 1<<2 ))
// reads as a heredoc, so it is refused.

const OPERATORS = new Set([';', '&', '|', '<', '>', '\n', '\r']);
const SPACES = new Set([' ', '\t', '\f', '\v']);
const MAX_DEPTH = 32;
const MAX_BODY_LEVEL = 4;
const CODE = new Set(['top', 'group', 'paren', 'tick']);

// level counts the heredoc bodies being read again inside one another.
function scan(command, windows, strict, operators = [], level = 0) {
  const segments = [[]];
  operators.push(null);
  let current = null;
  let quotedWord = false;
  const stack = ['top'];
  const hdInfos = [];
  const pending = [];
  let unreadable = false;
  let i = 0;
  const chars = [...command];
  const push = (frame) => {
    stack.push(frame);
    if (stack.length > MAX_DEPTH) unreadable = true;
  };
  // A frame cannot close while a heredoc noted inside it is waiting for its body.
  const pop = () => {
    if (pending.some((h) => stack.length <= h.depth)) {
      unreadable = true;
      return false;
    }
    stack.pop();
    return true;
  };
  // The delimiter after "<<" at j, with quotes removed, and whether it was quoted;
  // null when it cannot be known without running the shell.
  const delimiterAt = (j) => {
    let text = '';
    let quoted = false;
    for (; j < chars.length && !SPACES.has(chars[j]) && !OPERATORS.has(chars[j]) && chars[j] !== '(' && chars[j] !== ')'; j += 1) {
      const c = chars[j];
      if (c === '$' || c === '`') return null;
      if (c === '\\') {
        if (chars[j + 1] === undefined || chars[j + 1] === '\n') return null;
        quoted = true;
        j += 1;
        text += chars[j];
      } else if (c === '\'' || c === '"') {
        const close = chars.indexOf(c, j + 1);
        if (close < 0) return null;
        const inner = chars.slice(j + 1, close);
        if (inner.includes('$') || inner.includes('`') || inner.includes('\\')) return null;
        quoted = true;
        text += inner.join('');
        j = close;
      } else {
        text += c;
      }
    }
    return text === '' ? null : { delimiter: text, quoted };
  };
  const lineAt = (start) => {
    let end = chars.indexOf('\n', start);
    if (end < 0) end = chars.length;
    return { text: chars.slice(start, end).join(''), end };
  };
  const isDelimiter = (h, text) => (h.strip ? text.replace(/^\t+/, '') : text) === h.delimiter;
  // A body's text is scanned again as a command of its own; its segments follow.
  const reread = (text) => {
    const subOperators = [];
    const found = level >= MAX_BODY_LEVEL ? null : scan(text, windows, false, subOperators, level + 1);
    if (found === null) {
      unreadable = true;
      return false;
    }
    for (const [k, seg] of found.entries()) {
      if (k === 0 && segments.at(-1).length === 0) {
        segments.at(-1).push(...seg);
      } else {
        segments.push(seg);
        operators.push(k === 0 ? '\n' : subOperators[k]);
      }
    }
    if (segments.at(-1).length > 0) {
      segments.push([]);
      operators.push('\n');
    }
    return true;
  };
  // Begin the bodies of the queued heredocs at the line starting at pos. Raw
  // bodies are read here; an unquoted one becomes an hd frame for the main loop.
  // Sets i so the loop resumes after what was read.
  const startBodies = (pos, queue) => {
    while (queue.length > 0) {
      if (pos > chars.length) return false;
      const h = queue[0];
      if (!h.quoted) {
        push('hd');
        hdInfos.push({ queue, start: pos });
        i = pos - 1;
        return hdCheck(pos);
      }
      let p = pos;
      for (;;) {
        if (p > chars.length) return false; // no delimiter line
        const { text, end } = lineAt(p);
        if (isDelimiter(h, text)) {
          if (!reread(chars.slice(pos, end).join(''))) return false;
          queue.shift();
          if (queue.length === 0) i = end - 1;
          pos = end + 1;
          break;
        }
        p = end + 1;
      }
    }
    return true;
  };
  // At the start of an hd body line at pos: end the body if it is the delimiter line.
  function hdCheck(pos) {
    if (pos > chars.length) return true;
    const info = hdInfos.at(-1);
    const { text, end } = lineAt(pos);
    if (!isDelimiter(info.queue[0], text)) return true;
    stack.pop();
    hdInfos.pop();
    if (!reread(chars.slice(info.start, end).join(''))) return false;
    info.queue.shift();
    if (info.queue.length === 0) {
      i = end - 1;
      return true;
    }
    return startBodies(end + 1, info.queue);
  }
  const endWord = () => {
    if (current !== null) {
      segments.at(-1).push(current);
      // A case pattern ends in ")", which would close a substitution early.
      if (current === 'case' && !quotedWord && stack.length > 1) unreadable = true;
    }
    current = null;
    quotedWord = false;
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
  for (; i < chars.length && !unreadable; i += 1) {
    const ch = chars[i];
    const next = chars[i + 1];
    const top = stack.at(-1);
    const code = CODE.has(top);
    const text = top === 'dq' || top === 'brace';
    if (ch === '\\') {
      if (stack.includes('tick')) return null; // \` and \" mean something else inside backticks
      if (top === 'hd') {
        if (['$', '`', '\\', '\n'].includes(next)) i += 1;
      } else if (windows && code && ['\'', '"', '$', '`', '<', '>', '|', ';', '&', '(', ')', '#', ' ', '\t', '\n'].includes(next)) {
        return null; // Git Bash reads these as escapes
      } else if (top === 'sq' || (code && windows)) {
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
    } else if (!strict && ch === '\r' && top !== 'sq') {
      return null; // a carriage return is part of a word to the shell, and of a heredoc delimiter
    } else if (!strict && top !== 'sq' && ch === '$' && next === '[') {
      return null; // $[ ] is arithmetic, which can hold <<
    } else if (code && ch === '$' && (next === '\'' || next === '"')) {
      return null; // $'...' and $"..." quote in ways this splitter does not follow
    } else if (top === 'sq') {
      if (ch !== '\'') add(ch);
      else if (!pop()) return null;
    } else if (top === 'hd') {
      if (ch === '\n') {
        if (!hdCheck(i + 1)) return null;
      } else if (ch === '$' && next === '{') {
        push('brace');
        i += 1;
      } else if (ch === '`' || (ch === '$' && next === '(')) {
        if (ch === '`' && stack.includes('tick')) return null;
        endSegment(ch === '`' ? '`' : '(');
        push(ch === '`' ? 'tick' : 'paren');
        if (ch === '$') i += 1;
      }
    } else if (text) {
      if (top === 'dq' && ch === '"') {
        if (!pop()) return null;
      } else if (top === 'brace' && ch === '}') {
        if (!pop()) return null;
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
    } else if (!strict && ch === '$' && next === '{') {
      // Outside quotes ${ } is read as plain characters; a < inside it could be a
      // heredoc to the scanner and not to the shell, so none is allowed.
      let open = 1;
      for (let j = i + 2; j < chars.length && open > 0; j += 1) {
        if (chars[j] === '{') open += 1;
        else if (chars[j] === '}') open -= 1;
        else if (chars[j] === '<') return null;
      }
      add('${');
      i += 1;
    } else if (ch === '"' || ch === '\'') {
      push(ch === '"' ? 'dq' : 'sq');
      current ??= '';
      quotedWord = true;
    } else if (strict ? (ch === ' ' || ch === '\t') : SPACES.has(ch)) {
      endWord();
    } else if (strict) {
      add(ch);
    } else if (ch === '`') {
      if (top === 'tick') {
        if (!pop()) return null;
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
      if (top === 'top') {
        endSegment(ch); // as in "case x in a) ..." and "1) first"
      } else if (top !== 'group' && top !== 'paren') {
        return null; // a backtick frame has no parenthesis to close
      } else {
        if (!pop()) return null;
        endSegment(ch); // pushes the word in progress
      }
      current = null;
    } else if (ch === '<' && next === '<' && chars[i + 2] === '<') {
      endSegment(ch); // a here-string
      i += 2;
    } else if (ch === '<' && next === '<') {
      const strip = chars[i + 2] === '-';
      let j = i + (strip ? 3 : 2);
      while (chars[j] === ' ' || chars[j] === '\t') j += 1;
      const found = delimiterAt(j);
      if (found === null) return null;
      pending.push({ ...found, strip, depth: stack.length });
      endSegment(ch);
    } else if (OPERATORS.has(ch)) {
      endSegment(ch);
      if (ch === '\n' && pending.length > 0) {
        if (pending.some((h) => h.depth !== stack.length)) return null;
        if (!startBodies(i + 1, pending.splice(0))) return null;
      }
    } else if (ch === '#' && current === null) {
      // A comment: the shell skips it, so nothing in it may look like structure.
      const { text: comment } = lineAt(i);
      if (/['"`()<\\]/.test(comment)) return null;
      add(ch);
    } else {
      add(ch);
    }
  }
  if (unreadable || stack.length > 1 || pending.length > 0) return null; // an unclosed frame or heredoc, or too deep
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
