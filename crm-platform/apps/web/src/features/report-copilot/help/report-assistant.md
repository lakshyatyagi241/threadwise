---
id: report-assistant
title: Reports (AI report assistant)
summary: Add your documents, then ask the assistant for a report built from them and your workspace numbers, with charts and tables you can print or export.
area: overview
order: 20
documents: [nav:reports]
keywords: [ai, report, assistant, copilot, documents, pdf, word, summary, charts, export, print]
---

## What it is for

The AI report assistant reads the documents you add and your workspace numbers (the same ones the Dashboard and Analytics show), then writes a report and draws it on the page: key figures, sections with bar, line or pie charts and tables, and a list of what the report rests on. Use it for a weekly summary, a comparison between a PDF and this month's results, or a quick answer about a long document.

## How to use it

1. Open **Reports** in the **Platform** area of the menu, under **Analytics**, or go to `/reports`. The page opens straight onto the assistant.
2. Pick the numbers to use at the top right under **Numbers to use** (last 7, 30 or 90 days).
3. Add your files from the chat: select the **+** button next to the message box, then **Upload documents (PDF, DOCX, TXT…)**, and pick one or more files on your computer. They are added one after another and the chat area shows **Uploading** and then **Added** for each, or the reason a file was refused. You can also use the **Documents** button (on a phone, the **Documents** tab). Drop them on the box or select **Choose file**. Files you add from the **+** menu go into the same library, not into the message; the assistant reads them every time you ask. Each file is read when you add it and shows **Ready**, or **Could not read** with the reason. The button shows how many documents you have.
4. Ask a question in the chat on the left, or start from a suggestion: **Summarise my documents**, **Build a performance report for the last 30 days** or **Compare the PDF with this month's numbers**.
5. The assistant shows the report as blocks: a heading and summary, key figures, charts (bar, line, area, pie or donut) and tables. Each block appears in the chat and is added, in order, to the report on the right. Under every block a line says where its figures came from, such as a document name or **Dashboard, last 30 days**, or **No source stated** when the assistant did not say. If you ask for a custom design, the assistant can instead write a page of its own, which also appears on the right as soon as the assistant draws it (on a phone, select **Show report** in the chat or open the **Report** tab). Every report you build during your visit is kept: when there is more than one, choose an earlier one under **Previous reports**.
6. Under the buttons, the report says when it was generated and from how many documents. Select **Refresh data** to ask the assistant the same question again, so it reads your current documents and the latest numbers; the new report is added to **Previous reports**. Some key figures show a small **Live** mark: they are tied to the Dashboard numbers and update on their own while the report is open. Message figures follow the period you chose (for the last 7 or 30 days); contacts, campaigns, devices, templates, unread conversations, deals and flows show the current figure. If a figure cannot be bound, it keeps the value the assistant read. Numbers are shown exactly as the assistant read them, with your number grouping.
7. Use the buttons above the report. A report made of blocks has **Print / Save as PDF**, **Copy as Markdown** and **Download JSON**; printing prints the report only, not the page around it, and always uses light colours. A page the assistant designed itself has **Download HTML**, which saves the page as a file you can open in a browser and print from there. The other three are not available for it.

Reports are held on the page only. Leaving the page clears them and the conversation, so export a report you want to keep.

## Documents

- **Types.** PDF, Word (`.docx`), and text-like files: `.txt`, `.md`, `.csv`, `.html`, `.htm` and `.json`.
- **Size.** Up to 10 MB per file and up to 25 documents in the library.
- **Long files.** Only the first 400,000 characters of a file are used. A longer file is marked **Long file** in the list.
- **Scanned PDFs.** A PDF that is only pictures of pages may have no text to read, and then shows **Could not read**.
- **Deleting.** Select the bin icon next to a document and confirm. The assistant stops using it at once. Reports already on screen stay as they are.

You need the permission to manage reports to add or delete documents. Without it, the **+** menu explains that you can see the library but not change it. With only the permission to view reports you can see the library and use the chat.

## Custom designs

Only when you ask for a custom layout, the assistant writes the report page itself, with its own layout and charts. That page is shown in a protected frame: it cannot read your workspace, your session or the rest of this page, and it has no way to call your data. It is drawn from your documents and the numbers for the period you chose, so check it like any other report. If it looks wrong or incomplete, ask the assistant to try again or to build a structured report instead.

## What the assistant can and cannot do

- It can summarise and compare your documents, use your workspace numbers for the period you chose, and draw the result as a report.
- It can make mistakes. Check figures against the source before you share a report; the **Sources** list at the bottom shows the documents and numbers it says it used.
- It cannot change anything in your workspace: it reads documents and numbers and draws a report. It cannot send messages, edit contacts or open other pages for you.
- It only knows what is in your documents and your workspace numbers. It does not search the internet.

## Privacy

> Your documents are stored for your workspace, and their text is sent to the AI provider whose key is set up for your workspace whenever you ask the assistant something. Do not add files you are not allowed to share with that provider.

Everyone in the workspace who may view reports uses the same library. Delete a document when it should no longer be used.

## Plan and access

You need the permission to view reports to see **Reports** in the menu. Adding and deleting documents needs the permission to manage reports. The assistant needs an AI key: add your own in [AI provider keys](help:ai-provider-keys), or use the platform's key when your plan provides one.

## If something looks wrong

- **The assistant needs an AI key.** A notice above the chat says so and links to **AI provider keys**.
- **A message asks you to add an AI key.** No usable key is set up. Open `/ai-keys` and add one, then ask again.
- **A file shows Could not read.** Read the reason next to it. For example a scanned PDF with no text, a password-protected file or a file over 10 MB.
- **The assistant sent a report we could not draw.** The report it wrote was incomplete. The chat keeps working; ask it to try again.
- **A chart says there is no data.** The assistant sent nothing it could draw for it. Ask again, or ask which document the figures should come from.
- **The answer ignores a document.** Check that the document is marked **Ready** and is not marked **Long file** with the part you need near the end.
