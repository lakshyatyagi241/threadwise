/**
 * Public surface of the Help center that is safe in client code. The server-only loader is `./server` (`getVisibleHelp`) and the
 * view builder is `./view` (`helpFor`); import those by path from server components.
 */
export { HelpProvider, useHelpEntries, useHelpEntry } from './context';
export { HelpTip, PageHelpTip } from './help-tip';
export type { HelpIndexEntry } from './types';
