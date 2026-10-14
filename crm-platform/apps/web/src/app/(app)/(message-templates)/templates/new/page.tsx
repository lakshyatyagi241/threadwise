import { TemplateFormScreen } from '@/features/message-templates/components/template-form-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/templates/new`, or `/templates/new?from=<template id>` to start from a copy of an existing template. */
export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from: raw } = await searchParams;
  const from = typeof raw === 'string' ? raw : undefined;
  return <TemplateFormScreen copyFrom={from && UUID.test(from) ? from : undefined} />;
}
