<!-- docs/checks/23-gitlab-protection.md -->

# Check 23: GitLab's protection of `main`

**Answer:** Partly — setup read the protection, switched it on from the director's sign-in on GitLab.com Free (push "No one", merge Developers + Maintainers, "pipelines must succeed" on) and read it back, and a Developer key was refused both a direct push and an unprotect; but a Developer key merging under these rules, and anything about a Maintainer key, were not tried.

## Question

**GitLab's protection of `main`:** that setup can read whether it is on, and switch it on where the director's role allows.

## Tested on

The documentation table was read on 18 October 2026 at docs.gitlab.com (linked in it). The live trial ran the same day, as the second half of check 22's, on macOS 27.0.1 with Node 22.22.1 and `glab` 1.123.0, against GitLab.com Free: a private test project in the director's personal namespace. The protection was switched on with the director's sign-in; the project key from check 22 (Developer level) then tried a direct push and an unprotect, and was revoked. The protection was left on. No Windows computer was involved.

## Method

`readGitlabProtection` and `protectGitlabBranch` were written to what the pages say and tested with a fake `api`. The live trial is `probes/22-gitlab/run.js <group/project> --scratch --yes`, the same run as check 22: read the protection, switch it on, read it back, try a direct push and an unprotect with the project key, then check the protection is still on.

## Evidence

From the documentation:

| Question | What the documentation says | Source |
|---|---|---|
| Is protection on every plan? | The protected branches page lists Free, Premium and Ultimate. Group-level protection, protection by user or group, and Code Owner approval need Premium or Ultimate. | [Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/) |
| Who can read and change it? | Maintainers and Owners manage protected branches. Developers may create one only through the Branches API, and only if it requires merge requests. | [Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/), [Roles and permissions](https://docs.gitlab.com/user/permissions/) |
| The API | `GET /projects/:id/protected_branches/:name` (404 if not protected), `POST /projects/:id/protected_branches`, `DELETE ...`, `PATCH ...`. Free plans set access by role with `push_access_level` and `merge_access_level` (0 no access, 30 Developer, 40 Maintainer, 60 Administrator on self-managed only) and `allow_force_push`. Setting access by user or group, and `PATCH`ing the lists, are Premium and Ultimate. The reply lists `push_access_levels` and `merge_access_levels` with an `access_level_description` such as "Maintainers". | [Protected branches API](https://docs.gitlab.com/api/protected_branches/) |
| What GitLab does by default | The default branch is protected by default, as "Fully protected": "Developers cannot push new commits, but maintainers can." Nobody can force-push. So a new project's `main` is not closed to a Maintainer. | [Default branch](https://docs.gitlab.com/user/project/repository/branches/default/) |
| Does "No one" stop a Maintainer? | The UI's "No one" prevents direct pushes, and the API's 0 is "No access". No page says outright that a Maintainer, an Owner or a Maintainer's token is refused, and none mentions a bypass. So this is expected, not shown. | [Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/), [Protected branches API](https://docs.gitlab.com/api/protected_branches/) |
| Can a Maintainer switch it off? | Yes by default: "users with the Maintainer or Owner role can unprotect protected branches", and Maintainers and Owners can delete protected branches through the UI or API. Restricting who can unprotect needs Premium or Ultimate, and is done through the API only. `unprotect_access_level` takes 0 as invalid. | [Protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/), [Protected branches API](https://docs.gitlab.com/api/protected_branches/) |
| "Pipelines must succeed" | `only_allow_merge_if_pipeline_succeeds`, a boolean on `PUT /projects/:id`, with no tier note on the API page; the merge-checks page lists Free, Premium and Ultimate, and Maintainer or Owner to change it. It "also prevents merge requests from merging if there is no pipeline", and "a merge request with no pipelines at all is not considered to have a successful pipeline, and cannot merge". Skipped pipelines count as failed unless "Skipped pipelines are considered successful" is also on. | [Projects API](https://docs.gitlab.com/api/projects/), [Auto-merge and required pipelines](https://docs.gitlab.com/user/project/merge_requests/auto_merge/) |

From the live trial, 18 October 2026:

| Trial | Expected | Result |
|---|---|---|
| Read the default branch's protection before any change | A reading | Protected; push Maintainers, merge Maintainers, no force-push, pipelines must succeed off. This matches GitLab's documented default |
| Switch it on with the director's sign-in | Done | Done; read back as push No one, merge Developers + Maintainers, no force-push, pipelines must succeed on |
| Push directly to the default branch with the Developer key | Refused | Refused: "You are not allowed to push code to protected branches on this project." |
| Unprotect the default branch with the Developer key | Refused | Refused: HTTP 403 |
| Put the protection back, then check it is left on | Push access: No one | Already on |

What the documentation left open, item by item:

1. **A key refused a push to a branch protected to "no one".** Shown for a Developer key. The Maintainer half is not tried.
2. **A Developer key cannot unprotect; a Maintainer key can.** The Developer half is shown (HTTP 403). The Maintainer half is not tried, so it is still the documentation's word.
3. **`unprotect_access_level` on free self-managed.** Not tried; the trial ran on GitLab.com only.
4. **The pipeline rule on GitLab.com Free.** Shown: setting it on worked and read back as on.

Not tried: a Developer key merging a merge request (the one merge request was closed); a Maintainer-level key; self-managed GitLab.

The scratch project is left with "pipelines must succeed" on and no pipeline, so its merge requests cannot merge. That is expected for a scratch project, and is the point made below.

## What it means for the design

- **Section 11, "On GitLab it protects `main` on every plan, which carries much of the load":** true for the setting. Add that GitLab's default lets Maintainers push, so setup must change it to "no one", and that `protectGitlabBranch` does (push 0, merge Developers + Maintainers, no force-push). It reads the answer back with `readGitlabProtection` and shows the director what it found.
- **Sections 11 and 12.3, a limit the design does not state:** a Maintainer-level project key could unprotect `main` and then push to it. The key is therefore made at Developer level (check 22), with merge allowed to Developers, so it can merge but, by the documentation, cannot change the protection. If a Maintainer key is ever used, protection on GitLab stops a mistake or a skipped hook but not a determined holder of the key; on Premium and Ultimate setup should then also restrict who can unprotect to the director (the API takes this as a list of users or groups). The trial showed the Developer key refused both a push and an unprotect; a Developer key merging, and the Maintainer behaviour, are untried.
- **"Pipelines must succeed" needs a pipeline.** Turning it on in a project with no CI makes every merge request unmergeable, the helper's included. Setup should switch it on only where the project already has a pipeline, or ask the director first; `protectGitlabBranch` takes `pipelinesMustSucceed: false` to leave it alone. Section 12.3's merge gate must say what it does when GitLab has no pipeline to read.
- **Setting changes by the key itself.** A Maintainer-level key could also switch the pipeline rule off (`api` covers project settings; a Developer's may not, as editing settings is for Maintainers and Owners), so the gate's own check of CI status (section 12.3) stays the real rule and GitLab's setting is a second lock.
- **Section 20, check 23:** Partly: the protection works as designed on GitLab.com Free, but a Developer key merging under it is untried.

## Needs the director

Not now. The trial is done, in the same run as check 22. Only a Developer key merging a merge request remains, and it can be tried in the pilot, on a project with a pipeline, without a card now.
