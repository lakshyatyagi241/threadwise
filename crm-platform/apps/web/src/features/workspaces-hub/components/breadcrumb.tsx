import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** Admin > Workspaces > page; the last crumb is the current page. */
export function Breadcrumb({ current }: { current?: string }) {
  const t = useTranslations('workspaces-hub.crumb');
  return (
    <nav aria-label={t('label')} className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/admin" className="hover:underline">
            {t('admin')}
          </Link>
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">&gt;</span>
          {current ? (
            <Link href="/admin/workspaces" className="hover:underline">
              {t('workspaces')}
            </Link>
          ) : (
            <span aria-current="page" className="text-foreground">
              {t('workspaces')}
            </span>
          )}
        </li>
        {current && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">&gt;</span>
            <span aria-current="page" className="text-foreground">
              {current}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
