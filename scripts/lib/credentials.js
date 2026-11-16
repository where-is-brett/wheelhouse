// scripts/lib/credentials.js
// The files and folders in the home folder that hold credentials. Paths are
// relative to the home folder and use forward slashes. CREDENTIALS is the list
// common to every system; credentialPaths(platform) adds what one system has.
export const CREDENTIALS = [
  '.ssh', '.config/gh', '.config/glab-cli', '.npmrc', '.netrc', '.aws', '.config/gcloud', '.azure', '.docker/config.json', '.kube',
  '.git-credentials', '.config/git/credentials', '.claude/.credentials.json',
  // The spend and deployment tools' own stores.
  '.config/stripe', '.fly', '.wrangler', '.supabase', '.railway', '.config/neonctl', '.netlify', '.vercel',
];

const WINDOWS_ONLY = ['AppData/Roaming/GitHub CLI', 'AppData/Roaming/glab-cli', 'AppData/Local/glab-cli'];

// glab keeps its settings, and its token when the keyring is off, here on a Mac. gh keeps to ~/.config/gh there.
const MAC_ONLY = ['Library/Application Support/glab-cli'];

export function credentialPaths(platform = process.platform) {
  if (platform === 'win32') return [...CREDENTIALS, ...WINDOWS_ONLY];
  return platform === 'darwin' ? [...CREDENTIALS, ...MAC_ONLY] : [...CREDENTIALS];
}
