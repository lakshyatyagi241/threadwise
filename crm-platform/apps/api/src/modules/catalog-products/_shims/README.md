# Shims

Stand-ins for services other domains own and have not exported yet. Each is an interface plus a default implementation that
reads the tables the WaDesk schema migrations already created. When the owning domain exports the real service, bind it to
the same token in `catalog-products.module.ts` and delete the shim.

| Shim                                      | Real owner (WD domain)                            | Used by                        | Tracker row            |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------ | ---------------------- |
| `SenderDirectory` (devices, WABA configs) | whatsapp-devices-baileys, whatsapp-cloud-api-waba | WD-CAT-003, 008, 014, 015, 022 | blocked on WADEV, WABA |
| `AudienceDirectory` (contacts, groups)    | contacts-attributes-tags                          | WD-CAT-014, 015                | blocked on CON export  |
| `ShopDirectory` (`wa_storefronts`)        | storefront-builder (STORE)                        | WD-CAT-008, 009, 014, 022, 023 | blocked on STORE       |
| `ConversationMirror` (no-op by default)   | team-inbox-conversations (TIB)                    | WD-CAT-015, 023, 031           | blocked on TIB         |

Not behind a shim, listed because they are still open:

- The plan-first message billing (`OverflowBilling::consumeOne`) of each catalog message is blocked on wallet-message-billing.
- The inbound hooks that call `CatalogConciergeService` and `CatalogOrderAckService` belong to the inbox/webhook domain.
- The image upload control of the product form needs the storage domain (F5); products take `imageUrl` and `galleryUrls`.
