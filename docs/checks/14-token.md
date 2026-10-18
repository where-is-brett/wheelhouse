<!-- docs/checks/14-token.md -->

# Check 14: the agents' token

**Answer:** Deferred — to the setup plan, which creates this token for real; the page and its limits are documented.

## Question

That the host's new-token page can be opened with the choices filled in; that the token can merge but not change settings; and how long it can live.

## Tested on

GitHub's documentation, https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens, read on 17 October 2026; `scripts/host/token-url.js` and its tests.

## Method

Read how GitHub's new-token page takes its fields from the link, and built `tokenUrl` to match. The live trial, in which the director creates a throwaway token and the probe tries what it can and can't do, was set aside by the director's choice. The setup plan creates this exact token, so it is tested there once, for real.

## Evidence

- The page at `github.com/settings/personal-access-tokens/new` takes `name` (up to 40 characters), `description`, `target_name` (the owner), `expires_in` and one field per permission (`contents`, `pull_requests`, `issues`: read or write; `metadata`: read).
- Repositories can't be chosen by link: the director picks the project and the profile on the page.
- `expires_in` takes 1 to 366 days, or `none`. A token without expiry is allowed unless an organisation's policy forbids it.
- On GitLab, fine-grained personal tokens limited to chosen projects are on the free tier from GitLab 19.2. Project access tokens need a paid plan.

## What it means for the design

- Section 15, step 3 gains one action: picking the two repositories on GitHub's page.
- Section 11: the token is made for 366 days, the longest GitHub offers short of no expiry, with the renewal card 14 days ahead, as the design says.
- `tokenUrl` for GitLab should open the fine-grained token page rather than ask for the broad `api` scope. The setup plan does this.

## Needs the director

No.
