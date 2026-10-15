'use client';

import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';

/** A value the person pastes somewhere else (the WeChat console), with a copy button. */
export function CopyField({
  label,
  value,
  trailing,
}: {
  label: string;
  /** Null while it is hidden or loading: the row then shows `placeholder`. */
  value: string | null;
  trailing?: React.ReactNode;
}) {
  const t = useTranslations('wechat.channel');
  const { toast } = useToast();
  const copy = async () => {
    if (value === null) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(t('copied'), 'success');
    } catch {
      toast(t('failed'), 'danger');
    }
  };
  return (
    <div className="flex items-start gap-2 text-[10.5px]">
      <span className="w-11 shrink-0 pt-0.5 font-mono text-muted-foreground">{label}:</span>
      <span className="min-w-0 flex-1 break-all font-mono text-foreground">
        {value ?? t('tokenHidden')}
      </span>
      {trailing}
      <button
        type="button"
        onClick={() => void copy()}
        disabled={value === null}
        className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-40"
      >
        {t('copy')}
      </button>
    </div>
  );
}
