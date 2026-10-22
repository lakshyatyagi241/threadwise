---
id: extension-hooks
title: How an extension plugs in
summary: What an extension's manifest file can add to the platform, and what needs a developer's code instead.
area: getting-started
order: 50
audience: operator
documents: []
routes: [/admin/extensions]
keywords:
  [
    extension,
    module,
    extension.json,
    init,
    event,
    hook,
    outbox,
    subscriber,
    addon,
    provider,
    port,
    requires module,
  ]
---

## What it is for

This guide is for the person who installs an extension, and for the developer who builds it. It explains what an extension can add through its manifest file, and what needs a developer. You manage installed extensions on the **Extensions** page in the admin console.

## What extension.json can add

The manifest is a plain settings file. It never carries code that runs inside the platform. Every field except `slug` is optional.

- `slug`: the module's short name, also its folder name. Use 1 to 64 lowercase letters, digits, `-` or `_`. A folder whose manifest slug differs from its folder name is ignored.
- `name`, `version`, `min_core`: shown on the extension's card and checked at install.
- `nav.admin`: entries added to the admin menu. Each needs a `key` and an `href`; an entry missing either is skipped.
- `plan_features` and `plan_limits`: new switches and numeric caps that appear in the plan editor and can be granted by add-ons.
- `routes`: files inside the package that declare the module's routes. A path that is absolute or climbs out of the package is dropped.
- `migrate`: set to `false` to skip preparing the package's stored data on install.

> There is no `init` or `events` field. The manifest cannot react to events or run code at start-up. Behaviour that reacts to something happening needs a developer to add it in code.

## What needs a developer

1. **Add-on purchases.** A module can be told when its add-on is bought. This succeeds or fails together with the purchase. It can also follow renewals, failed renewal payments and the end of the subscription.
2. **Reacting to events.** A module can react to something that happened in the product (a conversation assigned, an order paid, and so on). It runs after the change is saved, so a slow or failing reaction never blocks the original action. It may be told about the same event more than once, so it must be safe to repeat.
3. **Switching a module off.** A module's pages answer "not found" while the module is switched off and work again when it is switched back on, with no restart.
4. **Outside services.** A module that talks to an outside service keeps each vendor separate, so swapping the vendor does not change the rest of the module.

## Switching a module off

Turning an extension off on the Extensions page switches it off. Its pages stop answering and its data is kept. Turning it back on restores the pages. The change reaches everywhere within about half a minute.

## If something looks wrong

- **My manifest is ignored.** Check that the file is correctly written, that it has a valid `slug`, and that the slug equals the folder name.
- **A sidebar entry is missing.** The entry needs both a `key` and an `href`; one without either is skipped without an error.
- **My reaction to an event never runs.** Ask your developer to check that it is registered, and note that event reactions run in the background, a moment after the event.
- **My route answers "not found".** The module is switched off, or its slug does not match the manifest.
