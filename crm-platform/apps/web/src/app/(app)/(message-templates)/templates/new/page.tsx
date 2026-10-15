import { TemplateFormScreen } from '@/features/message-templates/components/template-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * `/templates/new`; `?from=<template id>` starts from a copy of an existing template, `?gallery=<default template id>` from one of the
 * default templates (the Template gallery tab), `?connection=<WhatsApp number id>` on that number (the guided campaign wizard sends the
 * person here after "Build with AI", with the number the campaign is sent from).
 */
export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string | string[];
    connection?: string | string[];
    gallery?: string | string[];
  }>;
}) {
  const q = await searchParams;
  const from = one(q.from);
  const connection = one(q.connection);
  const gallery = one(q.gallery);
  return (
    <TemplateFormScreen
      copyFrom={from && UUID.test(from) ? from : undefined}
      connectionId={connection && UUID.test(connection) ? connection : undefined}
      galleryId={gallery && /^[a-z0-9_]{1,80}$/.test(gallery) ? gallery : undefined}
    />
  );
}
