# Inbox

The conversation list (`inbox-screen.tsx`) and one conversation (`thread-screen.tsx`, route `/conversation/[id]`), laid out like the
reference mobile app. Every control calls the real API; a control with nothing behind it is left out and recorded below.

## A conversation

| Part                   | What it is                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header                 | back, avatar and name, the channel (its logo and the word for its kind), the reply-window timer, resolve or reopen, and the three dots                                                                                                                 |
| Timer ring             | the 24-hour reply window (`detail.window.expiresAt`): hours and minutes left in the middle, a ring that empties (green, amber in the last hour, red when closed). Plain views, no drawing library                                                      |
| Three dots             | Assign to me (`POST /inbox/conversations/:id/assign`, `inbox.conversation.assign` or `assign_self`), Unassign (`assign`), Mark as pending and Close (`POST .../status`, `inbox.conversation.resolve`); only the moves that are legal and permitted     |
| Assign labels          | the contact's tags (`GET /tags`, `GET/POST/DELETE /contacts/:id/tags`): tick to put one on or take one off, type a name to make a new one (`record.tags.create`). Needs a contact on the conversation, `record.contacts.update` and `record.tags.read` |
| Message bubbles        | words, the picture (loaded with the person's token), files as tiles (name and size), places, shared contacts, a template's header, footer and buttons, buttons an agent sent (web links open)                                                          |
| Bar under the messages | a message box; while an AI agent has the conversation and no person does, "This is a bot conversation." and **Assign to yourself** instead (the box returns once a person has it)                                                                      |

Pictures: the API's link (`/api/v2/media/<token>`, made for the web app's proxy) is rewritten to the API and fetched with
`Authorization: Bearer`. React Native 0.86 on Android sends the headers of an image source only when the source is a **list**
(`source={[{ uri, headers }]}`); given one object it drops them silently and the picture is refused with 401. Do not "simplify" it.

## In the reference screen, not built here (recorded, not dropped)

| Reference control           | Why it waits                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "Bot" button                | the API has no route to hand a conversation to, or take it from, an AI agent from the app; `assignment.aiAgent` can only be read     |
| Opening files               | documents, videos and audio are drawn as tiles; opening or saving them needs a download and a viewer (`mobile-native-capability`)    |
| Template buttons' links     | a template message does not store where its buttons go, so they are drawn, not pressable (a link button the agent sent is pressable) |
| Sending media and templates | the message box sends text; picking a file or a template needs a picker and the template list                                        |
