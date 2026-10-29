/**
 * Limits that campaign.ts and broadcast-wizard.ts both need. Kept in a file with no imports: broadcast-wizard.ts imports campaign.ts, so
 * campaign.ts importing a constant from broadcast-wizard.ts made a cycle that left the wizard's status enum undefined (every draft save
 * then failed in the browser with "Could not save").
 */

/** A campaign's name: at most 100 characters (a longer one already saved in a draft is cut to this when the draft is read). */
export const WIZARD_NAME_MAX = 100;
