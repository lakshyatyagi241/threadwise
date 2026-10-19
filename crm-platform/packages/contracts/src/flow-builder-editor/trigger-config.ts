/**
 * The settings of the trigger kinds that need more than a tag, a group or a stage (the team's workflow gap list): which field and value
 * to match, when a schedule fires, which store event. The Trigger node saves them as plain fields; `flbTriggerConfig` reads them into
 * the one clean shape the API stores in `flows.trigger_config` and the runtime reads. Pure and total: a bad value is dropped or
 * defaulted, never thrown, so a half-filled node saves (as a keyword trigger with no keywords does) and simply never fires.
 */

import { flbCondRulesOf, flbSanitizeConditionGroup, type FlbCondGroup } from './condition-group';

/** Operators of the field-match trigger: the Condition node's, minus the numeric-only extras, plus the empty tests. */
export const FLB_FIELD_MATCH_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'is_set',
  'is_not_set',
  'is_empty',
  'is_not_empty',
] as const;
export type FlbFieldMatchOperator = (typeof FLB_FIELD_MATCH_OPERATORS)[number];

/** Store events a flow can start on. The store has no feed for "added to cart" or "product viewed" (no storefront tracking), so they are not offered. */
export const FLB_STORE_EVENTS = [
  'checkout_started',
  'abandoned_cart',
  'order_fulfilled',
  'order_refunded',
  'order_cancelled',
  'ordered_product',
] as const;
export type FlbStoreEvent = (typeof FLB_STORE_EVENTS)[number];

export const FLB_SCHEDULE_FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'] as const;
export type FlbScheduleFrequency = (typeof FLB_SCHEDULE_FREQUENCIES)[number];

export const FLB_SCHEDULE_AUDIENCES = ['all', 'group', 'segment'] as const;
export type FlbScheduleAudience = (typeof FLB_SCHEDULE_AUDIENCES)[number];

export const FLB_DATE_DIRECTIONS = ['on', 'before', 'after'] as const;
export type FlbDateDirection = (typeof FLB_DATE_DIRECTIONS)[number];

export interface FlbSegmentJoinConfig {
  segmentId: string;
}
export interface FlbFieldMatchConfig {
  /** The first rule's field, kept so a flow saved with one field reads the same as before. */
  field: string;
  operator: FlbFieldMatchOperator;
  value: string;
  /** AND/OR groups of field rules (beyond Reference). When present it decides; `field`, `operator` and `value` mirror its first rule. */
  conditionGroup: FlbCondGroup | null;
}
export interface FlbDateFieldMatchConfig {
  field: string;
  /** `on`: the date itself; `before`: `days` before it; `after`: `days` after it. */
  direction: FlbDateDirection;
  days: number;
  /** Local time of day the check runs, `HH:MM`. */
  time: string;
  /** Match the month and day every year (a birthday) instead of the full date. */
  yearly: boolean;
}
export interface FlbScheduleConfig {
  frequency: FlbScheduleFrequency;
  /** Local time of day, `HH:MM`. */
  time: string;
  /** IANA zone the time is read in; empty means the workspace's zone. */
  timezone: string;
  /** `once`: the day, `YYYY-MM-DD`. */
  date: string;
  /** `weekly`: 0 (Sunday) to 6. */
  weekdays: number[];
  /** `monthly`: 1 to 31 (a short month fires on its last day). */
  day: number;
  audience: { kind: FlbScheduleAudience; ref: string };
}
export interface FlbStoreEventConfig {
  event: FlbStoreEvent;
  /** `ordered_product` only: the store's product id; empty means any product. */
  productId: string;
}

export type FlbTriggerConfig =
  | FlbSegmentJoinConfig
  | FlbFieldMatchConfig
  | FlbDateFieldMatchConfig
  | FlbScheduleConfig
  | FlbStoreEventConfig;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(text(v)) ? (text(v) as T) : fallback;
/** A field as the person typed it, with the `{{ }}` braces of a variable taken off. */
const cleanField = (v: unknown): string => text(v).replace(/^\{\{|\}\}$/g, '').trim();
const time = (v: unknown, fallback: string): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text(v));
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : fallback;
};
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;
};

/** The stored settings of a Trigger node of this kind, or null for a kind that has none. */
export function flbTriggerConfig(
  kind: string,
  d: Record<string, unknown>,
): FlbTriggerConfig | null {
  switch (kind) {
    case 'segment_join':
    case 'segment_leave':
      return { segmentId: text(d.segmentId) };
    case 'field_match': {
      const conditionGroup = flbSanitizeConditionGroup(d.conditionGroup, cleanField);
      const first = conditionGroup ? (flbCondRulesOf(conditionGroup)[0] ?? null) : null;
      if (first) {
        return {
          field: first.variable,
          operator: oneOf(FLB_FIELD_MATCH_OPERATORS, first.operator, 'equals'),
          value: first.value,
          conditionGroup,
        };
      }
      return {
        field: cleanField(d.field),
        operator: oneOf(FLB_FIELD_MATCH_OPERATORS, d.operator, 'equals'),
        value: text(d.value),
        conditionGroup,
      };
    }
    case 'date_field_match':
      return {
        field: text(d.field)
          .replace(/^\{\{|\}\}$/g, '')
          .trim(),
        direction: oneOf(FLB_DATE_DIRECTIONS, d.direction, 'on'),
        days: int(d.days, 0, 3650, 0),
        time: time(d.time, '09:00'),
        yearly: d.yearly === true || d.yearly === 'true',
      };
    case 'schedule': {
      const a = (d.audience && typeof d.audience === 'object' ? d.audience : {}) as Record<
        string,
        unknown
      >;
      const weekdays = (Array.isArray(d.weekdays) ? d.weekdays : [])
        .map((w) => Number(w))
        .filter((w) => Number.isInteger(w) && w >= 0 && w <= 6);
      return {
        frequency: oneOf(FLB_SCHEDULE_FREQUENCIES, d.frequency, 'daily'),
        time: time(d.time, '09:00'),
        timezone: text(d.timezone),
        date: /^\d{4}-\d{2}-\d{2}$/.test(text(d.date)) ? text(d.date) : '',
        weekdays: [...new Set(weekdays)].sort(),
        day: int(d.day, 1, 31, 1),
        audience: {
          kind: oneOf(FLB_SCHEDULE_AUDIENCES, a.kind ?? d.audienceKind, 'all'),
          ref: text(a.ref ?? d.audienceRef),
        },
      };
    }
    case 'shopify_event':
    case 'woocommerce_event':
      return {
        event: oneOf(FLB_STORE_EVENTS, d.event, 'checkout_started'),
        productId: text(d.productId),
      };
    default:
      return null;
  }
}
