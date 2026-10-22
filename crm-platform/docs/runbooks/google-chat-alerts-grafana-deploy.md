# Google Chat: Grafana alerts and deploy notices (owner steps)

Nothing here is live until you do these steps; the repo only holds the config.

## Grafana (slow query alerts)
1. In Google Chat create incoming webhooks (Space, Apps and integrations, Webhooks) for three spaces: Threadwise Critical Alerts, Threadwise Slow Queries & Warnings, Threadwise Deployments.
2. Save the three URLs as `~/gchat/{critical,slowquery,deploy}_url`; `deploy/hostinger/observability.compose.yml` mounts them into Grafana as docker secrets `gchat_{critical,slowquery,deploy}_url` (never in git).
3. Restart Grafana. Provisioning in `deploy/observability/grafana/provisioning/alerting/` creates the contact points, the policy tree
   (severity=critical -> critical, everything else -> slowquery), the message template and the rule "Slow query running"
   (`max(crm_slow_query_max_seconds) >= 5`, for 30s). Dashboard: "Threadwise slow queries".
4. Check: Alerting > Contact points > "gchat-slowquery" > Test. Change the threshold by copying the rule in the UI (provisioned rules are read-only) or edit `rules.yml` (the number in node C) and the red line in the dashboard.
5. `keep_firing_for` is not in the rule: Grafana 11.3 ignores it. Add it after upgrading to 11.4 or later.

## Deployments (build server)
Follow step 7 in `deploy/build-server/README.md`: create `/etc/desk-ci/gchat_deploy_url` (mode 640, root:deskci), re-run `install.sh`, test with the curl line there.
