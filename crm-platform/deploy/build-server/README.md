# Build server: auto-deploy on every push to `main`

A push to `main` builds the two images on the **build server** (`72.61.225.38`, 4 CPUs, 15 GB) and releases them on the
**production server** (`187.127.155.227`, which serves `desk.wabo.ai`). The production host has almost no spare memory (it runs many other
apps), so it never builds: it only receives images and runs them.

```
GitHub push to main
   │  POST https://ci.72.61.225.38.sslip.io/hooks/github   (HMAC-SHA256 signed)
   ▼
build server 72.61.225.38
   Traefik (Dokploy's) ─► webhook.py ─► deploy-main.sh
        git fetch main ─► docker build desk-api, desk-web ─► ssh desk sync ─► ssh desk load ─► ssh desk "release <tag>" ─► smoke test
   │  one restricted SSH key (forced command)
   ▼
production server 187.127.155.227   /opt/desk/ci-entry.sh
   sync    deploy files (compose, init-roles.sh, seed.js, set-secrets.sh, ci-entry.sh, .env.example)
   load    the image tarball
   release <tag>: pre-release database dump, migrate, restart api/worker/web, health check, automatic rollback
```

`release` is the same script the old GitHub Actions job used (`.github/workflows/deploy.yml`, now blocked by the account's billing).
A failed **build** stops before production is touched. A failed **release** moves traffic back to the live slot and leaves the previous
release running (see the zero-downtime section below).

## Zero-downtime release (blue-green)

The public site runs as two slots, **blue** and **green**, each an API and a web container. A release:

1. checks that the migrations it adds are expand-only (`migration-lint.py`, on this host, before anything is built);
2. takes a database dump and runs the migrations (the live slot keeps serving on the old code meanwhile);
3. starts the **idle** slot on the new image and waits until its healthchecks pass;
4. moves the public routes to it by rewriting `/etc/dokploy/traefik/dynamic/desk.yml` (Traefik reloads it at once, no restart), then checks
   `/ready` and `/login` through the public address five times;
5. restarts the single worker on the new image (one instance only, its schedulers must not run twice; the worker has no public traffic);
6. keeps the old slot running for a minute so requests and websocket clients already on it finish (clients reconnect on their own), then stops it.

If any step fails, traffic goes back to the live slot and the idle slot is stopped. The rehearsal on this build server
(`/root/rehearse.sh` on 72.61.225.38, not part of the repo) probes the public routes through Traefik for the whole run.

**Migrations must be expand-only.** The live slot is still running while the migrations of a release run, so a migration that drops or
renames a column or table, changes a column's type, adds a NOT NULL column without a default, changes an enum or empties a table fails this
release. Make the change in two releases: add the new shape first, switch the code, then remove the old shape in a later release. A
migration that must do one of these things can carry a `-- bluegreen-ok: <reason>` line, which is then a reviewed exception in the diff.
Dropping and re-adding a constraint or trigger under the same name (a widened check) is allowed.

**Memory.** While both slots run, the host needs room for one more API (about 1 GB at most) and one more web (about 768 MB at most). A
release refuses to start when less than `BLUE_GREEN_MIN_MEM_MB` (default 1000 MB; measured use is about 350 MB for the API and 400 MB for web) is
available, or less than `DESK_MIN_DISK_MB` (3000 MB) of disk, or when another release holds `/var/lock/desk-release.lock`, or when Traefik's
dynamic directory is missing, all before anything changes.

### Webhook API (`api-hooks`)

A release also restarts `desk-api-hooks`, the container behind `/v2/public/webhooks`, on the new tag (`HOOKS_TAG`), after the idle slot is healthy and before the switch. It is not in a slot: Traefik falls back to the live slot's API while it is unhealthy, so a failed start only logs a warning and the release goes on. A rollback moves it back to the previous tag. Details: `deploy/hostinger/README.md`.

## What runs where

| Where        | What                                                                                       | Files                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| build server | `desk-ci-webhook.service` (user `deskci`), bound to the docker bridge `172.17.0.1:9099`    | `/opt/desk-ci/webhook.py`, `/etc/systemd/system/desk-ci-webhook.service`                                |
| build server | the build and release script                                                               | `/opt/desk-ci/deploy-main.sh`                                                                           |
| build server | public route for `/hooks/*` only, with its own certificate                                 | `/etc/dokploy/traefik/dynamic/desk-ci.yml`                                                              |
| build server | secrets and keys (root:deskci, mode 640)                                                   | `/etc/desk-ci/` (`webhook-secret`, `github_deploy_key`, `prod_deploy_key`, `ssh_config`, `known_hosts`) |
| build server | state and logs                                                                             | `/var/lib/desk-ci/` (`deployed`, `status.json`, `lock`), `/var/log/desk-ci/`                            |
| production   | forced-command key (`restrict,command="/opt/desk/ci-entry.sh"`)                            | `/root/.ssh/authorized_keys`, line `desk-ci build server (production release key)`                      |
| GitHub       | read-only deploy key (so the build server can clone the private repo) and the push webhook | repo Settings, Deploy keys and Webhooks                                                                 |

Nothing secret is in this repository.

## Behaviour

- **One run at a time** (`flock`). A push that arrives while a run is going sets a `pending` flag (set before the lock is tried, so it cannot be
  missed); when the run ends, the script releases the lock, looks for the flag, fetches `main` again and releases the new tip. Several quick merges therefore produce at most one extra release, of the latest commit.
- The webhook payload is only a trigger. The script always builds the **current tip of `main`**. Only a non-deleting push to
  `refs/heads/main` of `lakshyatyagi241/threadwise` starts it; other events, branches and repositories are acknowledged and ignored.
- A tip that is already released (`/var/lib/desk-ci/deployed`) is skipped; `deploy-main.sh --force` releases it again.
- Like the old workflow's `paths: crm-platform/**`, a push that changes **nothing under `crm-platform/`** since the last released commit (a root
  README, docs elsewhere in the repository) is not released. The log says so and `deployed` is left as it was.
