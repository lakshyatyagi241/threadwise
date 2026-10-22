---
id: extension-hooks
title: How an extension plugs in
summary: What an extension's extension.json can add, and where code hooks in (purchase hooks, event subscribers, module gates, provider ports).
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

This guide is for the person who installs or builds an extension. It explains what an extension can contribute through its manifest, and where code hooks in for everything the manifest does not cover. You manage installed extensions on the **Extensions** page in the admin console.

## What extension.json can add

The manifest is data only. It never carries code that runs inside the server. Every field except `slug` is optional.

- `slug`: the module's machine key and folder name. Use 1 to 64 lowercase letters, digits, `-` or `_`. A folder whose manifest slug differs from its folder name is ignored.
- `name`, `version`, `min_core`: shown on the extension's card and checked at install.
- `nav.admin`: entries added to the admin sidebar. Each needs a `key` and an `href` on this app; an entry missing either is skipped.
- `plan_features` and `plan_limits`: new switches and numeric caps that appear in the plan editor and can be granted by add-ons.
- `routes`: files inside the package that declare the module's routes. A path that is absolute or climbs out of the package is dropped.
- `migrate`: set to `false` to skip running the package's database migrations on install.

> There is no `init` or `events` field. The manifest cannot register a listener or run code at start-up. Behaviour that reacts to something happening is added in code, through the hook points below.

## Where code hooks in

1. **Purchase hooks.** A module that must hear about an add-on purchase registers a listener with `AddonFulfilmentHooks.register()` in its module's `onModuleInit`. The listener runs in the same transaction as the purchase, so it commits or rolls back with it. It can also follow renewals, failed renewal payments and the end of the subscription.
2. **Event subscribers.** To react to something that happened in the product (a conversation assigned, an order paid, and so on), register an outbox subscriber with `OutboxSubscriberRegistry.register()` in `onModuleInit`. It names the event types it wants and runs after the change is saved, so a slow or failing subscriber never blocks the original action. It may be delivered the same event more than once, so it must be safe to repeat.
3. **Module gates.** Put `@RequiresModule('<slug>')` with the module gate guard on a controller. Its routes answer "not found" while the module is switched off and serve again when it is switched back on, without a restart.
4. **Provider ports.** Code that talks to an outside service goes behind a port interface with one adapter per vendor, so swapping the vendor never touches the code that uses it.

## Switching a module off

Turning an extension off on the Extensions page flips its enabled flag. Gated routes stop answering and the data stays in the database. Turning it back on restores the routes. Other servers pick the change up within about half a minute.

## If something looks wrong

- **My manifest is ignored.** Check that the file is valid JSON, that it has a valid `slug`, and that the slug equals the folder name.
- **A sidebar entry is missing.** The entry needs both a `key` and an `href`; one without either is skipped without an error.
- **My listener never runs.** It must be registered in `onModuleInit` of a module that is loaded in the process that does the work, and event subscribers do their work in the worker process.
- **My route answers "not found".** The module is switched off, or its slug in `@RequiresModule` does not match the manifest.
