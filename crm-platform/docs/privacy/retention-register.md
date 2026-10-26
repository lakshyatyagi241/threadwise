# Retention register: tables with no retention rule yet (QA task 49)

**Status: PROPOSED. Nothing here deletes data.** The retention mechanism (`data_retention_policies`, migration 20270101090000) keeps every
item for ever until a super admin saves a policy row for it, and an item with no row never changes behaviour. The windows below are
proposals for the owner (and, for the legal ones, counsel) to approve; they are not decisions. QA task 49 keeps these tables in
`tools/qa-suite/data/baseline.json` as "deferred, not reviewed as safe" until a window is approved and a purge job exists.

| Table | What it holds | Proposed live window | Why this window | Needs |
| ----- | ------------- | -------------------- | --------------- | ----- |
| `shopify_integration_events` | webhook/sync events from a connected Shopify store | 90 days | debugging and replay; the store is the source of truth | owner |
| `woocommerce_integration_events` | same, WooCommerce | 90 days | same | owner |
| `hubspot_integration_logs` (partitioned) | sync log lines | 90 days, then drop the partition | same; partitioned, so a partition drop is cheap | owner |
| `trello_integration_logs` (partitioned) | sync log lines | 90 days, then drop the partition | same | owner |
| `translation_usage` | per-request usage counters for billing the translation provider | 13 months | covers a year-over-year comparison and the billing dispute window | owner |
| `failed_operation_events` | append-only history of a failed operation's attempts (DLQ, see docs/quality/dlq-strategy.md) | 90 days after the operation is resolved; open ones never | the failure itself stays until resolved | owner |
| `invoice_gateway_events` | payment gateway callbacks for invoices | 7 years | financial records: tax-year retention rules differ by country | owner + counsel |
| `wallet_platform_log` | platform-level wallet movements | 7 years | financial audit trail | owner + counsel |
| `contact_consent_events` | each consent given, withdrawn or changed | life of the consent plus the statutory period | the proof that a message was allowed (DPDP Act); deleting early removes the defence | counsel |
| `privacy_request_events` | the steps of an access/erasure request | 3 years after the request closes | proof the request was honoured | counsel |
| `api_library_logs` | API library call log | already handled: daily purge (apps/api/src/modules/api-library/api-library-retention.service.ts) | | none |

To turn one on: pick the window, add the item to the retention job's registry, save its policy row from the console, and run the job in dry-run first
(`PartitionArchiver` exports, reads back and compares counts before any drop). Rollback is deleting the policy row.
