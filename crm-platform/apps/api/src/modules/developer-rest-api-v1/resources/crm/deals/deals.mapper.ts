import { majorToMinor, type DealResponse, type V1Deal } from '@crm/contracts';

/** `DealResponse` (the dashboard's shape) to Reference's flat public deal: ids only, no embedded objects. */
export function toV1Deal(d: DealResponse): V1Deal {
  const minor = majorToMinor(d.value, d.currency);
  return {
    id: d.id,
    title: d.title,
    pipeline_id: d.pipeline.id,
    stage_id: d.stage.id,
    stage: d.stage.name,
    status: d.status,
    value: Number(d.value),
    value_minor: minor === null ? Math.round(Number(d.value) * 100) : Number(minor),
    currency: d.currency,
    contact_id: d.contact?.id ?? null,
    owner_user_id: d.owner?.id ?? null,
    source: d.source,
    expected_close_date: d.expectedCloseDate,
    lost_reason: d.lostReason,
    won_at: d.wonAt,
    lost_at: d.lostAt,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}
