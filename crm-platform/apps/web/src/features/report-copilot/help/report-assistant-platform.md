---
id: report-assistant-platform
title: Reports (operator console)
summary: Add documents and ask the assistant for a report built from them and the platform's numbers.
routes: [/admin/reports]
area: getting-started
order: 20
audience: operator
documents: []
keywords: [ai, report, assistant, documents, platform, export, print]
---

## What it is for

The **Reports** page in the console reads the documents in the operator library and the platform numbers, then draws a report with key figures, charts, tables and a list of sources. It works like the workspace assistant, with the platform's numbers instead of one workspace's.

## How to use it

1. Open **Reports** in the console menu (the **Reports** area, next to **Analytics**), or go to `/admin/reports`. The page opens straight onto the assistant.
2. Choose the numbers to use under **Numbers to use**.
3. Add files from the chat with the **+** button and **Upload documents (PDF, DOCX, TXT…)**, or with the **Documents** button (a super admin only; an auditor sees a note that the library cannot be changed). Several files can be picked at once. PDF, Word and text-like files are read; each shows **Ready** or **Could not read**.
4. Ask a question in the chat or start from a suggestion. The report is drawn on the right as soon as it is ready; choose an earlier one under **Previous reports**.
5. A report made of blocks (summary, key figures, charts, tables, each with its source) or a structured report has **Print / Save as PDF**, **Copy as Markdown** and **Download JSON** above it. A report the assistant designed itself, shown in a protected frame that cannot reach the console, has **Download HTML** instead.

The report says when it was generated and from how many documents; **Refresh data** asks the same question again. Key figures marked **Live** follow the platform overview and analytics for the period you chose. Reports are held on the page only. Leaving the page clears them, so export a report you want to keep.

## Access

Super admins and auditors can open the assistant and use the chat. Only super admins can add or delete documents. Support operators do not see it.

## Limits and privacy

- Up to 10 MB per file and 25 documents. Only the first 400,000 characters of a file are used.
- The library is shared by all operators who can see it. The text of the documents is sent to the AI provider whose platform key is set up whenever someone asks the assistant something.
- A super admin adds the platform's AI key under **AI provider keys** in the console. Without one, the assistant says **Add a platform AI key to use the assistant.**
- The assistant can make mistakes, and it cannot change anything on the platform.
