<!-- docs/checks/20-github-app.md -->

# Check 20: The Wheelhouse GitHub App

**Answer:** Yes, with one change — the code sign-in and the Install page took the director under 4 minutes, and renewing a key needs no client secret, but the helper cannot add a later project to the installation: the director ticks it on the app's page, or installs the app on all repositories.

## Question

The code sign-in and the Install page, timed on a fresh account; whether renewing an access key needs the app's client secret; and whether the helper can add a later project's repository to the installation with the director's sign-in.

## Tested on

18 October 2026, on macOS 27.0.1 with Node 22.22.1 and `gh` 2.97.0, against GitHub.com. A private test app (Contents, Pull requests and Issues read and write, Metadata read, device flow on, no webhook) and two empty private test repositories, `wheelhouse-check-20-a` and `-b`, made on the director's account for this check. The app was installed on `-a` only. All three were deleted afterwards, and `gh api` answered 404 for each.

## Method

`probes/20-github-app/register.js` printed GitHub's "Register new GitHub App" link with the name and permissions filled in. The director opened it, ticked **Enable Device Flow**, clicked **Create**, made the two repositories and installed the app on `-a`. `probes/20-github-app/run.js` then ran the code sign-in (`startDeviceSignIn`, `waitForSignIn` in `scripts/host/github-app.js`); the director typed the code and clicked **Authorise**. With the keys held in memory only, it ran each trial below and printed one line each. `gh`'s own key was read with `gh auth token` and never printed. The client secret was typed into the system's hidden-entry box.

## Evidence

| Trial | Expected | Result | Time |
|---|---|---|---|
| The director's part, from the register link to the end of the install | Under 15 minutes | Under 4 minutes | — |
| Installations the app's key can see | One, with `-a` only | One, with `-a` only | 662 ms |
| Push a branch to `-a` with the app's key | Works | Branch created | 2865 ms |
| Open a pull request on `-a` | Works | Opened | 1643 ms |
| Close it | Works | Closed | 937 ms |
| Add `-b` to the installation (`PUT /user/installations/{id}/repositories/{repo_id}`) with the app's key | Unknown | Refused: HTTP 403, "You do not have permission to modify this app" | — |
| The same with `gh`'s key (scope `repo`) | Unknown | Refused: HTTP 403, the same message | — |
| Change `-a`'s description (`PATCH /repos/{owner}/{repo}`) with the app's key | Refused | Refused: HTTP 403, "Resource not accessible by integration" | — |
| Renew the access key without the client secret (`renewKeys`) | Unknown | Renewed, an 8-hour key | — |
| Renew with the client secret | Works | Renewed | 35 s, including typing into the box |

## What it means for the design

- **Section 11, "Narrow on GitHub": a later project is not added by the helper.** Neither the app's key nor the director's `gh` sign-in may add a repository to the installation. Replace "A later project is added to the installation by the helper, so nothing is pasted, ever" with the choice made at setup: either the director installs the app on **All repositories**, so later projects need nothing (the key can then reach every repository's code, pull requests and issues, though still no settings), or on chosen repositories, and each new project opens the app's settings page for one tick. This is a card for the director (Task 4).
- **No secret ships in the plugin.** Renewing works with the client ID alone, so the plugin carries only the app's client ID, which is public.
- **Settings are out of reach.** The app's key was refused a settings change, as the design's table says.
- **Setup time.** Under 4 minutes covered registering the app and making two repositories as well as the code, **Authorise** and the Install page, so section 15, step 3's 1 to 3 minutes for Narrow is reasonable once the app exists.
- **Section 20, check 20:** Yes, with the change above.

## Needs the director

Yes, once, for the card on how later projects join the installation (Task 4).
