'use client';

import type { PublicForm as PublicFormData, PublicFormSubmissionStatus } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { FORM_CSS } from '../lib/form-css';
import { safeRedirect } from '../lib/share';
import { tokensToCssVars } from '../lib/theme';
import { safeHtml } from '../lib/rich-text';
import { submissionStatus } from './api';

const POLL_MS = 3000;
/** About two minutes of waiting; after that the page stops asking and says what to do (the webhook may be late, the money is not lost). */
const MAX_POLLS = 40;

type View =
  | { kind: 'waiting'; slow: boolean }
  | { kind: 'missing' }
  | { kind: 'paid'; next: PublicFormSubmissionStatus['next'] }
  | { kind: 'expired' | 'failed'; payUrl: string | null };

/**
 * Where the gateway sends the visitor after paying (`/f/<key>/pay-return?s=<receipt>`). The redirect back is NEVER proof of payment:
 * this page only asks the API where the payment stands, which the gateway's own verified notification set, and shows "confirming" until
 * it is `paid`. Then it shows the form's thank-you (a message, or a redirect to the owner's own page).
 */
export function PayReturn({ form, token }: { form: PublicFormData; token: string }) {
  const t = useTranslations('web-forms.public');
  const [view, setView] = useState<View>({ kind: 'waiting', slow: false });
  const vars = useMemo(() => tokensToCssVars(form.theme) as CSSProperties, [form.theme]);

  useEffect(() => {
    let stopped = false;
    let polls = 0;
    let timer: number | undefined;
    const tick = async () => {
      polls += 1;
      const status = await submissionStatus(form.key, token);
      if (stopped) return;
      if (status === 'missing') return setView({ kind: 'missing' });
      if (status?.payment === 'paid' || status?.payment === 'not_required') {
        setView({ kind: 'paid', next: status.next });
        const to = status.next?.type === 'redirect' ? safeRedirect(status.next.url) : null;
        if (to) window.location.assign(to);
        return;
      }
      if (status?.payment === 'expired' || status?.payment === 'failed') {
        return setView({ kind: status.payment, payUrl: status.payUrl });
      }
      if (polls >= MAX_POLLS) return setView({ kind: 'waiting', slow: true });
      timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [form.key, token]);

  const dir = form.settings.dir ?? (form.settings.locale === 'ar' ? 'rtl' : 'ltr');
  return (
    <div
      className="wf-root"
      style={vars}
      data-mode={form.theme.mode}
      data-embed="0"
      data-layout="classic"
      data-labels="top"
      data-button={form.theme.buttonStyle}
      data-button-width={form.theme.buttonWidth}
      data-radius={form.theme.radius}
      dir={dir}
      lang={form.settings.locale}
    >
      <style>{FORM_CSS}</style>
      <div className="wf-shell">
        <div className="wf-card">
          <div className="wf-success" role="status" aria-live="polite" data-testid="pay-return">
            {view.kind === 'waiting' && (
              <>
                <h2>{view.slow ? t('payReturn.slowTitle') : t('payReturn.confirmingTitle')}</h2>
                <p>{view.slow ? t('payReturn.slowBody') : t('payReturn.confirmingBody')}</p>
              </>
            )}
            {view.kind === 'paid' && (
              <>
                <span className="wf-tick" aria-hidden="true">
                  &#10003;
                </span>
                <h2>{t('payReturn.paidTitle')}</h2>
                {view.next?.type === 'message' && view.next.message && (
                  <div dangerouslySetInnerHTML={{ __html: safeHtml(view.next.message) }} />
                )}
                {view.next?.type === 'redirect' && (
                  <p>
                    <a href={safeRedirect(view.next.url) ?? '#'} rel="noopener noreferrer">
                      {t('continue')}
                    </a>
                  </p>
                )}
              </>
            )}
            {(view.kind === 'expired' || view.kind === 'failed') && (
              <>
                <h2>{t(`payReturn.${view.kind}Title`)}</h2>
                <p>{t(`payReturn.${view.kind}Body`)}</p>
                {view.payUrl && safeRedirect(view.payUrl) && (
                  <p>
                    <a href={safeRedirect(view.payUrl) ?? '#'} rel="noopener noreferrer">
                      {t('payReturn.tryAgain')}
                    </a>
                  </p>
                )}
              </>
            )}
            {view.kind === 'missing' && (
              <>
                <h2>{t('payReturn.missingTitle')}</h2>
                <p>{t('payReturn.missingBody')}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
