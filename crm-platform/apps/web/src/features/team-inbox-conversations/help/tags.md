---
id: inbox-tags
title: Conversation tags
summary: Create colored tags, put them on conversations and filter the inbox by them. They are the same tags you use on contacts.
area: settings
order: 52
documents: [tile:inbox-tags]
keywords: [tags, conversation tags, labels, categories, organize, filter, conversations, color]
---

## What it is for

Tags mark conversations so your team can sort, find and filter them, for example Refund, Billing or Follow up. There is one tag library for the whole workspace and it is used in two places:

- A **contact tag** describes the person: VIP, lead, region.
- A **conversation tag** describes this thread: billing, refund, urgent.

Both come from the same list. A tag you create here also appears on contacts, and one deleted from either place is gone from both. Earlier versions called conversation tags "labels"; that name is retired and everything now says tag.

## How to use it

1. Open **Settings**, then **Conversation tags**. The list shows every tag, its description and how many conversations carry it.
2. Under **New tag** type a name, pick a color (a hex color such as `#075E54`, or a color name) and, if you like, a description. Select **Create tag**.
3. To change a tag, select **Edit**, change the name, color or description and select **Save changes**. Names are unique, ignoring capital letters.
4. In the inbox, open a conversation. The side panel has two separate groups: **Contact tags** (read-only here) and **Conversation tags**. In **Conversation tags** select **Tag** and tick the tags that apply, or select the **×** beside a tag to take it off. The tags on the conversation also show under its name and in the list.
5. To change the tags of the person, select **Edit on contact** in the **Contact tags** group. It opens the contact.
6. To find conversations, open the **Tags** filter above the list and tick one or more tags. A conversation shows when it carries any of the ticked tags. The switch at the top of the filter chooses where to look: **Conversation tags** (the tags on the thread) or **Contact tags** (the tags on the person it is with). The filter and the switch are kept in the address of the page (`?tags=` and `?tagScope=`), so you can reload or share the filtered view. Older links that use `?labels=` still work.
7. To tag many conversations at once, select **Select** above the list, pick the conversations, then use **Tag** in the bar to add or remove one tag on all of them.

## Options and settings

- **Delete** removes the tag from every conversation and every contact. The confirmation tells you how many conversations carry it. This cannot be undone.
- Typing a new name in the **Tag** menu creates the tag and puts it on the conversation, but only for people who may manage tags.
- The old address `/inbox/labels` still opens this screen.

## Plan and access

Putting tags on conversations needs the right to tag conversations. Creating, renaming, recoloring and deleting tags needs the right to manage tags. Editing a contact's own tags needs the right to edit contacts. Anyone who can open the inbox can see the tags and filter by them. Tags count toward your plan's limit on tags, shared with contacts.

## If something looks wrong

- **"A tag with that name already exists."** Names are unique, ignoring capital letters. Use the existing tag.
- **You cannot create another tag.** Your plan's tag limit is reached. Delete one you no longer use or ask the workspace owner to upgrade.
- **There is no Tag button in a conversation.** You do not have the right to tag conversations.
- **The Contact tags group is empty.** The contact has no tags yet, or the conversation has no contact record.
- **Someone else changed the tag first.** The list reloaded. Try again.
