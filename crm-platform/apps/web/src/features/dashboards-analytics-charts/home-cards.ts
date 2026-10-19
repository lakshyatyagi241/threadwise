import type { HomeCard } from '../_registry/types';

/**
 * The cards of the Home dashboard, one id each (`card:dashboard.<id>` in the persona module catalog; docs/specs/persona-profiles.md,
 * section 3). Listed here so a persona can name a card before the screen reads the persona (phase 1 makes `dashboard-screen.tsx` skip
 * a hidden card). Order follows the screen, top to bottom.
 */
export const homeCards: HomeCard[] = [
  { id: 'sent' },
  { id: 'read' },
  { id: 'contacts' },
  { id: 'wallet' },
  { id: 'instagram' },
  { id: 'quick-access' },
  { id: 'pipeline' },
  { id: 'throughput' },
  { id: 'campaigns' },
  { id: 'devices' },
  { id: 'templates' },
  { id: 'inbox' },
  { id: 'copilot' },
  { id: 'flows' },
  { id: 'funnel' },
  { id: 'activity' },
  { id: 'quick-actions' },
  { id: 'integrations' },
];
