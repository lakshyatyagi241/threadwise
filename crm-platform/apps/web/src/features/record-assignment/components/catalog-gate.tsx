'use client';

import { useMemo, type ReactNode } from 'react';
import type { AssignmentSubject } from '@crm/contracts';
import { useModuleFields, isUsableProperty } from '@/features/contacts-attributes-tags';
import { propertyLookups, useSegmentCatalog, type FieldDef } from '@/features/segments';
import { usePipelineChoices } from '../api/assignment';
import { companyCatalog, contactCatalog, dealCatalog, originField } from '../lib/catalog';
import { useRa } from './use-ra';

export interface CatalogState {
  /** Every field a condition of this module can test, with the workspace's own properties. */
  catalog: FieldDef[];
  /** The lookups behind the catalog have answered (until then nothing is judged deleted). */
  ready: boolean;
  /** A lookup failed: the builder still works with what loaded, and says so. */
  failed: boolean;
}

function useOrigin() {
  const { t } = useRa();
  return useMemo(() => originField(t('fields.origin'), (o) => t(`origin.${o}`)), [t]);
}

function ContactGate({ children }: { children: (c: CatalogState) => ReactNode }) {
  const seg = useSegmentCatalog();
  const origin = useOrigin();
  const catalog = useMemo(() => contactCatalog(seg.catalog, origin), [seg.catalog, origin]);
  return <>{children({ catalog, ready: seg.ready, failed: seg.failed })}</>;
}

function CompanyGate({ children }: { children: (c: CatalogState) => ReactNode }) {
  const { t } = useRa();
  const fields = useModuleFields('companies', false);
  const origin = useOrigin();
  const catalog = useMemo(
    () =>
      companyCatalog({
        label: (id) => t(`fields.company.${id}`),
        origin,
        properties: propertyLookups((fields.data ?? []).filter(isUsableProperty)),
      }),
    [t, origin, fields.data],
  );
  return (
    <>{children({ catalog, ready: fields.isSuccess || fields.isError, failed: fields.isError })}</>
  );
}

function DealGate({ children }: { children: (c: CatalogState) => ReactNode }) {
  const { t } = useRa();
  const pipelines = usePipelineChoices();
  const origin = useOrigin();
  const catalog = useMemo(
    () =>
      dealCatalog({
        label: (id) => t(`fields.deal.${id}`),
        statusLabel: (s) => t(`fields.dealStatus.${s}`),
        origin,
        pipelines: (pipelines.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
        })),
      }),
    [t, origin, pipelines.data],
  );
  return (
    <>
      {children({
        catalog,
        ready: pipelines.isSuccess || pipelines.isError,
        failed: pipelines.isError,
      })}
    </>
  );
}

/** Loads the fields of ONE module (the contacts' queries are not run on the Deals tab) and hands the catalog to its children. */
export function CatalogGate({
  subject,
  children,
}: {
  subject: AssignmentSubject;
  children: (c: CatalogState) => ReactNode;
}) {
  if (subject === 'contact') return <ContactGate>{children}</ContactGate>;
  if (subject === 'company') return <CompanyGate>{children}</CompanyGate>;
  return <DealGate>{children}</DealGate>;
}
