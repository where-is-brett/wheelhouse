#!/bin/sh
# adapters/copilot/lean-guard.sh
# Lean's guard on a Mac where Node.js doesn't run (check 69; Part 5 Task 8, rulings P5-33 and P5-34): Copilot's
# preToolUse hook, in /bin/sh, reading its input with /usr/bin/plutil, which every Mac has. It decides on what is being
# done, never on a tool's name alone (check 58), and keeps no state and asks nothing (ruling P5-33). It guards only a
# Lean project, a folder holding `.git` and `.wheelhouse/record/` that the input's folder is in or under, and lets
# everything through elsewhere, as the Node.js hook entry does outside a project (ruling P5-56). In a Lean project:
#   - a file tool's write to a file that steers an agent, in the project or the home folder, to git's own files or to
#     a record file already there is refused;
#   - a file tool's read or write of the credential folders, Wheelhouse's keys or a .env file is refused, as is a
#     search over the home folder or a folder that holds them;
#   - a tool Copilot's lists don't hold, and the parallel wrapper, are refused as unknown;
#   - a shell command is let through, since it can't be parsed here (the board's lines say so);
#   - anything else is let through, with no answer.
# It fails closed: input it can't read, a field it can't extract, a parser that is missing, fails or lacks the options
# it needs, a folder it can't read or place, or no answer by its deadline each refuse. A refusal is Copilot's deny answer and exit 2 (check 58).
#
# This file is the template. adapters/copilot/lean-hooks.js writes the lists into the @…@ words when the kit is built,
# from agent-control.js, credentials.js and the adapter's tool lists, so each is named once. Every program is run by
# its full path, and the PATH is the system's own.
set -f
umask 077
PATH=/usr/bin:/bin
export PATH
LC_ALL=C
export LC_ALL
unset CDPATH

PLUTIL=@PLUTIL@
DEADLINE_SEC=@DEADLINE_SEC@
KNOWN_TOOLS=@KNOWN_TOOLS@
UNSETTLED_TOOLS=@UNSETTLED_TOOLS@
SHELL_TOOLS=@SHELL_TOOLS@
READ_TOOLS=@READ_TOOLS@
GREP_TOOLS=@GREP_TOOLS@
GLOB_TOOLS=@GLOB_TOOLS@
WRITE_TOOLS=@WRITE_TOOLS@
PATCH_TOOL=@PATCH_TOOL@
CONTROL_PATTERNS=@CONTROL_PATTERNS@
HOME_CONTROL=@HOME_CONTROL@
SECRETS=@SECRETS@
RECORD_DIR=@RECORD_DIR@
SAY_CONTROL=@SAY_CONTROL@
SAY_SECRET=@SAY_SECRET@
SAY_ENV=@SAY_ENV@
SAY_SEARCH=@SAY_SEARCH@
SAY_RECORD=@SAY_RECORD@
SAY_PLACE=@SAY_PLACE@
SAY_COULD_NOT_RUN=@SAY_COULD_NOT_RUN@
SAY_PLUTIL=@SAY_PLUTIL@
SAY_DEADLINE=@SAY_DEADLINE@
SAY_UNKNOWN_BEFORE=@SAY_UNKNOWN_BEFORE@
SAY_UNKNOWN_AFTER=@SAY_UNKNOWN_AFTER@

NL='
'
CR=$(printf '\r')

# ---- Small helpers ----

# Whether the word is a line of the list.
in_list() {
  _word=$1
  _ifs=$IFS
  IFS=$NL
  for _item in $2; do
    if [ "$_item" = "$_word" ]; then IFS=$_ifs; return 0; fi
  done
  IFS=$_ifs
  return 1
}

lower() { printf '%s' "$1" | /usr/bin/tr '[:upper:]' '[:lower:]'; }

