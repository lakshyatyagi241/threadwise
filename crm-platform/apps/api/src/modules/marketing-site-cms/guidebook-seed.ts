/**
 * Starter help articles (WD-CMS-050): the guidebook is never empty on a fresh install. Seeded with ON CONFLICT DO NOTHING,
 * so an operator's edit to a seeded article survives a restart (WaDesk overwrote seeded slugs on every re-seed).
 * Markdown bodies; `{{app}}` is replaced by the installation name; the order here is the sort order.
 */
export interface GuidebookSeed {
  title: string;
  category: string;
  excerpt: string;
  body: string;
}

export const GUIDEBOOK_SEED: readonly GuidebookSeed[] = [
  {
    title: 'Connect your first WhatsApp number',
    category: 'Getting started',
    excerpt:
      'Pair a phone, verify with Meta, and send your first test message in under 10 minutes.',
    body: "Connecting your first WhatsApp number is the foundation of every workflow.\n\n## What you'll need\n- A spare phone with **WhatsApp installed** (it doesn't need to stay logged in elsewhere)\n- 10 minutes of quiet time\n\n## Steps\n1. Open **Devices** → **Connect new**\n2. Pick the country code, type the phone number\n3. Wait for the QR — scan it from WhatsApp on the phone (Linked devices → Link)\n4. Wait ~30 seconds — your device flips to \"Connected\"\n5. Send a test message to yourself from `/chat`\n\nIf the QR expires before you scan, just click **Generate new QR**. That's normal — the codes rotate every 60 seconds for security.",
  },
  {
    title: 'Invite teammates and set roles',
    category: 'Getting started',
    excerpt:
      'Add seats, scope what each role can see, and pass the keys without giving away the kingdom.',
    body: 'Roles: **Owner** (full control), **Admin** (everything except billing), **Manager** (campaigns + flows + chat), **Agent** (chat + assigned tickets), **Viewer** (read-only).\n\nInvite from `/settings → Team`. They get a magic-link email; on first sign-in they set their own password.\n\n> Tip: most support reps only need **Agent** — they can answer chat tickets without seeing billing or being able to delete templates.',
  },
  {
    title: 'Import your existing contacts (CSV)',
    category: 'Getting started',
    excerpt:
      'Map columns, de-duplicate by phone, and dry-run the import before it touches anything.',
    body: '1. Go to `/contacts → Import`\n2. Upload a CSV. First row should be headers.\n3. Map columns: phone is **required**; name, email, tags, custom fields are optional\n4. Check **De-duplicate by phone** — recommended\n5. Click **Dry run** first — see how many rows would be created vs updated\n6. Commit the import\n\nPhones get normalised to E.164 automatically. Anything that can\'t be parsed lands in a separate "needs review" bucket.',
  },
  {
    title: 'A 5-minute tour of the dashboard',
    category: 'Getting started',
    excerpt:
      'What every tile means, how to read the daily pulse, and where to drill into the numbers.',
    body: 'Six tiles, one job each.\n\n- **Messages** — total sends in the time window. Click → opens the campaigns + chat breakdown.\n- **Delivery rate** — % delivered out of total attempted. Anything under 95% wants attention.\n- **Read rate** — depends on template type; a "your order shipped" should hit 80%+, a marketing promo 30-50% is normal.\n- **Reply rate** — your secret KPI. Below 2% means the message isn\'t compelling enough.\n- **Active workspaces** — multi-tenant view (admins only).\n- **Device health** — green = all paired devices online, amber = at least one disconnected.\n\nClick any tile to drill in.',
  },
  {
    title: 'Switch from another platform without losing data',
    category: 'Getting started',
    excerpt: 'Templates, contacts, message history — all the moving parts you need to migrate.',
    body: "Migration order matters:\n\n1. **Templates first** — recreate every approved template on {{app}}. Meta caches approval per BSP, so you'll re-submit.\n2. **Contacts** — CSV import (see the contacts article).\n3. **Active chats** — there's no clean way to import live conversation history; usually you continue old threads in the old tool and start new ones here.\n4. **Webhooks** — point your CRM at our webhook URL. Old tool's signing key won't match ours.\n\nPlan ~3 days of overlap. Don't try to switch overnight.",
  },
  {
    title: 'Run your first WhatsApp blast',
    category: 'Campaigns',
    excerpt: 'Build a list, pick a template, schedule the send, and read the delivery report.',
    body: 'The four-step ritual:\n\n1. **Audience** — pick a contacts group or build a segment filter\n2. **Template** — must be approved + relevant (don\'t send "abandoned cart" to people who never had a cart)\n3. **Variables** — the dropdown shows every field your template references. Use defaults for blanks.\n4. **Schedule** — now, or pick a window\n\nAfter it sends, the campaign detail page shows delivery, read, reply, failed counts in real time. Failures are categorised — capacity, opted-out, invalid number — so you know what to fix.',
  },
  {
    title: 'Why my campaign read rate is low',
    category: 'Campaigns',
    excerpt: 'Common reasons messages get delivered but not opened — and how to fix each.',
    body: 'The five most common reasons:\n\n- **Wrong template category** — Marketing templates get filtered into "promotional" on the recipient side. Use Utility when possible.\n- **Bad timing** — sending at 3 am local time? Read rates drop.\n- **Fatigued audience** — too many promos in a week. Throttle.\n- **Stale segment** — list hasn\'t been cleaned in 6+ months. Stale numbers, opted-out users.\n- **Unclear "from"** — display name not recognised because the account isn\'t verified.\n\nEach one is fixable. Don\'t blame WhatsApp.',
  },
  {
    title: 'A/B test two template variants',
    category: 'Campaigns',
    excerpt: 'Split a group, fire both, and let {{app}} pick the winner.',
    body: '1. Create both templates (variant A and variant B)\n2. In campaign builder, enable **A/B test** toggle\n3. Pick the % split (usually 50/50)\n4. Pick the success metric — read, reply, or click\n\n{{app}} sends both during the same window. Winner is highlighted in the report. Save the winner as your "champion" for future campaigns.',
  },
  {
    title: 'Stop a running campaign cleanly',
    category: 'Campaigns',
    excerpt: 'Pause vs cancel — and what happens to messages already in-flight.',
    body: "**Pause** — stops new sends from leaving the queue. Already-sent messages stay sent. Resume later from the same place.\n\n**Cancel** — same as pause, but the campaign is marked closed; you can't resume. Reports stay.\n\nBoth happen near-instantly. Messages already handed to WhatsApp servers are out of our hands — they'll deliver as normal.",
  },
  {
    title: 'Why was my template rejected?',
    category: 'Templates',
    excerpt: 'The 6 most common rejection reasons and a checklist to avoid them.',
    body: 'Top reasons:\n1. **Wrong category** — Marketing content submitted as Utility (or vice versa)\n2. **Suggestive promo wording** — "Free!", "Click now!", "Hot deal!"\n3. **Missing opt-in context** — "Hi {{1}}" alone, no business name or reason\n4. **Bad variables** — `{{1}}` with no example value\n5. **Footer disallowed content** — links or phone numbers in the footer\n6. **Buttons exceeding limits** — max 3 quick-reply buttons OR 2 CTA buttons\n\nPre-flight checklist before submitting: business name visible, opt-in implied, no exclamation marks, variable examples set.',
  },
  {
    title: 'How to write a template that gets approved fast',
    category: 'Templates',
    excerpt: 'A working formula: greeting → context → action → footer. With examples.',
    body: "Formula that gets through Meta review in <24h:\n\n> Hi {{1}}, this is {{2}} from BrandName.\n> Your order #{{3}} is on its way — expected by {{4}}.\n> Track here: {{5}}\n> Reply STOP to opt out.\n\nWhy it works:\n- Names you (greeting)\n- Names yourself (context)\n- States the reason (action)\n- Has an opt-out (compliance)\n\nAdd a button only if it's a real CTA. Decorative buttons get flagged.",
  },
  {
    title: 'Variables, components, and CTAs explained',
    category: 'Templates',
    excerpt: 'When to use a header variable, when to use a button, and when to skip both.',
    body: "**Header** — used for the order number, customer name, or image. One variable max.\n\n**Body** — up to 7 variables. Use sparingly — every variable is a place to render incorrectly.\n\n**Footer** — static only. No variables, no links.\n\n**Buttons**:\n- Quick reply: max 3, for getting structured responses\n- CTA (URL): max 2, opens a link\n- Phone: max 1, opens dialler\n\nDon't mix quick replies + CTAs in the same template — Meta will reject.",
  },
  {
    title: 'Edit an approved template without re-submitting',
    category: 'Templates',
    excerpt: "When you can edit live, when you can't, and how to version safely.",
    body: 'Editable without re-approval: body wording (minor), button label text.\n\nRequires re-approval: header type, button type, variable count, language.\n\nSafest workflow: clone → edit clone → submit → wait for approval → archive the old one. Keeps your campaigns running while review is pending.',
  },
  {
    title: 'Stop auto-reply spam: cooldowns explained',
    category: 'Auto-reply',
    excerpt: 'Why a 60-second cooldown saves you from looking like a robot.',
    body: 'Without a cooldown, "hi" → "Hi! How can I help?" → "hi again" → "Hi! How can I help?" — infinite loop with bots, infinite spam with humans typing rapidly.\n\nSet cooldown to **60 seconds** per contact, per rule. The rule won\'t re-fire for that contact until the window expires. Saves you from looking like a broken machine.\n\nFor high-intent flows (refund request, "speak to human") set cooldown to 0 — fast iteration is more important than spam protection.',
  },
  {
    title: 'Fuzzy match vs exact match — which to use',
    category: 'Auto-reply',
    excerpt: 'When typo-tolerance helps and when it backfires.',
    body: '**Exact** — keyword is "track" — only fires on the literal word. Safer. Use for:\n- Compliance keywords (STOP, START)\n- Order-number triggers (#12345)\n\n**Fuzzy** — "track", "trak", "Track my order", "trakc" all match. Use for:\n- Customer help requests where typos are common\n- Common verbs ("status", "where", "help")\n\nDon\'t fuzzy-match "stop" — you\'ll opt people out who type "stopwatch".',
  },
  {
    title: 'Schedule auto-replies to business hours',
    category: 'Auto-reply',
    excerpt: 'Have a different message for nights and weekends.',
    body: 'Per-rule schedule: only fire Mon–Fri, 9am–6pm.\n\nOutside hours, set up a separate "we\'re closed" rule for the same trigger that promises a reply on the next business day.\n\nHonour the workspace timezone (set at `/settings → Branding`). All cron jobs respect it.',
  },
  {
    title: "Send at the recipient's local time",
    category: 'Scheduled sends',
    excerpt: 'How per-contact timezone delivery works and when to use it.',
    body: 'If your contacts have a timezone field, schedule a "9am local" send. Each contact gets it at their own 9am, not yours.\n\nWithout a timezone on the contact, we fall back to the **workspace timezone**.\n\nWhen to use: birthday wishes, daily quote, time-sensitive offers (lunch deals).\nWhen NOT to use: time-critical updates (a delivery slot, an OTP) — those should send immediately.',
  },
  {
    title: 'Recurring sends — daily, weekly, monthly',
    category: 'Scheduled sends',
    excerpt: 'Birthday wishes, weekly newsletters, monthly invoices on autopilot.',
    body: 'Three knobs:\n- **Frequency**: daily / weekly / monthly / cron expression\n- **End date**: optional, defaults to never\n- **Skip days**: e.g. "skip weekends"\n\nThe scheduler computes the next run on every save. Visible in the campaign list as "Next: Tue 09:00".',
  },
  {
    title: 'Pause a recurring send temporarily',
    category: 'Scheduled sends',
    excerpt: 'Going on holiday? Skip a week without losing the schedule.',
    body: 'On the scheduled-send detail page, click **Pause**. State is saved; next-run-at is cleared. When you click **Resume**, we compute the next valid slot from now.\n\nYou can also pre-schedule a pause: "Pause from Dec 23 to Jan 2". Useful for office shutdowns.',
  },
  {
    title: 'Verify a webhook signature',
    category: 'Webhooks',
    excerpt: 'How to check the X-Signature header and reject forged requests.',
    body: "Every webhook carries `X-Signature: sha256=<hex>`.\n\nThe hex is `HMAC-SHA256(secret, rawBody)`. Compute the same on your side and compare — use a constant-time string compare to avoid timing attacks.\n\n```php\n$expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);\nif (! hash_equals($expected, $request->header('X-Signature'))) {\n    abort(401);\n}\n```\n\nYour secret lives at `/settings → Webhooks` — never paste it into code.",
  },
  {
    title: 'Why my webhook keeps timing out',
    category: 'Webhooks',
    excerpt: '10-second timeout, 3 retries — what causes it and how to fix.',
    body: "We give your endpoint **10 seconds** to return a 2xx. If you don't, we retry up to 3 times with backoff (1s, 5s, 30s).\n\nCommon causes:\n- DB query in the request path that takes 8+ seconds → move to a queue\n- External HTTP call (Stripe, Salesforce) blocking → same\n- Cold start on a serverless function — first hit hangs\n\nBest practice: respond 200 OK immediately, do the work async. We don't care what your handler does — just that you ack quickly.",
  },
  {
    title: 'Replay a failed delivery',
    category: 'Webhooks',
    excerpt: 'You shipped a fix — now retrigger the events you missed.',
    body: 'On `/settings → Webhooks → Activity`, every delivery has a **Replay** button. Click → we re-fire the original payload to your endpoint, with a fresh signature.\n\nBulk replay: filter by date range + status=failed, then **Replay all**. Last 30 days of events are kept.',
  },
  {
    title: 'Build your first flow',
    category: 'Flows',
    excerpt: 'Triggers, actions, branches — connect them with the visual builder.',
    body: 'Three node types:\n- **Trigger** — keyword, inbound message, schedule\n- **Action** — send template, set tag, update contact, call webhook\n- **Branch** — condition (has tag? answered yes?) splits the flow into two paths\n\nStart with a simple flow: trigger on "menu" → send the menu template → branch on the user\'s reply.\n\nYou can drag-drop, save partial drafts, and test with a `/flows test` mode that simulates the trigger without touching real users.',
  },
  {
    title: 'Reading flow logs',
    category: 'Flows',
    excerpt: 'See every step of every run, why a branch was taken, and where it failed.',
    body: 'Each run has a timeline: trigger fired at 12:01, action sent at 12:01 (200ms), branch evaluated at 12:02, …\n\nHover any step for the full payload. Errors are red — click for the stack snippet (sanitised).\n\nReplay a failed run with **Replay from here** — picks up at the failed step instead of starting over.',
  },
  {
    title: 'Build a smart segment',
    category: 'Contacts',
    excerpt: 'Filter contacts by tags, custom fields, last activity, and more.',
    body: 'Segments are saved filters. Build one at `/contacts → Filters → Save as segment`.\n\nExample: "Last message sent > 30 days ago AND tag = customer AND country = IN" → segment named "Indian customers to win back".\n\nUse the segment as the audience for a campaign, or pin it to your dashboard for ongoing visibility.',
  },
  {
    title: 'Bulk-tag from search results',
    category: 'Contacts',
    excerpt: 'Select hundreds of contacts at once and apply tags or move to a group.',
    body: '1. Search or filter the contacts list\n2. Click the checkbox next to "Name" — selects everyone on this page\n3. **Select all matching** appears in the toolbar — click it to extend to all filter matches\n4. Pick the bulk action: tag, untag, move to group, export, delete\n\nBulk-tag is the fastest way to clean up imported contacts.',
  },
  {
    title: 'How metered billing works',
    category: 'Billing',
    excerpt: 'Per-message pricing, what counts as a "message", and where to track usage.',
    body: '**What counts**:\n- Sent: yes (each template send = 1 message)\n- Received: no (we never bill for inbound)\n- Failed sends: no\n- Read receipts: no\n\n**Pricing tiers**: defined per plan at `/admin/packages`. Usage tracked live at `/settings → Billing`.\n\nOverage is billed at the end of the cycle, not on the spot — but the **wallet** mechanism (top-up credits) shows real-time deductions for total transparency.',
  },
  {
    title: 'Change plan without losing data',
    category: 'Billing',
    excerpt: "Upgrade or downgrade is instant — here's what happens to your seats and history.",
    body: '**Upgrade**: takes effect immediately. We pro-rate the difference and charge it on the next renewal date.\n\n**Downgrade**: takes effect at the end of the current cycle. You keep all your data and seats until then.\n\nIf the new plan has fewer seats, the oldest non-admin agents are deactivated (not deleted — you can re-upgrade and re-activate).',
  },
  {
    title: 'Update payment method or VAT info',
    category: 'Billing',
    excerpt: 'Cards, banks, billing address, and tax IDs — all in one place.',
    body: "At `/settings → Billing`:\n\n- **Payment method**: card / bank / UPI / wallet\n- **Billing address**: name, address line, country (VAT calculation depends on this)\n- **Tax ID (VAT / GSTIN)**: for B2B invoices\n\nChanges apply to the next invoice; current invoices aren't re-issued automatically.",
  },
  {
    title: 'My message is stuck in queued',
    category: 'Troubleshooting',
    excerpt: "Diagnose why a send hasn't left the queue and how to unstick it.",
    body: 'Check, in order:\n\n1. **Device online?** `/devices` — green dot. If not, scan QR again.\n2. **Daily limit hit?** Meta enforces 250 / 1k / 10k / 100k tiers based on your business verification level.\n3. **Frozen rate limit?** Bursts above ~80 msg/min get throttled. We auto-retry.\n4. **Template approval pending?** Check `/templates`.\n5. **Contact opted-out?** Reply STOP at any time opts them out; subsequent sends fail with reason "opted_out".\n\nIf none of those, look at the `messages_outbound` row for the `failure_reason` column.',
  },
  {
    title: 'Read receipts not updating',
    category: 'Troubleshooting',
    excerpt: 'When ticks go grey instead of blue and how to refresh them.',
    body: 'Receipts only land if the recipient has read receipts ENABLED in their WhatsApp settings. If they\'ve disabled them, we can never know — show "delivered" forever.\n\nIf your status webhook is broken, we never receive the read event. Check `/settings → Webhooks → Activity`.\n\nPull-to-refresh: open the chat and scroll — we refetch status on demand.',
  },
  {
    title: '2FA is locking me out',
    category: 'Troubleshooting',
    excerpt: 'Lost your authenticator? Recover access via backup codes or support.',
    body: "Order of escalation:\n\n1. **Backup codes** — you saved 10 when you enabled 2FA. Use one.\n2. **Admin reset** — if you're a team member, the workspace owner can reset your 2FA.\n3. **Email support** — last resort. Requires ID verification (this is a security feature, not friction). Allow 24h.\n\nSet up 2FA on a NEW phone first before deleting the old one — saves the recovery dance.",
  },
];
