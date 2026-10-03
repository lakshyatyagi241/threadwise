/** The three platform permissions of the WhatsApp provider registry (platform-staff keys, see docs/api/whatsapp-providers.md). */
export const WAP_PERMISSIONS = {
  view: 'platform.whatsapp_providers.view',
  manage: 'platform.whatsapp_providers.manage',
  switch: 'platform.whatsapp_providers.switch',
} as const;

export type WapPermissionName = keyof typeof WAP_PERMISSIONS;

export interface WapAccess {
  /** Read providers, assignments and the last test result. */
  view: boolean;
  /** Add, change, enable, disable, archive, default, live test, assignments. */
  manage: boolean;
  /** Move a workspace's connected numbers to another provider. */
  switch: boolean;
}

/** From the caller's own permission map (`GET /v2/platform/me/permissions`). A missing key counts as not held. */
export function wapAccess(permissions: Readonly<Record<string, boolean>> | undefined): WapAccess {
  const held = (name: WapPermissionName) => permissions?.[WAP_PERMISSIONS[name]] === true;
  return { view: held('view'), manage: held('manage'), switch: held('switch') };
}

/** The first permission of `needed` the caller lacks, or null when all are held. Names the key for the no-access page. */
export function missingPermission(
  access: WapAccess,
  needed: readonly WapPermissionName[],
): string | null {
  const missing = needed.find((n) => !access[n]);
  return missing ? WAP_PERMISSIONS[missing] : null;
}
