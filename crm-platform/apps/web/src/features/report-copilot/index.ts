/**
 * Public surface of the AI report assistant. Other domains import from here, never from the folders below.
 * The workspace route `/reports` and the console route `/admin/reports` render `<ReportsPage scope=... />`.
 */
export { ReportsPage, type ReportsPageProps } from './components/reports-page';
