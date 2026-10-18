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

export function credentialPaths(platform = process.platform) {
  return platform === 'win32' ? [...CREDENTIALS, ...WINDOWS_ONLY] : [...CREDENTIALS];
}
