/**
 * bsp-billing-engine (BSP): the WhatsApp reseller slice. The platform's Meta credit line is shared onto customer WABAs, each
 * workspace chooses who bills it for messages, and the operator reads the reseller P&L.
 * See docs/wadesk-port/inventory/bsp-billing-engine.md and docs/api/bsp-billing-engine.md.
 */
export * from './reseller';
