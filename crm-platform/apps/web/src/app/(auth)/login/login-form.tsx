'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@crm/ui';
import { ApiError, toApiError } from '@/lib/api/errors';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgSlug: f.get('orgSlug'),
        email: f.get('email'),
        password: f.get('password'),
      }),
    });
    if (res.ok) {
      router.replace('/dashboard');
      router.refresh();
      return;
    }
    setError(
      toApiError(res.status, await res.json().catch(() => null), res.headers.get('x-request-id')),
    );
    setPending(false);
  }

  return (
    <Card className="w-full space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t('loginTitle')}</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t('org')}</span>
          <Input name="orgSlug" required autoComplete="organization" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t('email')}</span>
          <Input name="email" type="email" required autoComplete="username" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t('password')}</span>
          <Input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            invalid={Boolean(error)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error.code === 'UNAUTHENTICATED' ? t('errors.invalid') : t('errors.generic')}
            {error.requestId && <span className="block text-xs opacity-70">{error.requestId}</span>}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </Card>
  );
}
