# Website chat bot builder

How a website chat bot is built, customised, deployed and run. Covers the flow builder (Build), the Customize tab, Deploy, the
chat window a visitor sees, and the pieces behind them.

Related: the user-facing guide is `apps/web/src/features/chatbot-widget/help/web-bots.md`. The Geta console is the functional reference
for the settings (`geta-chatbot-console-frontend`, `geta-chatbot-frontend-widget`); the UI is our own.

## 1. What it is

A **website chat bot** is a flow (`flows.flow_type = 'web'`) with one widget (`chatbot_widgets.flow_id`). A visitor writes in a chat
window on the author's site; the flow answers. One bot, one channel, chosen when the bot is created. A WhatsApp bot (`flow_type =
'chat'`) shares the same screens but has its own Customize (the website button that opens WhatsApp).

Screens and routes:

| Where | What |
| --- | --- |
| Flows, **New bot**, Website chat | create a website bot (Simple or Advanced builder, by workspace setting) |
| Settings, Channels, **Website chat** | list of website bots with their widget state |
| `/flows/simple/<id>` and `/flows/builder/<id>` | the builder, tabs **Build, FAQs, Customize, Deploy** |
| `/ai-studio` | landing page that links to flows, FAQs and the bot channels |

Customize and Deploy are locked until the bot has been saved once. Publish is the only action that makes it live, and it is refused
until Customize has been saved once (server side for web bots).

## 2. Build

Two builders edit the same graph (`flows.graph`: nodes, edges, vars).

- **Simple builder**: steps in parts ("flows" in the left list). Steps that end a part (buttons, list) route each button to a step.
  Under a set of buttons there is a "+" and a chip per button that has no step yet; both start a new part tied to that button.
  Clicking outside the open step closes it and saves.
- **Advanced builder**: the canvas, palette and inspector.

Node types a website bot can use (`WEB_CAPABLE` in the node catalogue): message, media, ask (text, name, email, phone, number,
letters and numbers, date; phone can verify by one-time code), ask for file, link / call / email buttons (`cta`), carousel, reply
buttons, condition (AND / OR rules), delay, webhook, AI reply, FAQ answer, end. Anything else is left off the palette for web.

Buttons:
- reply buttons (up to 3, longer menus are numbered text), link buttons (up to 3), carousel cards (up to 10, 2 buttons each);
- a button can **hand over to a person** (a team and a note);
- on a website bot a reply or link button can carry an **icon** (optional). The picture is uploaded to the bot (slot `bi<8 hex>`)
  and its address is kept on the button (`optionIcons[i]` on a buttons node, `actions[i].icon` on a cta node).

## 3. Customize

Layout: icon rail (Brand, Window, Launcher, Behaviour, Launch), settings panel, live preview. The preview is the real chat page
(`GET flows/:id/widget/preview-page`) fed the unsaved settings by `postMessage`; the closed launcher is the real loader on a stand-in
page (`POST flows/:id/widget/preview-embed`). Surfaces: chat window, expanded, phone, closed launcher.

All look settings live in `chatbot_widgets.launcher` (jsonb, contract `widgetLauncherSchema`); the same object is saved, read, and
resolved into the public config. Adding an option never needs a migration: add a key with a default in the schema, read it in the chat
page or loader, give the screen a control.

| Section | Settings |
| --- | --- |
| Brand | company logo, chatbot avatar, chat background, bot name, primary colour (header, launcher, buttons together), header background (solid, diagonal, vivid, dusk, soft sweep), body corners, per-colour fine tuning |
| Window | size (compact, standard, tall, wide), reply button fill and shape, typeface, text size, hover colour, text direction, round icons, copy and thumbs, expand |
| Conversation tools | notification block (bell, 4 styles, up to 5 cards), quick menu (lists or blocks, up to 5), banner (up to 5 pictures or videos), quick replies (up to 4); each has an enable switch |
| Launcher | side, gaps from the edge (desktop and phone), launcher icon, callout (5 styles, text, picture), animation, unread dot |
| Behaviour | opening line, intake (name, email, phone), open by itself after N seconds, sound and volume, voice conversation, read aloud, devices (desktop, tablet, phone), only on these websites, floating chat window |
| Launch | send button label and colours |

**Link to flow**: a quick reply, menu entry or banner slide can start the bot at one of its steps. The tap sends a message whose
`tap_id` is `go:<flow uuid>:<node id>`; the inbound listener (`FlowInboundService.startAt`) checks the flow is live on this channel
and starts a run at that node (`LaunchInput.startNodeId`), replacing the run in progress.

**Pictures**: PNG, JPEG, WebP, GIF or SVG up to 1 MB. Stored in `flow_widget_assets` (one row per flow and slot, bytea, RLS) and
served at `/widget-assets/<flow uuid>/<slot>?v=<etag>` with a long cache. Slots: `logo, popup, avatar, background`, `nb0..nb4`
(notification cards), `qm0..qm4` (menu), `bn0..bn4` (banner), `bi<8 hex>` (button icons). An SVG is accepted only after
`isSafeSvg` (no script, event handlers, foreign content, external references, entities) and is served with
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox`.

