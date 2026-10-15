import { TemplateFormScreen } from '@/features/message-templates/components/template-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/templates/new`; `?from=<template id>` starts from a copy of an existing template, `?gallery=<default template id>` from one of the
 * default templates (the Saved templates tab).
 */
export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; gallery?: string | string[] }>;
}) {
  const { from: raw, gallery: rawGallery } = await searchParams;
  const from = typeof raw === 'string' ? raw : undefined;
  const gallery =
    typeof rawGallery === 'string' && /^[a-z0-9_]{1,80}$/.test(rawGallery) ? rawGallery : undefined;
  return (
    <TemplateFormScreen copyFrom={from && UUID.test(from) ? from : undefined} galleryId={gallery} />
  );
}
