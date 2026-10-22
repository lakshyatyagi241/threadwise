# Return to bot: how to check it on the deployed site

Nobody has checked this in a browser yet. The API, the worker and the screens are covered by automated tests (see the pull request), but the
screens, the realtime line in the thread and a real WhatsApp delivery were never opened by a person. This guide is for the team to do that on
the deployed site. Allow 20 minutes. You need: an admin login, a second login (an agent who may reply and claim), a test WhatsApp number or the
simulator channel, and a contact you can message from a second phone.

## 1. Build the flow (Advanced canvas)

1. Open **Flows**, create a flow that starts on the word `help` (keyword trigger on your test channel).
2. Add a **Message** step: "Hello from the bot".
3. Add a **Human handoff** step after it. Choose **A team** (a team that receives conversations) and a reason.
4. Connect its exit **waiting in queue** (and **assigned**) to an **End** step.
5. Add a second **Message** step, "Welcome back, anything else I can help with?", and connect the handoff's **returned to the bot** exit to it.
6. In the handoff step write a **Message to the contact when the bot is back**: `Hi {{name}}, I am back.`
7. Open the step on the canvas: the card should show a line **When the bot is back: "Hi ..."**. Delete the wire from the returned exit: a warning
   should say the message is only sent when the exit is connected. Connect it again.
8. Publish and switch the flow on.

Expected: the step lists four exits, the fourth being **returned to the bot (optional)**.

## 2. Simple builder

1. Open the same flow in **Simple** if it opens there (a flow that uses the other exits only opens in Advanced).
   A flow with only the returned exit opens in Simple: the Human handoff step shows **When a teammate gives the chat back, continue at** and the message field.
2. Pick a step, save, reopen in Advanced: the wire from **returned to the bot** is there.

## 3. The happy path

1. From the second phone send `help` to the test channel. You get "Hello from the bot".
2. Log in as the agent. Open **Inbox > Waiting**: the chat is there with the strip "Waiting for a person".
3. Claim it (the bot stays silent if the contact writes now).
4. Press **Return to bot**.

Expected, in order:

- A toast: **The bot continues the flow.**
- Within a second a grey line in the thread: **Bot is back, returned by <your name>. The flow continues.** (no refresh needed; open the same chat in a second browser to see it appear in realtime).
- On the phone: "Hi <name>, I am back." and then "Welcome back, anything else I can help with?".
- A second grey line in the thread: **The flow continued from the "returned" exit. The message to the customer was sent.**
- **Timeline** tab: "Given back to the bot by <you>" and "The bot continued the flow".
- Pressing **Return to bot** again is not possible (the strip changes); if you send the request twice quickly, the phone gets each message once.

## 4. The unhappy paths

| Do this                                                                                                               | Expect                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the wire from **returned to the bot**, publish, repeat section 3                                               | Toast **The bot will answer the customer's next message.** (or, when no flow waits for this contact, **The bot is back on. It answers the next message only if a default flow is set.**). Nothing is sent. The thread line says the same. |
| Send a chat to the queue by hand (**Send to queue**) and press **Return to bot**                                      | The "next message" toast; no flow starts                                                                                                                                                                                                  |
| Make the 24 hour window close (wait 24 hours, or on the simulator choose a closed window) and press **Return to bot** | The flow continues but the line says **The message to the customer was skipped: the 24 hour window is closed.**                                                                                                                           |
| Unpublish the flow, then press **Return to bot**                                                                      | The "next message" toast; the Details trace or timeline does not show a resumed flow                                                                                                                                                      |
| Two agents: agent A presses **Return to bot**, agent B claims at the same instant                                     | One of them wins; if B wins the line says **The flow was not resumed: a person took the chat again.**                                                                                                                                     |
| Press **Return to bot** twice                                                                                         | Second toast **The bot already has this conversation.**, nothing sent twice                                                                                                                                                               |

## 5. Languages

Switch the app to Arabic and one other language and repeat section 3: the toast and both lines must be in that language (Arabic reads right to left).

## What to report

For anything that differs: the flow, the time, the conversation link, a screenshot of the thread and the Timeline tab. The API log line
`[FLR] Return to bot could not continue the flow` or `the "bot is back" message to the customer was not sent` names the cause.
