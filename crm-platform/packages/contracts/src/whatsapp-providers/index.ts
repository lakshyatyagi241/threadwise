/**
 * whatsapp-providers: the platform-level registry of WhatsApp providers (which BSP the SaaS sends through), the workspace
 * assignment, the per-number switch and the tenant-safe provider info. An owner-requested extension of the WABA module
 * (docs/threadwise-port/parity/product-extensions.md); operator API in docs/api/whatsapp-providers.md.
 */
export * from './enums';
export * from './errors';
export * from './header-templates';
export * from './base-url';
export * from './presets';
export * from './providers';
export * from './assignments';
