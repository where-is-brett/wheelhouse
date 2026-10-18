// scripts/secrets/secret-box.js
// Asks the director for a secret in the operating system's own hidden-entry
// dialog, and keeps it in the computer's keychain (macOS) or Credential
// Manager (Windows). A secret never travels in a process's arguments.
import { spawn } from 'node:child_process';

const NAME = /^[A-Za-z0-9._-]+$/;

function checkPlatform(platform) {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('The secret box works on macOS and Windows only');
  }
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
  checkPlatform(platform);
  checkNames(where);
  if (platform === 'darwin') return { file: 'security', args: ['-i'], stdin: true };
  const { service, account } = where;
  return {
    ...powershell(`${VAULT} $secret = [Console]::In.ReadToEnd().Trim(); $vault.Add((New-Object Windows.Security.Credentials.PasswordCredential('${service}', '${account}', $secret)))`),
    stdin: true,
  };
}

export function storeSecretInput(platform, { service, account }, secret) {
  checkPlatform(platform);
  if (platform === 'darwin') {
    const quoted = `"${secret.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    return `add-generic-password -U -s ${service} -a ${account} -w ${quoted}\n`;
  }
  return secret;
}

export function readSecretCommand(platform, where) {
  checkPlatform(platform);
  checkNames(where);
  const { service, account } = where;
  if (platform === 'darwin') return { file: 'security', args: ['find-generic-password', '-s', service, '-a', account, '-w'] };
  return powershell(`${VAULT} try { $c = $vault.Retrieve('${service}', '${account}'); $c.RetrievePassword(); [Console]::Out.Write($c.Password) } catch { exit 1 }`);
}

export function deleteSecretCommand(platform, where) {
  checkPlatform(platform);
  checkNames(where);
  const { service, account } = where;
  if (platform === 'darwin') return { file: 'security', args: ['delete-generic-password', '-s', service, '-a', account] };
  return powershell(`${VAULT} try { $vault.Remove($vault.Retrieve('${service}', '${account}')) } catch { exit 1 }`);
}

// The box's PowerShell must not start hidden: Windows applies a hidden start
// to the first window the process shows, which is the box itself.
function run({ file, args }, input, { hide = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: hide });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(input ?? '');
  });
}

export async function askSecret(box, platform = process.platform) {
  const { code, out } = await run(askSecretCommand(platform, box), '', { hide: false });
  if (code !== 0) throw new Error('Cancelled');
  return out.trim();
}

export async function storeSecret({ service, account, secret }, platform = process.platform) {
  const where = { service, account };
  const { code } = await run(storeSecretCommand(platform, where), storeSecretInput(platform, where, secret));
  if (code !== 0) throw new Error('The secret could not be stored');
}

export async function readSecret(where, platform = process.platform) {
  const { code, out } = await run(readSecretCommand(platform, where));
  return code === 0 ? out.replace(/\r?\n$/, '') : null;
}

export async function deleteSecret(where, platform = process.platform) {
  await run(deleteSecretCommand(platform, where));
}
