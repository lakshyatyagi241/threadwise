# Wiring: CRM dashboard

| Id            | Row              | Where                                                                                                                                   |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-CRMD-001 | Route            | web `/crm` (`app/(app)/(crm-dashboard)/crm/page.tsx`), API `GET /v2/crm/dashboard`                                                      |
| WIRE-CRMD-002 | Permission       | `record.deals.read`, plus `record.contacts.read`, `record.tasks.read`, `record.payments.read` per section; no new key                    |
| WIRE-CRMD-003 | Plan             | `sales_pipeline` (route and menu lock), `invoicing` (invoices section)                                                                  |
| WIRE-CRMD-004 | Tables read      | deals, pipelines, pipeline_stages, deal_activities, contacts, contact_activities, tasks, invoices, payments, users, teams, team_members, user_profiles, currencies |
| WIRE-CRMD-005 | Upstream feeders | deals engine (stage moves write `deal_activities`), lead sources (`contacts.source`), invoicing, tasks                                  |
| WIRE-CRMD-006 | Consumers        | menu entry `crm-dashboard` (Sales), Help guide `crm-dashboard`, deals list `?stage=` filter                                             |
| WIRE-CRMD-007 | Indexes          | `idx_deal_activities_org_created`, `idx_contact_activities_org_occurred`                                                                |
| WIRE-CRMD-008 | Blocked          | Revenue report, CSV, PDF (TW-PAY-017); client brief (WIRE-CTP-021)                                                                      |