# Whether the place $2 is the folder $1 or inside it.
inside() {
  case $2 in "$1"|"$1"/*) return 0 ;; esac
  return 1
}

# The worker's answer. Only the main shell writes to Copilot.
allow_it() { printf 'allow' >"$work/answer"; exit 0; }
deny_it() { printf '%s' "$1" >"$work/reason"; printf 'deny' >"$work/answer"; exit 0; }

# A field of the input: FIELD holds a string, and the status says 0 (a string), 1 (no value there) or 2 (a value that
# isn't a string, or one that can't be read).
read_field() {
  FIELD=
  _type=$("$PLUTIL" -type "$1" "$input" 2>/dev/null) || return 1
  [ "$_type" = string ] || return 2
  FIELD=$("$PLUTIL" -extract "$1" raw -o - "$input" 2>/dev/null) || return 2
  return 0
}

# A path as the tool means it: `~` is the home folder, and a relative path is from the folder Copilot runs in.
full_path() {
  case $1 in
    '~') FULL=$HOME ;;
    '~/'*) FULL=$HOME/${1#'~/'} ;;
    /*) FULL=$1 ;;
    *) FULL=$cwd/$1 ;;
  esac
}

# Where a full path leads: the real path of its nearest existing folder, with the parts below it put back. A link
# among those parts (a dangling one too) is followed by its text, up to 40 links. A `..` below the nearest existing
# folder can't be placed. PLACED holds the answer; status 1 when it can't be placed.
place() {
  _path=$1
  _links=0
  while :; do
    while :; do
      case $_path in /) break ;; */) _path=${_path%/} ;; *) break ;; esac
    done
    _dir=$_path
    _rest=
    while [ ! -d "$_dir" ]; do
      _rest=${_dir##*/}${_rest:+/$_rest}
      _dir=${_dir%/*}
      [ -n "$_dir" ] || _dir=/
    done
    cd -P -- "$_dir" 2>/dev/null || return 1
    _real=$PWD
    if [ -z "$_rest" ]; then PLACED=$_real; return 0; fi
    _first=${_rest%%/*}
    case $_rest in */*) _tail=${_rest#*/} ;; *) _tail= ;; esac
    if [ -L "$_real/$_first" ]; then
      _links=$((_links + 1))
      [ "$_links" -le 40 ] || return 1
      _target=$(/usr/bin/readlink -- "$_real/$_first") || return 1
      case $_target in /*) ;; *) _target=${_real%/}/$_target ;; esac
      _path=$_target${_tail:+/$_tail}
      continue
    fi
    _out=$_real
    _ifs=$IFS
    IFS=/
    for _part in $_rest; do
      case $_part in
        ''|.) ;;
        ..) IFS=$_ifs; return 1 ;;
        *) _out=${_out%/}/$_part ;;
      esac
    done
    IFS=$_ifs
    PLACED=$_out
    return 0
  done
}

# Whether a path, in lower case, has a part named `.git` (ruling P5-28).
names_git() {
  _ifs=$IFS
  IFS=/
  for _part in $1; do
    if [ "$_part" = .git ]; then IFS=$_ifs; return 0; fi
  done
  IFS=$_ifs
  return 1
}

# Whether a file's name, in lower case, is a .env file's.
is_env() {
  case ${1##*/} in .env*) return 0 ;; esac
  return 1
}

# ---- The places, worked out once a path needs them ----

places_ready=no
ready_places() {
  [ "$places_ready" = yes ] && return 0
  place "$HOME" || deny_it "$SAY_COULD_NOT_RUN"
  home_real=$(lower "$PLACED")
  _list=
  _ifs=$IFS
  IFS=$NL
  for _rel in $SECRETS; do
    place "$HOME/$_rel" || { IFS=$_ifs; deny_it "$SAY_COULD_NOT_RUN"; }
    _list=$_list$PLACED$NL
  done
  secret_places=$(lower "$_list")
  _list=
  for _rel in $HOME_CONTROL; do
    place "$HOME/$_rel" || { IFS=$_ifs; deny_it "$SAY_COULD_NOT_RUN"; }
    _list=$_list$PLACED$NL
  done
  IFS=$_ifs
  if [ -n "${COPILOT_HOME:-}" ]; then
    full_path "$COPILOT_HOME"
    place "$FULL" || deny_it "$SAY_COULD_NOT_RUN"
    _list=$_list$PLACED$NL
  fi
  control_places=$(lower "$_list")
  # The project's roots: the folder Copilot runs in, and the Lean project's own folder.
  roots=$cwd_real
  [ "$lean_root" = "$cwd_real" ] || roots=$roots$NL$lean_root
  roots=$(lower "$roots")
  places_ready=yes
}

# Whether the lower-case place is inside one of a list of lower-case places.
inside_any() {
  _ifs=$IFS
  IFS=$NL
  for _folder in $2; do
    if [ -n "$_folder" ] && inside "$_folder" "$1"; then IFS=$_ifs; return 0; fi
  done
  IFS=$_ifs
  return 1
}

# Whether any of a list of lower-case places is inside the lower-case place.
holds_any() {
  _ifs=$IFS
  IFS=$NL
  for _folder in $2; do
    if [ -n "$_folder" ] && inside "$1" "$_folder"; then IFS=$_ifs; return 0; fi
  done
  IFS=$_ifs
  return 1
}

# ---- The checks ----

# A read of a file, or the first half of any file check: .env files and the credential folders. Sets GIVEN and SPOT,
# the path as given and where it leads, both in lower case, and REAL, where it leads as spelt on disk.
check_read() {
  [ -n "$1" ] || deny_it "$SAY_COULD_NOT_RUN"
  ready_places
  full_path "$1"
  GIVEN=$(lower "$FULL")
  place "$FULL" || deny_it "$SAY_PLACE"
  REAL=$PLACED
  SPOT=$(lower "$PLACED")
  if is_env "$GIVEN" || is_env "$SPOT"; then deny_it "$SAY_ENV"; fi
  if inside_any "$SPOT" "$secret_places"; then deny_it "$SAY_SECRET"; fi
}

