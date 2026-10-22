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

Claude does this for you via the `handle-alert` skill (`.claude/skills/handle-alert/SKILL.md`); a scheduled version: [incident-schedule-prompt.md](incident-schedule-prompt.md).

## Credentials for a new teammate

The API sits at `https://<PROMETHEUS_DOMAIN>/incidents` (default `prometheus-desk.wabo.ai`) behind two locks: Traefik basic auth (user `incidents`) and the header `X-Incident-Token`. Both secrets are made once by `observability-up.sh` on the server. The server owner reads them (do this in a private terminal, send them over a password manager, never in Chat):

```
cd /opt/desk && cat secrets/incidents_basic_password; echo; cat secrets/incident_api_token; echo
```

Each teammate stores them on their own machine, mode 600, never committed:

```
mkdir -p ~/.config/threadwise && umask 077 && cat > ~/.config/threadwise/incidents.env <<'X'
INCIDENT_API_URL=https://prometheus-desk.wabo.ai
INCIDENT_API_USER=incidents
INCIDENT_API_PASSWORD=<password>
INCIDENT_API_TOKEN=<token>
INCIDENT_WHO=<your name>
X
chmod 600 ~/.config/threadwise/incidents.env
```

The CLI refuses a file that is group/world readable. Rotate: delete the two files in `secrets/`, run `./observability-up.sh`, `docker compose ... up -d --force-recreate gchat-bridge`, redistribute.

## Limits

- Emoji reactions in Chat are invisible to a webhook: use the CLI/skill. A **Google Chat app** (slash command or card button "Claim", needs a Workspace admin and a public HTTPS endpoint) is a later option; the claim API is already what such an app would call.
- Incidents live in the bridge's memory (200 max, lost on restart); the threads in Chat keep the history.
- One shared token: it identifies the team, not the person; `who` is self-declared. Fine for 2-3 trusted people.
- `AUTO_REMEDIATE=off` creates no incidents at all, so there is nothing to claim.