- The tag is the 9-character commit hash, as `ship.sh` uses. The last two releases stay on the production host for rollback.
- There is **no test or CI gate**: the Docker builds type-check the API and the web app (that stopped the bad builds so far), and the
  expand-only migration check runs, but unit tests, the migrations-from-scratch check and the security scans do not run here. Run `pnpm test` and the migration check before merging
  anything large. Migrations only go forward; the pre-release dump taken by `release` is the way back from a bad one.

## Operate

Watch a deploy and see the last result:

```bash
ssh -i ~/.ssh/tatapoc_deploy root@72.61.225.38
cat /var/lib/desk-ci/status.json                 # {"at","sha","state": building|shipping|releasing|ok|failed,"log"}
tail -f "$(ls -1t /var/log/desk-ci/*.log | head -1)"
cat /var/log/desk-ci/webhook.log                 # skipped/queued pushes and failures
journalctl -u desk-ci-webhook -n 50
```

Deploy by hand (same script the webhook runs; use when GitHub is unreachable or to re-run a failed release):

```bash
sudo -u deskci -H /opt/desk-ci/deploy-main.sh            # release main if it is not already live
sudo -u deskci -H /opt/desk-ci/deploy-main.sh --force    # release it again
```

`deploy/hostinger/ship.sh` still works from a workstation and does not need this pipeline; do not run both at once.

Roll back by hand to the previous release (kept on the production host):

```bash
ssh root@187.127.155.227 'cd /opt/desk && grep ^IMAGE_TAG .env && docker image ls --format "{{.Repository}}:{{.Tag}}" | grep ^desk-'
# blue-green: start the other slot's old release (the stopped slot keeps its image), move traffic back, restart the worker on it
ssh root@187.127.155.227 'cd /opt/desk && cat .slot && grep -E "^(IMAGE_TAG|SLOT_(BLUE|GREEN)_TAG)=" .env'
ssh root@187.127.155.227 'SSH_ORIGINAL_COMMAND="release <previous tag>" bash /opt/desk/ci-entry.sh'   # the simplest rollback: release the previous tag again
```

Rolling back the code does not undo migrations; restore a dump (`docs/runbooks/backup-restore.md`) only if a migration itself was the problem.

## Install or rebuild the build server

Needs Docker (with the Dokploy Traefik running), Python 3, git, and root. From this folder on the build server:

1. `CI_HOST=ci.<ip>.sslip.io PROD_HOST=<production ip> ./install.sh`. It creates the `deskci` user, the two key pairs and the webhook secret
   (only if they do not exist), installs the files and the service, and publishes the webhook route. It prints the public keys to register.
