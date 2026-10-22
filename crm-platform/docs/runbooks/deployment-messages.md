# Deployment messages (Google Chat "Deployments" space)

Every deployment message shows the PR number(s), the commit, the author and who deployed. Built by `deploy/hostinger/deploy-message.py`, used by the production release watcher (`deploy/hostinger/desk-release-watch.sh`, systemd `desk-release-watch.service`) and by `deploy/build-server/notify-chat.sh` (started, succeeded, failed, skipped).

## The standard

One plain-text message per event, at most 1200 characters.

| Field | Meaning |
|---|---|
| Title | status emoji + event: 🚀 Deploy in progress, ✅ Release live, ⚠️ did not go live (unchanged, failed, skipped) |
| Version | short sha (9 chars) `(was <previous>)` + commit URL. In progress and unchanged: attempted version = `IMAGE_TAG` in `/opt/desk/.env`, previous = live slot tag |
| PR | `#N "title"` + PR URL (newest PR in the release) |
| Author | `@login` of the PR author |
| Deployed by | `@login` of whoever merged the PR (or pushed the commit) |
| Also in this release | up to 8 more PRs (`#N`, title, `@author`) when several merges shipped together |
| Footer | duration (when known) and UTC time |

Direct push to main (no PR): the commit subject, `PR: none (direct push)`, author and deployer are the pusher.
If GitHub cannot be reached (no token, 5xx, timeout, bad token) the message is the plain Version + commit link with `PR details unavailable`. Posting is never delayed by more than the 6 s per-call timeout (25 s overall) and never fails the release.

### Who is "responsible" and why
The merger. Merging to `main` is what triggers the automatic deploy, so the person who clicked merge decided to ship it. The author is shown separately because they often differ.

### Examples
```
🚀 *Deploy in progress*
Version: `a1b2c3d4e` (was `7f138c5c2`) https://github.com/lakshyatyagi241/threadwise/commit/a1b2c3d4e
PR: #879 "Add export button" https://github.com/lakshyatyagi241/threadwise/pull/879
Author: @ravi
Deployed by: @lakshyatyagi241
Also in this release:
• #871 "Fix inbox unread count" @asha
2026-10-22 10:32 UTC
```
`✅ *Release live*` has the same body plus `Took 212s · <time>`. `⚠️ *Deploy finished but the live version did not change*` is the same with `Took 95s` and a note that it was rolled back or refused. Direct push:
```
✅ *Release live*
Version: `c0ffee123` (was `a1b2c3d4e`) https://github.com/lakshyatyagi241/threadwise/commit/c0ffee123
Commit: "hotfix: bump timeout"
PR: none (direct push)
Author: @dave
Deployed by: @dave
```

### Safety
All GitHub text is untrusted: control characters and markdown/mention characters (`* _ ~ ` [ ] < > @ | \`) are removed, titles cut to 100 chars, logins must match `[A-Za-z0-9-]` (else `unknown`). The token is read from env or file by the formatter and sent as an HTTP header (never an argument, so not in `ps`), never printed or logged. Lookups are cached per request for 1 hour in `/var/lib/desk-release-watch/`.

## Create the GitHub token (read-only)
1. Sign in to GitHub as `lakshyatyagi241` (or an owner), open **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Token name `desk-release-watch`; **Resource owner** `lakshyatyagi241`; **Expiration** 90 days.
3. **Repository access > Only select repositories** > `threadwise`.
4. **Repository permissions**: Contents = Read-only, Pull requests = Read-only, Metadata = Read-only (added automatically). Nothing else.
5. Generate and copy the token once. If the repository is owned by an organisation, the owner may need to approve the token request before it works.

## Store it on the server
```
sudo install -m 640 -o root -g root /dev/null /opt/desk/secrets/github_read_token
sudo sh -c 'cat > /opt/desk/secrets/github_read_token'   # paste the token, Ctrl-D
```
Mode 640 root. The watcher runs as root. On the build server use `/etc/desk-ci/github_read_token` (or `DEPLOY_MSG_TOKEN_FILE`). Install or update the watcher (idempotent, prints no secrets): `sudo bash deploy/hostinger/install-release-watch.sh`.

## Rotate
Create a new token with the same steps, overwrite the file (same commands), run a `--dry-run` (below), then revoke the old token in GitHub. No restart is needed: the file is read on every message. Calendar a reminder for day 80.

## Test
- Preview without posting: `sudo /opt/desk/desk-release-watch.sh --dry-run <prev_sha> <new_sha> [seconds] [started|live|unchanged]`
- Post a labelled test to Chat: `sudo /opt/desk/desk-release-watch.sh --test`
- Automated: `bash script-testing/deployment-messages/run.sh --quick` (local fake GitHub and Chat).

## Rollback
`sudo systemctl disable --now desk-release-watch.service`, then install the previous script (the original text-only watcher is in git history before this change) and start the unit. Deleting `/opt/desk/secrets/github_read_token` alone is enough to fall back to the plain Version + commit message.
