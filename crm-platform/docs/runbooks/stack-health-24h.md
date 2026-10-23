# Stack health, 24 hours a day

Two layers: a check on the host that tells the Critical Google Chat space when the alerting stack itself is broken, and an external monitor for what the host cannot see about itself.

## 1. On the host (cron, every 5 minutes)

`deploy/hostinger/stack-selfcheck.sh` is read-only. It checks: grafana, prometheus, alertmanager, gchat-bridge and probe are Up and healthy; `desk-release-watch` is active and its heartbeat file (`/var/lib/desk-release-watch/heartbeat`, only if present) is younger than 120 s; the bridge answers `/health`; Prometheus target `crm-chat-bridge` is up; the bridge got a Watchdog in the last 15 minutes; the disk has more than 15% free. One `OK` or `FAIL` line per check, exit 1 on any FAIL.

Install (as root on the host; `deploy-observability.sh` copies the script to `/opt/desk`):

```bash
( crontab -l 2>/dev/null; echo '*/5 * * * * /opt/desk/stack-selfcheck.sh --notify >/dev/null 2>&1' ) | crontab -
/opt/desk/stack-selfcheck.sh        # run once by hand to see the lines
```

With `--notify` it posts ONE message to the Critical space, using `/opt/desk/secrets/gchat_critical_url` (curl `--max-time 8`, URL passed on stdin so it is not in the process list, never logged). A given failing check is announced at most once per hour (state in `/var/tmp/stack-selfcheck/<check>.last`, cleared when the check passes again). No failure, no message.

## 2. What this cannot catch

If the whole host, its network, Docker or cron is down, nothing on the host can speak. The same goes for Google Chat being unreachable from the host. For that, use an external monitor.

## 3. External uptime monitor (free)

Example with UptimeRobot (free plan, 5-minute checks):

1. Sign up at uptimerobot.com, Dashboard, Add New Monitor.
2. Monitor type HTTP(s), friendly name `Threadwise Grafana`, URL `https://grafana-desk.wabo.ai/api/health`, interval 5 minutes.
3. Alert contacts: add your email. For Google Chat, in the Critical space open Apps and integrations, Webhooks, create a webhook named `uptime`, then in UptimeRobot go to Integrations, add a Webhook integration with that URL and POST body `{"text":"*monitorFriendlyName* is *alertTypeFriendlyName* (*monitorURL*)"}`, content type JSON. Use a separate webhook, not the one the alerting stack uses.
4. Attach the email and webhook contacts to the monitor and save. Pause the monitor during planned maintenance.
