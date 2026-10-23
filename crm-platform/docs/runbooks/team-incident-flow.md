# Team incident flow (2-3 people, each with their own Claude Code)

Real alerts arrive in the Google Chat spaces (see [google-chat-alerts.md](google-chat-alerts.md)). Google Chat **incoming webhooks cannot read emoji reactions and cannot edit messages**, so "I take this one" is NOT a reaction. It is a call to the bridge (`incident-cli claim`), and the bridge answers in the alert's own thread. The bridge is the single source of truth; two people cannot both hold a claim (the second gets 409).

## What happens, per alert kind

| | Critical issue | Slow query | Deployment error |
| --- | --- | --- | --- |
| Posts to | Critical space | Slow Queries & Warnings space | Deployments space (deploy alerts that carry a resolver incident) |
| First post | Alert card + diagnosis (thread = alert fingerprint) | Statement card + DIAGNOSED / ACTION (code_fix opens an incident) | Alert card + diagnosis |
| Who acts | Whoever claims it; infra goes to the server owner | Whoever claims it (usually an index/query PR) | Whoever claims it (fix forward or revert PR) |
| Thread at claim | `👀 <who> is working on this (claimed HH:MM UTC)` | same | same |
| Thread at PR | `🔧 PR #N raised by <who> at HH:MM UTC: <summary> <url>` | same | same |
| Claim lapses (4 h, no PR, no note) | `⏰ claim expired, incident is open again` | same | same |
| Gave up | `🤝 <who> released this incident` | same | same |
| Closing | `✅ RESOLVED by PR #N (owner <who>), release <sha>` after `POST /release`, or when the alert verifies cleared after the PR was raised | same | same |

Statuses: `open`, `claimed`, `pr_raised`, `resolved`, `escalated`. A PR never expires the claim; a `note` renews it. Everything in the thread is escaped; alert text is untrusted.

## Daily use

```
node tools/chat-bridge/incident-cli.mjs list open
node tools/chat-bridge/incident-cli.mjs claim <id>
node tools/chat-bridge/incident-cli.mjs show <id>
node tools/chat-bridge/incident-cli.mjs pr <id> https://github.com/lakshyatyagi241/threadwise/pull/123 "add index on contacts(tenant_id)"
node tools/chat-bridge/incident-cli.mjs note <id> "checked: not a plan regression"
node tools/chat-bridge/incident-cli.mjs release-claim <id>
```

Claude does this for you via the `handle-alert` skill (`.claude/skills/handle-alert/SKILL.md`); the 5-minute auto-claim loop: [incident-schedule-prompt.md](incident-schedule-prompt.md).

## Credentials for a new teammate

The API sits at `https://<PROMETHEUS_DOMAIN>/incidents` (default `prometheus-desk.wabo.ai`) behind two locks: Traefik basic auth (user `incidents`) and the header `X-Incident-Token`. Both secrets are made once by `observability-up.sh` on the server. The server owner reads them (do this in a private terminal, send them over a password manager, never in Chat):

```
cd /opt/desk && cat secrets/incidents_basic_password; echo; cat secrets/incident_api_token; echo
```

Each teammate then runs `node tools/chat-bridge/incident-cli.mjs init` and `... doctor` (writes the file with mode 600, URL is the host only, name without parentheses). Step by step: [team-onboarding-claude.md](team-onboarding-claude.md). The CLI refuses a file that is group/world readable. Rotate: delete the two files in `secrets/`, run `./observability-up.sh`, `docker compose ... up -d --force-recreate gchat-bridge`, redistribute.

## Limits

- Emoji reactions in Chat are invisible to a webhook: use the CLI/skill. A **Google Chat app** (slash command or card button "Claim", needs a Workspace admin and a public HTTPS endpoint) is a later option; the claim API is already what such an app would call.
- Incidents live in the bridge's memory (200 max, lost on restart); the threads in Chat keep the history.
- One shared token: it identifies the team, not the person; `who` is self-declared. Fine for 2-3 trusted people.
- `AUTO_REMEDIATE=off` creates no incidents at all, so there is nothing to claim.

## Closing the loop (release-aware)

- The release watcher (`deploy/hostinger/desk-release-watch.sh`) posts to Deployments, then calls the bridge in the background (`docker exec desk-gchat-bridge`, token read inside the container): `POST /release {sha, prs, at}` after "Release live", `POST /incidents` (kind `deploy_failure`, one per attempted sha) when the live version did not change. A bridge failure is logged and never delays the Deployments post.
- Only incidents whose PR number is in `prs` become `released`; other releases change nothing. Then, for `VERIFY_SECONDS` (default 120): critical alerts need the alert not firing (Prometheus `ALERTS{alertname=...,alertstate="firing"}` or Alertmanager resolved); slow statements need the recovered polls (`SLOW_VERIFY_SECONDS`, default 600); a deploy failure resolves on the next live release.
- Pass: `RESOLVED by PR #N (owner X), release <sha>, verified after Ns; open for Hh Mm`. Fail: `Released PR #N but the problem is still there`, status back to `escalated`, never RESOLVED.
- Kinds: `critical_alert`, `slow_statement`, `deploy_failure` (shown by `GET /incidents` and `incident-cli list`).