2. **GitHub read-only deploy key:** add `/etc/desk-ci/github_deploy_key.pub` under the repository's Deploy keys, **without** write access.
3. **Trust anchors** in `/etc/desk-ci/known_hosts`: GitHub's keys from `gh api meta --jq '.ssh_keys[]'` (prefix each with `github.com `)
   and the production host key from `/etc/ssh/ssh_host_ed25519_key.pub` on that host (prefix it with its address). Take them from a channel you
   already trust, not from `ssh-keyscan`.
4. **Production key:** append the printed line to `/root/.ssh/authorized_keys` on the production host. It must keep `restrict,command="/opt/desk/ci-entry.sh"`:
   the key can then only run `sync`, `load` and `release <tag>`.
5. **Webhook:** repository Settings, Webhooks, payload URL `https://<CI_HOST>/hooks/github`, content type `application/json`, the secret from
   `/etc/desk-ci/webhook-secret`, event **Push** only, SSL verification on.
6. Verify: `curl https://<CI_HOST>/hooks/health` returns `ok`; an unsigned `POST /hooks/github` returns 401; GitHub's "Redeliver" of the
   ping shows 200; `sudo -u deskci ssh -F /etc/desk-ci/ssh_config desk "id"` answers `unsupported command` (the forced command refused it).

7. **Deployments chat (optional):** in Google Chat open the Deployments space, Apps and integrations, Webhooks, create one, then on the server
   `install -m 640 -o root -g deskci /dev/null /etc/desk-ci/gchat_deploy_url`, put the webhook URL in it (one line) and re-run `install.sh` so
   `notify-chat.sh` is installed next to `deploy-main.sh`. Test: `curl -sS --max-time 5 -H 'Content-Type: application/json' -d '{"text":"test from the build server"}' "$(sudo cat /etc/desk-ci/gchat_deploy_url)"`.
   With the file missing nothing is posted and nothing fails. Cards are sent on release started, succeeded, failed (or rolled back) and skipped
   (already released, or nothing changed under `crm-platform/`); `notify-chat.sh` times out after 5 s, runs in the background, and its failures are logged
   to `webhook.log` without the URL. Override the file with `DESK_CI_GCHAT_URL_FILE`. There is no memory gate in `deploy-main.sh`, so no card for one.

Checks that need no server: `deploy/build-server/tests/checks.test.sh` (webhook signature and filter self-test, shell syntax).

## Rotating

- **Webhook secret:** write a new value to `/etc/desk-ci/webhook-secret` (mode 640, owner root:deskci) and set the same value in the GitHub webhook. No restart is needed; it is read on every request.
- **Production key:** run `ssh-keygen` for a new `prod_deploy_key`, replace the line in the production `authorized_keys`, delete the old one.
- **GitHub deploy key:** replace the key in the repository settings with the new `github_deploy_key.pub`.

## Known limits

- **GitHub Actions deploy** (`.github/workflows/deploy.yml`) is still in the repository. It cannot run while the account's billing is blocked, and if it
  ever runs again it would deploy the same commit in parallel with this pipeline. Disable one of them (for example by making that workflow
  `workflow_dispatch` only) when billing is restored.
- **Blue-green needs memory on the production host.** Two slots of API and web run during each switch (about 0.75 GB extra). The host's
  available memory moves between roughly 1.5 GB and 9 GB with the other apps on it. When it is below the gate a release refuses with a clear
  message and changes nothing; re-run it later, or free memory first.
- **`ci-entry.sh` is not synced by the CI key.** It is the forced command of that key, so the key cannot rewrite it. After changing it, install it
  yourself: `deploy/hostinger/ship.sh` copies it with your own login, or `scp deploy/hostinger/ci-entry.sh root@<prod>:/opt/desk/ci-entry.sh`.
- **Dokploy** is installed on the build server (panel on port 3000, reachable through an SSH tunnel) but has **no admin account and manages
  nothing**: this pipeline does not use it, except that its Traefik terminates TLS for the webhook. Moving the deploy into Dokploy itself (Applications
  with a build server and a registry, the database services as a compose on the production host) is possible but is a restructure of production and
  has not been done.
- The webhook and the Dokploy panel are on a temporary `sslip.io` hostname with no DNS record of ours; switch `CI_HOST` (re-run `install.sh`
  and update the webhook URL) when a real name exists.
