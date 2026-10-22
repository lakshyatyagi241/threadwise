# Google Chat: Grafana alerts and deploy notices (owner steps)

Nothing here is live until you do these steps; the repo only holds the config.

## Grafana (slow query alerts)
1. In Google Chat create incoming webhooks (Space, Apps and integrations, Webhooks) for four spaces: critical, other, slow query, deployments.
2. Put the four URLs in the Grafana container environment (never in git): `GRAFANA_GCHAT_CRITICAL_URL`, `GRAFANA_GCHAT_OTHER_URL`,
   `GRAFANA_GCHAT_SLOWQUERY_URL`, `GRAFANA_GCHAT_DEPLOY_URL`. Compose passes them through; the observability compose file is owned by the bridge work, so add the four `environment:` lines there when that lands.
3. Restart Grafana. Provisioning in `deploy/observability/grafana/provisioning/alerting/` creates the contact points, the policy tree
   (severity=critical -> critical, group=slow_query -> slow query, default -> other), the message template and the rule "Slow query running"
   (`max(crm_slow_query_max_seconds) >= 5`, for 30s). Dashboard: "Threadwise slow queries".
4. Check: Alerting > Contact points > "gchat-slowquery" > Test. Change the threshold by copying the rule in the UI (provisioned rules are read-only) or edit `rules.yml` (the number in node C) and the red line in the dashboard.
5. `keep_firing_for` is not in the rule: Grafana 11.3 ignores it. Add it after upgrading to 11.4 or later.

## Deployments (build server)
Follow step 7 in `deploy/build-server/README.md`: create `/etc/desk-ci/gchat_deploy_url` (mode 640, root:deskci), re-run `install.sh`, test with the curl line there.
