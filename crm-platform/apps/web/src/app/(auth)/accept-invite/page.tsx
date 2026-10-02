import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import {
  cleanSlug,
  firstParam,
  loadRegistrationConfig,
} from '@/features/auth-registration-security/guest/server';
import { AcceptInviteForm, InviteInvalid } from '@/features/workspaces-teams-tenancy';
import { loadInvitePreview } from '@/features/workspaces-teams-tenancy/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-teams-tenancy.accept');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Accept invitation (WD-WSP-016, 021): opened from the emailed link `?org=&token=`. An email-link landing page, so a
 * signed-in visitor is not redirected away. The design is fixed (like reset password), not variant-aware.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const org = cleanSlug(firstParam(sp.org));
  const token = firstParam(sp.token).trim();
  const t = await getTranslations('workspaces-teams-tenancy.accept');
  const config = await loadRegistrationConfig();
  const usable = Boolean(org) && token.length >= 16 && token.length <= 256;
  const preview = usable ? await loadInvitePreview(token, org) : null;

  const header = preview
    ? {
        eyebrow: t('eyebrow'),
        title: t('heading'),
        accent: preview.workspaceName,
        subtitle: preview.invitedBy
          ? t('subtitle', { invitedBy: preview.invitedBy, role: preview.roleName })
          : t('subtitleAnon', { role: preview.roleName }),
      }
    : {
        eyebrow: t('eyebrow'),
        title: t('invalidHeading'),
        accent: '',
        subtitle: '',
      };

  return (
    <GuestFrame page="forgot" variant={3} config={config} header={header}>
      {preview ? <AcceptInviteForm org={org} token={token} preview={preview} /> : <InviteInvalid />}
    </GuestFrame>
  );
}
