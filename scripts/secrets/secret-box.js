// scripts/secrets/secret-box.js
// Asks the director for a secret in the operating system's own hidden-entry
// dialog, and keeps it in the computer's keychain (macOS), Credential Manager
// (Windows) or, on Linux, the credential helper of the computer's git. A secret
// never travels in a process's arguments.
import { spawn } from 'node:child_process';

const NAME = /^[A-Za-z0-9._-]+$/;

function checkPlatform(platform) {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('The secret box works on macOS and Windows only');
  }
}

// Storing, reading and deleting also work on Linux, through the helper of the
// computer's git; asking does not, as there is no dialog to rely on.
function checkStorePlatform(platform) {
  if (platform !== 'linux') checkPlatform(platform);
}

// The entry the helper keeps for a secret. Its protocol is Wheelhouse's own, so
// it can never match one of the director's sign-ins.
function gitEntry({ service, account }, secret) {
  const password = secret === undefined ? '' : `password=${secret}\n`;
  return `protocol=wheelhouse\nhost=${service}\nusername=${account}\n${password}\n`;
}

function gitCredential(verb) {
  return { file: 'git', args: ['credential', verb] };
}

function checkNames({ service, account }) {
  if (!NAME.test(service) || !NAME.test(account)) {
    throw new Error('Service and account names may use letters, digits, dots, dashes and underscores only');
  }
}

function base64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function powershell(script) {
  return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
}

const VAULT = '[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]; $vault = New-Object Windows.Security.Credentials.PasswordVault;';

export function askSecretCommand(platform, { title, prompt }) {
  checkPlatform(platform);
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e', 'on run argv',
        '-e', 'set answer to display dialog (item 1 of argv) with title (item 2 of argv) default answer "" with hidden answer',
        '-e', 'return text returned of answer',
        '-e', 'end run',
        '--', prompt, title,
      ],
    };
  }
  const decode = (text) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(text)}'))`;
  return powershell([
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$form = New-Object Windows.Forms.Form; $form.Width = 420; $form.Height = 170; $form.StartPosition = "CenterScreen"; $form.TopMost = $true;',
    `$form.Text = ${decode(title)};`,
    `$label = New-Object Windows.Forms.Label; $label.Text = ${decode(prompt)}; $label.Left = 12; $label.Top = 12; $label.Width = 380;`,
    '$box = New-Object Windows.Forms.TextBox; $box.UseSystemPasswordChar = $true; $box.Left = 12; $box.Top = 40; $box.Width = 380;',
    '$ok = New-Object Windows.Forms.Button; $ok.Text = "OK"; $ok.Left = 236; $ok.Top = 80; $ok.DialogResult = "OK"; $form.AcceptButton = $ok;',
    '$cancel = New-Object Windows.Forms.Button; $cancel.Text = "Cancel"; $cancel.Left = 317; $cancel.Top = 80; $cancel.DialogResult = "Cancel"; $form.CancelButton = $cancel;',
    '$form.Controls.AddRange(@($label, $box, $ok, $cancel));',
    'if ($form.ShowDialog() -eq "OK") { [Console]::Out.Write($box.Text) } else { exit 1 }',
  ].join(' '));
}

export function storeSecretCommand(platform, where) {
  checkStorePlatform(platform);
  checkNames(where);
  if (platform === 'linux') return { ...gitCredential('approve'), stdin: true };
  if (platform === 'darwin') return { file: 'security', args: ['-i'], stdin: true };
  const { service, account } = where;
  return {
    ...powershell(`${VAULT} $secret = [Console]::In.ReadToEnd().Trim(); $vault.Add((New-Object Windows.Security.Credentials.PasswordCredential('${service}', '${account}', $secret)))`),
    stdin: true,
  };
}

export function storeSecretInput(platform, { service, account }, secret) {
  checkStorePlatform(platform);
  if (platform === 'linux') {
    if (/[\r\n]/.test(secret)) throw new Error('A secret kept through git may not span lines');
    return gitEntry({ service, account }, secret);
  }
  if (platform === 'darwin') {
    const quoted = `"${secret.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    return `add-generic-password -U -s ${service} -a ${account} -w ${quoted}\n`;
  }
  return secret;
}

// What goes on standard input for a read or a delete (nothing except on Linux).
export function readSecretInput(platform, where) {
  return platform === 'linux' ? gitEntry(where) : '';
}

export function readSecretCommand(platform, where) {
  checkStorePlatform(platform);
  checkNames(where);
  if (platform === 'linux') return gitCredential('fill');
  const { service, account } = where;
  if (platform === 'darwin') return { file: 'security', args: ['find-generic-password', '-s', service, '-a', account, '-w'] };
  return powershell(`${VAULT} try { $c = $vault.Retrieve('${service}', '${account}'); $c.RetrievePassword(); [Console]::Out.Write($c.Password) } catch { exit 1 }`);
}

// Git has no other way to drop an entry. It is only ever sent an entry of the
// protocol `wheelhouse`, which is Wheelhouse's own and never the director's.
export function deleteSecretCommand(platform, where) {
  checkStorePlatform(platform);
  checkNames(where);
  if (platform === 'linux') return gitCredential('reject');
  const { service, account } = where;
  if (platform === 'darwin') return { file: 'security', args: ['delete-generic-password', '-s', service, '-a', account] };
  return powershell(`${VAULT} try { $vault.Remove($vault.Retrieve('${service}', '${account}')) } catch { exit 1 }`);
}

// The box's PowerShell must not start hidden: Windows applies a hidden start
// to the first window the process shows, which is the box itself.
function run({ file, args }, input, { hide = true } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: hide, env });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

export async function askSecret(box, platform = process.platform) {
  const { code, out } = await run(askSecretCommand(platform, box), '', { hide: false });
  if (code !== 0) throw new Error('Cancelled');
  return out.trim();
}

// `runner` is a seam for tests: ({ file, args }, stdin) -> { code, out }.
export async function storeSecret({ service, account, secret }, platform = process.platform, runner = run) {
  const where = { service, account };
  let result;
  try {
    result = await runner(storeSecretCommand(platform, where), storeSecretInput(platform, where, secret));
  } catch {
    throw new Error('The secret could not be stored');
  }
  if (result.code !== 0) throw new Error('The secret could not be stored');
}

// The secret, or null when there is none or the computer cannot give it.
export async function readSecret(where, platform = process.platform, runner = run) {
  let result;
  try {
    result = await runner(readSecretCommand(platform, where), readSecretInput(platform, where));
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  if (platform !== 'linux') return result.out.replace(/\r?\n$/, '');
  const line = result.out.split(/\r?\n/).find((entry) => entry.startsWith('password='));
  return line === undefined ? null : line.slice('password='.length);
}

export async function deleteSecret(where, platform = process.platform, runner = run) {
  try {
    await runner(deleteSecretCommand(platform, where), readSecretInput(platform, where));
  } catch {
    // Nothing to delete, or nothing to delete it with.
  }
}
