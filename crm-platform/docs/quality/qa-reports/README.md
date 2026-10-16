# QA task reports

One report per QA task, each self-contained (HTML to read, PDF to share). Generated from `pnpm qa <task>` on `origin/main` at commit `fc12325c0`
(2026-10-16), plus a review of the code behind each finding. **Static checks only**: no API, web app or database was running, so every live check
shows as skipped and is never counted as a pass. Regenerate the raw numbers with `pnpm qa 30 31 36 40 41`; the live output is git-ignored
(`reports/qa-suite/`), so these files are the durable record.

| Task | Report                                                                                             | Verdict                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 30   | Injection testing: [HTML](qa-30-injection-testing.html) · [PDF](qa-30-injection-testing.pdf)       | No injection path found by code analysis; live attacks not run, target not yet shown        |
| 31   | XSS testing: [HTML](qa-31-xss-testing.html) · [PDF](qa-31-xss-testing.pdf)                         | No confirmed XSS; 27 sinks read (20 safe, 5 to trace, 2 accepted risk); review not recorded |
| 36   | Audit logging: [HTML](qa-36-audit-logging.html) · [PDF](qa-36-audit-logging.pdf)                   | **Target not met**: 2 modules (Google account, AI copilot) write no audit rows              |
| 40   | DB indexing audit: [HTML](qa-40-db-indexing-audit.html) · [PDF](qa-40-db-indexing-audit.pdf)       | 19/19 critical patterns indexed; 7 redundant indexes and 204 uncovered FKs remain           |
| 41   | Slow-query analysis: [HTML](qa-41-slow-query-analysis.html) · [PDF](qa-41-slow-query-analysis.pdf) | Capture configured everywhere; ranking and p95 not measured (needs a database under load)   |