## 4. Deploy

Deploy shows the embed code (`<script defer src=".../widget/<token>/embed">`) and the standalone chat page link. Nothing is deployed
from there: the bot goes live when published. A visitor on a site not in "only on these websites" gets no chat (origin check).

## 5. At run time

```
host page ── embed.js (loader) ── iframe: /widget/<token>/chat  (chat-page.ts)
                                        │  GET api/config, GET api/history (poll), POST api/message / upload / feedback
                                        ▼
                         chatbot-widget module ── ingest queue ── flow runtime (worker)
                                        ▲                              │ replies stored on the thread with meta
                                        └──────────────────────────────┘ widget_buttons, widget_media, widget_input,
                                                                          widget_links, widget_cards, feedback
```

- **Loader** (`embed-script.ts`, `buildEmbedScript`): launcher, panel, callout, animation, placement per device, devices on or off,
  auto-open delay, and the floating window.
- **Chat page** (`chat-page.ts`, text in `chat-page-text.ts`, 21 languages): server rendered; paints from the public config and
  history; renders text, files, reply buttons (with icons), link buttons, carousel, input hints (date picker, file attach), the
  conversation tools, voice, sound.
- **Reply routing**: a tap sends the button id (`b_<node>_p<i>`); the reply router matches it to the node's menu; carousel and
  buttons share `isMenuNode`.
- **Floating window**: Document Picture-in-Picture (Chrome, Edge) is only available to the top-level page and on a click, so the loader
  owns it; the chat page asks by `postMessage`. After the visitor's first message the window asks once about notifications; when the
  visitor leaves the tab a notification offers to continue. Browsers decide when a window may open.

## 6. Data and API

Tables: `flows`, `chatbot_widgets` (look in `launcher`, `allowed_domains`, `flow_id`, `customized_at`), `flow_widget_assets`.
Migrations: `20261114090000_wgt_flow_bots`, `20261118090000` (assets), `20261119090000` (avatar, background, SVG),
`20261119090100` (item pictures), `20261119090200` (button icons).

Admin API (`flb.flows.*`): `GET/PUT flows/:id/widget`, `GET flows/:id/widget/preview-page`, `POST flows/:id/widget/preview-embed`,
`POST/DELETE flows/:id/widget/assets/:slot`, `GET widgets/flow-bots`.
Public API (no sign-in, token in the path): `GET widget/:token/embed`, `chat`, `api/config`, `api/history`, `api/media/:id`;
`POST api/message`, `api/upload`, `api/feedback`; `GET widget-assets/:flowUuid/:slot`.

Contracts: `packages/contracts/src/chatbot-widget/` (`launcher.ts`, `widget.ts`) and `flow-builder-editor/` (`node-catalogue.ts`,
`carousel.ts`, `runtime-shape.ts`).

## 7. Where the code is

| Piece | Path |
| --- | --- |
| Customize screen | `apps/web/src/features/chatbot-widget/components/flow-widget-customize.tsx` and `web-*.tsx` cards |
| Builder screens | `apps/web/src/features/flow-builder-editor/builder/` (`simple/simple-screen.tsx`, `builder-screen.tsx`, `web-bot-tabs.tsx`) |
| Simple model | `apps/web/src/features/flow-builder-editor/lib/simple-model.ts` |
| Chat page, loader | `apps/api/src/modules/chatbot-widget/chat-page.ts`, `embed-script.ts` |
| Assets | `asset-slots.ts`, `svg-safe.ts`, `widgets.service.ts` (`uploadAsset`) |
| Runtime | `apps/api/src/modules/flow-runtime-engine/` (`nodes.ts`, `flow-sender.service.ts`, `reply-router.ts`, `triggers/inbound.service.ts`) |

## 8. Testing

- API unit: `test/unit/chatbot-widget` (launcher schema, embed and chat page scripts parse, SVG checker, floating window).
- API e2e: `test/e2e/chatbot-widget` (widget, assets, preview endpoints, conversation tools) and
  `test/e2e/flow-runtime-engine/web-bot.e2e.spec.ts` (buttons, icons, files, links, carousel, hand-over, condition, OTP, jump to a step).
- Web: `src/features/chatbot-widget`, `src/features/flow-builder-editor` (models, tabs, button icon).
- Every text change needs all 21 locales (`i18n-translate-sync`); every screen change needs its help guide.

## 9. Limits and known gaps

- The floating window was not tried in a real browser during development; it is Chrome and Edge only.
- Bot settings of the Geta console (auto replies, prompt, languages, intents, blacklist) are separate modules, not part of Customize.
- Click outside to close and save is in the Simple builder only.
- A button that leads to a step in another bot, or a "flow" picker, does not exist: a bot jumps only into its own steps.
