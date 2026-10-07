import type {
  EnrollOneResult,
  FlowSubscriberList,
  V1EnrollResult,
  V1Flow,
  V1Subscriber,
} from '@crm/contracts';

export interface FlowRow {
  uuid: string;
  name: string;
  trigger: string | null;
  published: boolean;
  active: boolean;
  category: string | null;
  subscribers: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Reference's three states: not published is a draft; published and on is live; published and switched off is paused. */
export const flowStatusOf = (r: Pick<FlowRow, 'published' | 'active'>): V1Flow['status'] =>
  !r.published ? 'draft' : r.active ? 'live' : 'paused';

export const toPublicFlow = (r: FlowRow): V1Flow => ({
  id: r.uuid,
  name: r.name,
  trigger: r.trigger,
  status: flowStatusOf(r),
  category: r.category,
  subscribers_count: r.subscribers,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
});

const digitsOf = (s: string | null): string => (s ?? '').replace(/\D/g, '');

/** A contact with no name shows as `#<id>` in Reference; the id on this API is the uuid. */
export function toPublicSubscriber(i: FlowSubscriberList['items'][number]): V1Subscriber {
  const name = i.contact.name?.trim();
  return {
    id: i.id,
    contact_id: i.contact.id,
    contact_name: name ? name : `#${i.contact.id}`,
    contact_phone: digitsOf(i.contact.phone),
    status: i.status,
    enrolled_at: i.enrolledAt,
    failed_at: i.failedAt,
    failure_reason: i.failureReason,
  };
}

export const toPublicEnroll = (
  r: EnrollOneResult,
  failureReason: string | null,
): V1EnrollResult => ({
  flow_id: r.flowId,
  contact_id: r.contactId,
  subscriber_id: r.subscriberId,
  status: r.status,
  enrolled_at: r.enrolledAt,
  failure_reason: r.status === 'failed' ? failureReason : null,
});
