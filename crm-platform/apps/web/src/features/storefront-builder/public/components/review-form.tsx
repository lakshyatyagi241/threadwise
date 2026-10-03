'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { postReview } from '../api/client';
import { useStore } from './store-provider';

type Msg = { tone: 'ok' | 'error'; text: string } | null;

/** "Write a review" (TW-STORE-016): posts a pending review; it shows on the page only once the merchant approves it. */
export function ReviewForm({ productId }: { productId: string }) {
  const t = useTranslations('shopPublic');
  const { shop } = useStore();
  const uid = useId();
  const [name, setName] = useState('');
  const [rating, setRating] = useState('5');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMsg({ tone: 'error', text: t('review.nameRequired') });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await postReview(shop.slug, {
      productId,
      name: trimmed,
      rating: Number.parseInt(rating, 10),
      body: body.trim() || null,
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ tone: 'ok', text: res.data.message || t('review.thanks') });
      setName('');
      setBody('');
      return;
    }
    if (res.kind === 'network') setMsg({ tone: 'error', text: t('review.network') });
    else if (res.code === 'RATE_LIMITED') setMsg({ tone: 'error', text: t('errors.rateLimited') });
    else setMsg({ tone: 'error', text: res.message ?? t('review.failed') });
  };

  return (
    <form
      className="sf-review-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{t('review.write')}</h3>
      <label htmlFor={`${uid}-name`} className="sf-sr">
        {t('review.name')}
      </label>
      <input
        id={`${uid}-name`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('review.name')}
        maxLength={120}
        autoComplete="name"
      />
      <label htmlFor={`${uid}-rating`} className="sf-sr">
        {t('review.rating')}
      </label>
      <select id={`${uid}-rating`} value={rating} onChange={(e) => setRating(e.target.value)}>
        {(['5', '4', '3', '2', '1'] as const).map((n) => (
          <option key={n} value={n}>
            {'★'.repeat(Number(n))} — {t(`review.ratings.${n}`)}
          </option>
        ))}
      </select>
      <label htmlFor={`${uid}-body`} className="sf-sr">
        {t('review.bodyLabel')}
      </label>
      <textarea
        id={`${uid}-body`}
        rows={3}
        maxLength={1000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('review.body')}
      />
      <div
        className={`sf-form-msg${msg ? ` is-${msg.tone}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {msg?.text}
      </div>
      <button type="submit" className="sf-cta" disabled={busy}>
        {t('review.submit')}
      </button>
    </form>
  );
}
