/**
 * Public surface of the add-ons domain (ADD). Other modules import from here, never from the files behind it.
 *
 *   ModuleRegistryService / ModuleGateGuard / RequiresModule   is an installable module on, and what it contributes
 *   AddonEntitlementService                                    plan gates that must count a workspace's add-ons
 *   AddonFulfilmentService                                     checkout: a paid order becomes the workspace's add-on
 *   AddonFulfilmentHooks                                       a domain that must hear, in the same transaction, about an add-on purchase
 *   EngineConnectionService                                    the Instagram / email engine connections (IG, MAIL)
 */
export { AddonsExtensionRegistryModule } from './addons-extension-registry.module';
export { ModuleRegistryService } from './module-registry.service';
export { ModuleGateGuard, RequiresModule } from './module-gate';
export { AddonEntitlementService } from './addon-entitlement.service';
export {
  AddonFulfilmentHooks,
  type AddonFulfilmentListener,
  type AddonTermEvent,
  type AddonTermEventKind,
  type FulfilledAddon,
} from './addon-fulfilment-hooks';
export {
  AddonFulfilmentService,
  type FulfilInput,
  type FulfilResult,
} from './addon-fulfilment.service';
export {
  ExtensionTokenService,
  hashExtensionToken,
  type IssuedExtensionToken,
} from './extension-token.service';
export { EngineConnectionService } from './engine-connections.service';
export { mergeFeature, mergeLimit, type PlanFacts } from './entitlement-merge';
export { addonLiveSql } from './addon-grants';
