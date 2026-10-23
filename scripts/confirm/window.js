// scripts/confirm/window.js
// The helper's own window (design section 6.3, ruling P5-23): a small window of the operating system's own kind,
// showing a card's words and its deciding options beside Not now, for the steps that matter most. Only a person
// can click it; the helper, not the agent, then signs the record.
//
// The card's words never become part of a script. On macOS `osascript` runs a constant script that reads the
// title, the words, the time limit and the options from its arguments (`on run argv`): one deciding option is a
// `display dialog` with two buttons, several are a `choose from list` whose cancel button is Not now. On Windows
// `powershell.exe` runs a constant script, given as `-EncodedCommand`, that reads the card from base64 in an
// environment variable and shows a WinForms dialog with one button per option; it writes back the number of the
// button pressed, so nothing the card says has to come back through the console. Return never decides: Not now
// is the default button on macOS and has the focus on Windows. Anywhere else there is no window.
import path from 'node:path';

// The option that decides nothing. A card's own Not now (scripts/lib/front-desk.js's PUT_OFF) says the same.
export const NOT_NOW = 'Not now';
// How long the window waits for a click before it closes, choosing nothing.
export const WINDOW_MS = 5 * 60 * 1000;
// How much longer than the window's own time limit the program is given before it is ended.
const GRACE_MS = 5000;
// macOS's own osascript, never one found first on the PATH: a program planted there could print a deciding
// option with no click at all.
export const MAC_OSASCRIPT = '/usr/bin/osascript';
// The environment variable that carries the card to the Windows script.
export const CARD_VARIABLE = 'WHEELHOUSE_WINDOW';

// macOS: item 1 the title, item 2 the words, item 3 the seconds to wait, then the deciding options. `choose from
// list` has no give-up of its own: `run` ends osascript a little after the wait, and that is no choice.
export const MAC_SCRIPT = [
  'on run argv',
  'set theTitle to item 1 of argv',
  'set theText to item 2 of argv',
  'set theWait to (item 3 of argv) as integer',
  'set theOptions to items 4 thru -1 of argv',
  'if (count of theOptions) is 1 then',
  `set theReply to display dialog theText with title theTitle buttons {"${NOT_NOW}", item 1 of theOptions} default button 1 giving up after theWait`,
  'if gave up of theReply then return ""',
  'return button returned of theReply',
  'end if',
  `set theChoice to choose from list theOptions with title theTitle with prompt theText OK button name "Choose" cancel button name "${NOT_NOW}"`,
  `if theChoice is false then return "${NOT_NOW}"`,
  'return item 1 of theChoice',
  'end run',
];

// Windows: the card is { title, lines, options, waitMs } as UTF-8 JSON in base64; `options` ends with Not now.
// Writes the number of the button pressed, or -1 when the window closed without one.
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  `$card = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:${CARD_VARIABLE})) | ConvertFrom-Json`,
  '$form = New-Object System.Windows.Forms.Form',
  '$form.Text = [string]$card.title',
  '$form.TopMost = $true',
  "$form.FormBorderStyle = 'FixedDialog'",
  '$form.MaximizeBox = $false',
  '$form.MinimizeBox = $false',
  "$form.StartPosition = 'CenterScreen'",
  '$form.AutoSize = $true',
  "$form.AutoSizeMode = 'GrowAndShrink'",
  '$panel = New-Object System.Windows.Forms.FlowLayoutPanel',
  "$panel.FlowDirection = 'TopDown'",
  '$panel.AutoSize = $true',
  '$panel.Padding = New-Object System.Windows.Forms.Padding(12)',
  '$label = New-Object System.Windows.Forms.Label',
  '$label.UseMnemonic = $false',
  '$label.AutoSize = $true',
  '$label.MaximumSize = New-Object System.Drawing.Size(480, 0)',
  '$label.Text = (@($card.lines) -join [Environment]::NewLine)',
  '$panel.Controls.Add($label)',
  '$row = New-Object System.Windows.Forms.FlowLayoutPanel',
  '$row.AutoSize = $true',
  '$script:choice = -1',
  '$options = @($card.options)',
  '$last = $null',
  'for ($i = 0; $i -lt $options.Count; $i++) {',
  '  $button = New-Object System.Windows.Forms.Button',
  '  $button.UseMnemonic = $false',
  '  $button.AutoSize = $true',
  '  $button.Text = [string]$options[$i]',
  '  $button.Tag = $i',
  '  $button.Add_Click({ param($s, $e) $script:choice = [int]$s.Tag; $form.Close() })',
  '  $row.Controls.Add($button)',
  '  $last = $button',
  '}',
  '$panel.Controls.Add($row)',
  '$form.Controls.Add($panel)',
  '$form.ActiveControl = $last',
  '$timer = New-Object System.Windows.Forms.Timer',
  '$timer.Interval = [int]$card.waitMs',
  '$timer.Add_Tick({ $timer.Stop(); $form.Close() })',
  '$timer.Start()',
  '[void]$form.ShowDialog()',
  '[Console]::Out.Write([string]$script:choice)',
].join('\r\n');
const WINDOWS_ENCODED = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');

// Windows PowerShell from the system's own folder, never one found first on the PATH.
export const windowsShell = (systemRoot) => path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const isText = (x) => typeof x === 'string' && x !== '';

function checkCard({ title, lines, options, timeoutMs }) {
  if (!isText(title)) throw new Error('The window needs a title');
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => typeof l === 'string')) throw new Error('The window needs the card\'s lines');
  if (!Array.isArray(options) || options.length === 0 || !options.every(isText) || new Set(options).size !== options.length || options.includes(NOT_NOW)) {
    throw new Error('The window needs the deciding options, each once, without Not now');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('The window needs a time limit of a second or more');
}

// Shows the window and waits for a click: { choice } is the deciding option clicked, Not now, or null when the
// window timed out, failed, or can't be shown here. `options` are the deciding options alone; Not now is added.
export async function askInWindow({ title, lines, options, platform = process.platform, timeoutMs = WINDOW_MS, run, env = process.env }) {
  checkCard({ title, lines, options, timeoutMs });
  if (typeof run !== 'function') throw new Error('The window needs a run function');
  const known = [...options, NOT_NOW];
  let answer;
  try {
    if (platform === 'darwin') {
      const seconds = String(Math.ceil(timeoutMs / 1000));
      const script = MAC_SCRIPT.flatMap((line) => ['-e', line]);
      answer = await run(MAC_OSASCRIPT, [...script, '--', title, lines.join('\n'), seconds, ...options], { timeoutMs: timeoutMs + GRACE_MS });
      if (answer.code !== 0 || answer.timedOut) return { choice: null };
      const said = String(answer.stdout).replace(/\r?\n$/, '');
      return { choice: known.includes(said) ? said : null };
    }
    if (platform === 'win32') {
      const card = Buffer.from(JSON.stringify({ title, lines, options: known, waitMs: timeoutMs }), 'utf8').toString('base64');
      answer = await run(windowsShell(env.SystemRoot ?? env.SYSTEMROOT), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', WINDOWS_ENCODED], {
        env: { [CARD_VARIABLE]: card }, timeoutMs: timeoutMs + GRACE_MS,
      });
      if (answer.code !== 0 || answer.timedOut) return { choice: null };
      const said = String(answer.stdout).trim();
      if (!/^-?[0-9]+$/.test(said)) return { choice: null };
      const n = Number(said);
      return { choice: n >= 0 && n < known.length ? known[n] : null };
    }
  } catch {
    return { choice: null };
  }
  return { choice: null };
}
