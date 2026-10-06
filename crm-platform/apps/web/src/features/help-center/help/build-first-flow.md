---
id: build-first-flow
title: Build your first flow
summary: Create a flow, set what starts it, add and connect steps, test it without sending anything, then publish it and watch its runs.
area: automation
order: 30
documents: []
gates:
  planFeature: automation
keywords: [flow, builder, trigger, keyword, publish, test, automation, nodes, chatbot]
---

## What it is for

A flow is an automatic conversation: a trigger starts it, then a chain of steps sends messages, asks questions, waits, branches and hands over to a person. You draw it on a canvas in the **Flows** screen of the Automation area. This guide takes you from an empty canvas to a live flow. To follow what flows do once they are live, see [Flow runs](help:flow-runtime-overview).

## Create a flow

Open **Flows** in the Automation area of the menu, then choose how to start:

- **Create flow**, then **Messaging flow** for WhatsApp, Instagram or Facebook (you choose the channel on the Trigger step), or **Call** for an AI voice call flow.
- **Start from a template**, then **Use template** on one of the starters. It is copied into your workspace as a draft that you customise.
- **Use AI prompt**, or **Generate with AI** inside the builder, to draft a flow from a description.
- **Import** to load a flow from a `.json` file you exported earlier.

The builder opens. Give the flow a name in the bar at the top.

## Set what starts it

1. Select the **Trigger** node, then **Edit** in the small bar above it, to open its settings.
2. Under **How does this flow start?**, pick one, for example **Keyword match (customer messages us)**, **Audience: when a tag is added**, **Audience: when contact joins a group**, **Commerce: when an order is placed** or **Manual: operator enrolls contacts**.
3. For a keyword trigger, choose **On specific keywords** and type them separated by commas, or **On any message (default route)**.
4. For a tag or group trigger, pick the tag or group. For a sender channel, pick the **number** the flow runs on. If you have more than one channel, **Channel** switches the node palette to what that channel supports.

## Add and connect steps

1. In the palette on the left, find a step. Search with **Search nodes**. Drag it onto the canvas, or double-click it to add it at the centre.
2. Useful steps to begin with: **Send message** (plain text), **Quick replies** (tap-to-pick buttons), **Ask question** (saves the reply into a variable), **Condition** (if or else), **Wait** (pause for a number of minutes), **Tag contact**, **Assign agent** (hand over to a human) and **End**.
3. Select a step and use **Edit** to fill it in. Use a saved variable in a later message by writing its name in double curly brackets.
4. Connect steps by dragging from the output dot of one step to the next. Select a connection to get a **Delete** option for it.
5. Useful keys: Ctrl or Cmd with Z to undo, Y to redo, D to duplicate the selected step, and Backspace or Delete to remove it.

## Test it

Select **Test**. A chat panel opens and the flow runs on the canvas in memory: you type as the customer and the flow answers, step by step. Nothing is sent to anyone, except that a **Webhook** step really calls its address. Use **Restart** to run it again after you change the flow.

## Save and publish

1. Select **Save**. The first save asks for a name. The pill in the bar shows **Draft**, **Unsaved** or **Published**.
2. Select **Publish** to make it live. Save and Publish both check the flow first. A step with no connection into it, a step that does not work on the flow's channel, or a Trigger with no number chosen is outlined and listed, and the save stops until you fix it.
3. Back on the Flows list, each card shows whether the flow is **Live**, **Paused** or a **Draft**, and offers **Pause** and **Resume**.

> The check does not look inside every step. A step with an empty message still saves, so always run **Test** before you publish.

## Access and limits

- You need the Automation feature on your plan and the right to view flows. Creating, editing, publishing and deleting each need their own right.
- Your plan can limit how many flows you can have. A duplicate counts too.
- Keep one trigger per flow. The Trigger is the starting point.

## If something looks wrong

- **Publish is refused.** Read the list of problems in the pop-up. Connect or delete the flagged steps, and pick a number on the Trigger.
- **The flow never starts.** Check that it is **Live** and not **Paused**, and that the trigger matches what you expect. See [Reading a flow run's log](help:flow-run-log).
- **A step is missing from the palette.** Each channel has its own steps. Switch the channel on the Trigger node.
