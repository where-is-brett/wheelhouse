// scripts/sources/list.js
// The sources Wheelhouse reads once a week: four pages of Anthropic's documentation, and the
// releases and security advisories of each upstream repository in the lineage manifest.
// This file imports nothing, so the settings catalogue can take its default from here.

// The four pages, each at the address it answered at when read on 19 October 2026. Older
// docs.claude.com addresses redirect to another host, which a check refuses, so these are
// the final ones.
export const DEFAULT_SOURCES = [
  // read 19 October 2026
  { id: 'models', url: 'https://platform.claude.com/docs/en/models/overview', kind: 'page' },
  { id: 'deprecations', url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations', kind: 'page' },
  { id: 'changelog', url: 'https://code.claude.com/docs/en/changelog', kind: 'page' },
  { id: 'prompting', url: 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices', kind: 'page' },
];

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// The release and advisory lists of each upstream in the manifest (`upstreams[].repo`, as
// `owner/name`), asked of GitHub's public API without a key. Anything else in the manifest
// is left out, and no manifest gives no sources.
export function upstreamSources(manifest) {
  const upstreams = Array.isArray(manifest?.upstreams) ? manifest.upstreams : [];
  const repos = [];
  for (const upstream of upstreams) {
    const repo = upstream?.repo;
    if (typeof repo === 'string' && REPO.test(repo) && !repos.includes(repo)) repos.push(repo);
  }
  return repos.flatMap((repo) => [
    { id: `releases:${repo}`, url: `https://api.github.com/repos/${repo}/releases?per_page=10`, kind: 'releases' },
    { id: `advisories:${repo}`, url: `https://api.github.com/repos/${repo}/security-advisories?per_page=10`, kind: 'advisories' },
  ]);
}
