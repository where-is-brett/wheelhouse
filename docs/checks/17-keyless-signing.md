<!-- docs/checks/17-keyless-signing.md -->

# Check 17: keyless signing of releases

**Answer:** Deferred — to the release plan, because trying it now would publish facts about a private repository.

## Question

Keyless signing of release tags in CI, and how a director or contributor can check one.

## Tested on

Documentation only, read on 17 October 2026: https://github.com/sigstore/gitsign, https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md, https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations.

## Method

Read how `gitsign` and GitHub's artifact attestations work, and what each makes public.

## Evidence

- `gitsign` signs a tag with a short-lived certificate from Sigstore, using the CI run's own identity, so no key is kept anywhere.
- The public transparency log records the certificate, which "may include user emails or repo identifiers". For CI, the certificate names the repository, the workflow and the run.
- Checking a tag: `gitsign verify --certificate-identity=… --certificate-oidc-issuer=… <tag>`.
- GitHub's artifact attestations, on GitHub Free, "are only available for public repositories".

## What it means for the design

- Section 16 stands. Signing starts once the repository is public, when naming it in a public log costs nothing.
- The release plan chooses between `gitsign` for tags and attestations for release files, or uses both.

## Needs the director

No.
