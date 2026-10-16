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
A failed **build** stops before production is touched. A failed **release** rolls back to the previous tag by itself.

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
- There is **no test or CI gate**: the Docker builds type-check the API and the web app (that stopped the bad builds so far), but unit
  tests, the migrations-from-scratch check and the security scans do not run here. Run `pnpm test` and the migration check before merging
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
ssh root@187.127.155.227 'cd /opt/desk && sed -i "/^IMAGE_TAG=/d" .env && echo IMAGE_TAG=<previous tag> >> .env && docker compose --env-file .env up -d api worker web'
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

Checks that need no server: `deploy/build-server/tests/checks.test.sh` (webhook signature and filter self-test, shell syntax).

## Rotating

- **Webhook secret:** write a new value to `/etc/desk-ci/webhook-secret` (mode 640, owner root:deskci) and set the same value in the GitHub webhook. No restart is needed; it is read on every request.
- **Production key:** run `ssh-keygen` for a new `prod_deploy_key`, replace the line in the production `authorized_keys`, delete the old one.
- **GitHub deploy key:** replace the key in the repository settings with the new `github_deploy_key.pub`.

## Known limits

- **GitHub Actions deploy** (`.github/workflows/deploy.yml`) is still in the repository. It cannot run while the account's billing is blocked, and if it
  ever runs again it would deploy the same commit in parallel with this pipeline. Disable one of them (for example by making that workflow
  `workflow_dispatch` only) when billing is restored.
- **MinIO image:** the stack needs `minio/minio:latest` preloaded on each host (`pull_policy: never`), and that repository is no longer on Docker Hub.
  A new host cannot pull it; copy it from a host that has it (`docker save minio/minio:latest | ssh <host> docker load`) or move to a maintained fork.
- **Dokploy** is installed on the build server (panel on port 3000, reachable through an SSH tunnel) but has **no admin account and manages
  nothing**: this pipeline does not use it, except that its Traefik terminates TLS for the webhook. Moving the deploy into Dokploy itself (Applications
  with a build server and a registry, the database services as a compose on the production host) is possible but is a restructure of production and
  has not been done.
- The webhook and the Dokploy panel are on a temporary `sslip.io` hostname with no DNS record of ours; switch `CI_HOST` (re-run `install.sh`
  and update the webhook URL) when a real name exists.