# A search: its folder, and the file pattern it is given, if any.
check_search() {
  if [ -n "$2" ]; then
    _ifs=$IFS
    IFS='/\{},'
    for _part in $(lower "$2"); do
      if is_env "$_part"; then IFS=$_ifs; deny_it "$SAY_ENV"; fi
    done
    IFS=$_ifs
  fi
  check_read "$1"
  if inside "$SPOT" "$home_real" || holds_any "$SPOT" "$secret_places"; then deny_it "$SAY_SEARCH"; fi
}

# A write: everything a read refuses, and the files that steer an agent, git's own files and the record's files.
check_write() {
  check_read "$1"
  if names_git "$GIVEN" || names_git "$SPOT"; then deny_it "$SAY_CONTROL"; fi
  if inside_any "$SPOT" "$control_places"; then deny_it "$SAY_CONTROL"; fi
  _ifs=$IFS
  IFS=$NL
  for _root in $roots; do
    case $SPOT in "$_root"/*) ;; *) continue ;; esac
    _below=${SPOT#"$_root"/}
    for _pattern in $CONTROL_PATTERNS; do
      case $_below in $_pattern) IFS=$_ifs; deny_it "$SAY_CONTROL" ;; esac
    done
    case $_below in
      "$RECORD_DIR"|"$RECORD_DIR"/*)
        if [ -e "$REAL" ] || [ -L "$REAL" ]; then IFS=$_ifs; deny_it "$SAY_RECORD"; fi
        ;;
    esac
  done
  IFS=$_ifs
}

# The paths a patch changes, one a line, in PATCH_PATHS; status 1 for a patch with none, an empty one, or a header line
# Wheelhouse doesn't know (the same reading as adapters/copilot/translate.js's patchPaths).
patch_paths() {
  PATCH_PATHS=
  while IFS= read -r _line || [ -n "$_line" ]; do
    _t=${_line#"${_line%%[![:space:]]*}"}
    case $_t in '*** '[A-Za-z]*) ;; *) continue ;; esac
    case $_t in
      '*** Add File:'*) _p=${_t#'*** Add File:'} ;;
      '*** Update File:'*) _p=${_t#'*** Update File:'} ;;
      '*** Delete File:'*) _p=${_t#'*** Delete File:'} ;;
      '*** Move to:'*) _p=${_t#'*** Move to:'} ;;
      *)
        _t=${_t%"$CR"}
        _t=${_t%"${_t##*[! ]}"}
        case $_t in '*** Begin Patch'|'*** End Patch'|'*** End of File') continue ;; esac
        return 1
        ;;
    esac
    _p=${_p#"${_p%%[! ]*}"}
    _p=${_p%"$CR"}
    _p=${_p%"${_p##*[! ]}"}
    [ -n "$_p" ] || return 1
    PATCH_PATHS=$PATCH_PATHS$_p$NL
  done <"$1"
  [ -n "$PATCH_PATHS" ]
}

# ---- The decision, made by the worker ----

decide() {
  input=$work/input
  /bin/cat >"$input" || deny_it "$SAY_COULD_NOT_RUN"
  # The parser is asked once whether it has the options the guard reads with (an older Mac's may not).
  printf '{"a":"b"}' >"$work/probe" || deny_it "$SAY_COULD_NOT_RUN"
  [ "$("$PLUTIL" -type a "$work/probe" 2>/dev/null)" = string ] || deny_it "$SAY_PLUTIL"
  [ "$("$PLUTIL" -extract a raw -o - "$work/probe" 2>/dev/null)" = b ] || deny_it "$SAY_PLUTIL"
  read_field cwd || deny_it "$SAY_COULD_NOT_RUN"
  cwd=$FIELD
  case $cwd in /*) ;; *) deny_it "$SAY_COULD_NOT_RUN" ;; esac
  [ -d "$cwd" ] || deny_it "$SAY_COULD_NOT_RUN"
  # The Lean project the folder is in: the nearest folder at or above it holding `.git` and the record folder. None,
  # and the guard lets everything through; a folder on the way it can't read is refused.
  place "$cwd" || deny_it "$SAY_COULD_NOT_RUN"
  cwd_real=$PLACED
  lean_root=
  _up=$cwd_real
  while :; do
    [ -x "$_up" ] || deny_it "$SAY_COULD_NOT_RUN"
    if { [ -e "$_up/.git" ] || [ -L "$_up/.git" ]; } && [ -d "$_up/$RECORD_DIR" ]; then lean_root=$_up; break; fi
    [ "$_up" = / ] && break
    _up=${_up%/*}
    [ -n "$_up" ] || _up=/
  done
  [ -n "$lean_root" ] || allow_it
  case ${HOME:-} in /*) ;; *) deny_it "$SAY_COULD_NOT_RUN" ;; esac
  read_field toolName || deny_it "$SAY_COULD_NOT_RUN"
  tool=$FIELD
  [ -n "$tool" ] || deny_it "$SAY_COULD_NOT_RUN"
  if in_list "$tool" "$UNSETTLED_TOOLS" || ! in_list "$tool" "$KNOWN_TOOLS"; then
    printf '%s' "$tool" >"$work/tool"
    deny_it unknown
  fi
  if in_list "$tool" "$SHELL_TOOLS"; then allow_it; fi
  if in_list "$tool" "$READ_TOOLS"; then
    read_field toolArgs.path || deny_it "$SAY_COULD_NOT_RUN"
    check_read "$FIELD"
    allow_it
  fi
  if in_list "$tool" "$GREP_TOOLS" || in_list "$tool" "$GLOB_TOOLS"; then
    read_field toolArgs.paths
    case $? in 0) _folder=$FIELD ;; 1) _folder=$cwd ;; *) deny_it "$SAY_COULD_NOT_RUN" ;; esac
    if in_list "$tool" "$GLOB_TOOLS"; then _key=toolArgs.pattern; else _key=toolArgs.glob; fi
    read_field "$_key"
    case $? in 0) _files=$FIELD ;; 1) _files= ;; *) deny_it "$SAY_COULD_NOT_RUN" ;; esac
    check_search "$_folder" "$_files"
    allow_it
  fi
  if in_list "$tool" "$WRITE_TOOLS"; then
    read_field toolArgs.path || deny_it "$SAY_COULD_NOT_RUN"
    check_write "$FIELD"
    allow_it
  fi
  if [ "$tool" = "$PATCH_TOOL" ]; then
    read_field toolArgs || deny_it "$SAY_COULD_NOT_RUN"
    "$PLUTIL" -extract toolArgs raw -o "$work/patch" "$input" 2>/dev/null || deny_it "$SAY_COULD_NOT_RUN"
    patch_paths "$work/patch" || deny_it "$SAY_COULD_NOT_RUN"
    _ifs=$IFS
    IFS=$NL
    for _each in $PATCH_PATHS; do
      IFS=$_ifs
      check_write "$_each"
      IFS=$NL
    done
    IFS=$_ifs
    allow_it
  fi
  allow_it
}

# ---- The main shell: the worker, its deadline, and the one answer Copilot reads ----

# Copilot's deny answer, as JSON, and exit 2.
refuse() {
  _reason=$(printf '%s' "$1" | /usr/bin/tr -d '\000-\037' | /usr/bin/sed 's/[\\"]/\\&/g')
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$_reason"
  exit 2
}

work=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/wheelhouse-guard.XXXXXX" 2>/dev/null) || refuse "$SAY_COULD_NOT_RUN"
cleanup() {
  [ -n "${worker:-}" ] && kill -TERM -- "-$worker" 2>/dev/null
  [ -n "${watch:-}" ] && kill -TERM -- "-$watch" 2>/dev/null
  /bin/rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 2' HUP INT TERM

# The worker and the deadline's watch each run in a process group of their own, so either can be ended with every
# program it started, where the shell allows it (with no terminal some shells don't; then each is ended by itself). The
# worker reads the hook's input from fd 3, a copy of this shell's own.
exec 3<&0
if (set -m) 2>/dev/null; then set -m 2>/dev/null; fi
( decide ) <&3 >/dev/null 2>&1 &
worker=$!
( /bin/sleep "$DEADLINE_SEC"; printf 'late' >"$work/late"; kill -TERM -- "-$worker" 2>/dev/null || kill -TERM "$worker" ) </dev/null >/dev/null 2>&1 &
watch=$!
set +m 2>/dev/null
exec 3<&-
wait "$worker" 2>/dev/null
kill -TERM -- "-$watch" 2>/dev/null
watch=
worker=

if [ -f "$work/late" ]; then refuse "$SAY_DEADLINE"; fi
answer=$(/bin/cat "$work/answer" 2>/dev/null)
if [ "$answer" = allow ]; then exit 0; fi
if [ "$answer" = deny ]; then
  reason=$(/bin/cat "$work/reason" 2>/dev/null)
  if [ "$reason" = unknown ]; then refuse "$SAY_UNKNOWN_BEFORE$(/bin/cat "$work/tool" 2>/dev/null)$SAY_UNKNOWN_AFTER"; fi
  [ -n "$reason" ] && refuse "$reason"
fi
refuse "$SAY_COULD_NOT_RUN"
