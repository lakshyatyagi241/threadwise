/** Public surface of the sales-activities domain. Other domains import from here, never from the folders below. */
export { SalesActivitiesScreen } from './components/sales-activities-screen';
export { OptionSelect } from './components/option-select';
export { MeetingOutcome } from './components/meeting-outcome';
export { ActivityIcon } from './components/activity-icon';
export {
  FALLBACK_SETTINGS,
  useActivitySettings,
  useActivityTypes,
} from './api/activity-types';
export { useActivityLabels, humanKey } from './lib/labels';
