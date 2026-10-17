/**
 * The sections of a contact: the sub-nav of the details page (`/contacts/<id>/<section>`) and the icon rail of the quick view
 * (`/contacts?contact=<id>&panel=<section>`) are the same list, so a section is one component that both draw. Which ones a person
 * sees follows the permissions the data behind them needs; the server stays the authority.
 */

export const CORE_SECTIONS = [
  'overview',
  'activities',
  'conversations',
  'details',
  'stats',
  'notes',
  'meetings',
  'files',
] as const;

export const RELATED_SECTIONS = [
  'tasks',
  'deals',
  'appointments',
  'sales',
  'lead-source',
  'company',
  'consent',
  'history',
] as const;

export type CoreSection = (typeof CORE_SECTIONS)[number];
export type RelatedSection = (typeof RELATED_SECTIONS)[number];
export type SectionId = CoreSection | RelatedSection;

const ALL: ReadonlySet<string> = new Set<string>([...CORE_SECTIONS, ...RELATED_SECTIONS]);

/** A section id from a URL segment or `panel=` value; `null` for anything that is not one. */
export function parseSection(v: string | null | undefined): SectionId | null {
  return v && ALL.has(v) ? (v as SectionId) : null;
}

/** The permission a section needs besides reading the contact; none means the contact read is enough. */
const NEEDS: Partial<Record<SectionId, readonly string[]>> = {
  conversations: ['inbox.conversation.read'],
  tasks: ['record.tasks.read'],
  deals: ['record.deals.read'],
  appointments: ['record.appointments.read'],
  // Either of the two documents' lists is reason enough to open the section; each panel gates itself again.
  sales: ['record.invoices.read', 'record.sales-docs.read'],
  company: ['record.companies.read'],
  consent: ['contacts.consent.read'],
};

/** Whether the person may open a section (any one of its permissions, or none required). */
export function sectionAllowed(id: SectionId, has: (permission: string) => boolean): boolean {
  const need = NEEDS[id];
  return !need || need.some(has);
}

/** The sections a person sees, in the sub-nav's order, split into its two groups. */
export function visibleSections(has: (permission: string) => boolean): {
  core: CoreSection[];
  related: RelatedSection[];
} {
  return {
    core: CORE_SECTIONS.filter((s) => sectionAllowed(s, has)),
    related: RELATED_SECTIONS.filter((s) => sectionAllowed(s, has)),
  };
}

/**
 * The quick view's tab strip: the six sections people work in, then a "+N more" menu with the rest of what the drawer shows
 * (`details` being "Properties"). Everything else is one click away on the details page ("See all details").
 */
export const TAB_PRIMARY = [
  'overview',
  'activities',
  'notes',
  'tasks',
  'meetings',
  'files',
] as const satisfies readonly SectionId[];
export const TAB_MORE = [
  'conversations',
  'stats',
  'details',
] as const satisfies readonly SectionId[];
export type QuickSection = (typeof TAB_PRIMARY)[number] | (typeof TAB_MORE)[number];

/** The tabs a person sees, split into the strip and its overflow menu; a section whose permission they lack is left out. */
export function quickTabs(has: (permission: string) => boolean): {
  primary: QuickSection[];
  more: QuickSection[];
} {
  return {
    primary: TAB_PRIMARY.filter((s) => sectionAllowed(s, has)),
    more: TAB_MORE.filter((s) => sectionAllowed(s, has)),
  };
}

/**
 * What the action bar's Note, Task, Call, Meeting and Add company buttons ask for: no dialog, the screen moves to the section that
 * holds the inline composer and puts the cursor in it.
 */
export const ADD_TARGETS = ['note', 'task', 'meeting', 'company', 'call'] as const;
export type AddTarget = (typeof ADD_TARGETS)[number];

/**
 * The section whose own inline composer an add target focuses: the notes, tasks and meetings lists and the list's quick add
 * (`?contact=<id>&panel=notes`, `?add=task` in an older link) keep working. A call has no list of its own: it is logged in the
 * Activity tab's compose box, so a call lives there.
 */
export const SECTION_OF_TARGET: Record<AddTarget, SectionId> = {
  note: 'notes',
  task: 'tasks',
  meeting: 'meetings',
  company: 'overview',
  call: 'activities',
};

/**
 * Where the action bar's buttons go: the Activity tab, whose compose box (Note, Task, Call, Meeting) is the quick way to add anything,
 * with the timeline under it. The company has its card on the overview.
 */
export const ACTION_SECTION: Record<AddTarget, SectionId> = {
  note: 'activities',
  task: 'activities',
  meeting: 'activities',
  call: 'activities',
  company: 'overview',
};

/** `?add=` value from a URL, or null. */
export function parseAddTarget(v: string | null | undefined): AddTarget | null {
  return (ADD_TARGETS as readonly string[]).includes(v ?? '') ? (v as AddTarget) : null;
}

/** A request to put the cursor in a section's composer; `n` changes on every request so asking again for the same one still works. */
export interface FocusRequest {
  target: AddTarget;
  n: number;
  /** A call: the click on a phone number the prompt "How did the call go?" asks about, so the form starts at that time. */
  clickedAt?: number;
}

/** Where a section lives on the details page: the overview is the bare contact URL, everything else adds its id. */
export function sectionHref(contactId: string, section: SectionId): string {
  return section === 'overview' ? `/contacts/${contactId}` : `/contacts/${contactId}/${section}`;
}

/**
 * The sub-nav's three groups, in order: what the contact is working on (Contact), what is connected to them (Related) and the
 * contact's own record data (Record). A group a person sees nothing in is left out. Every section of `CORE_SECTIONS` and
 * `RELATED_SECTIONS` is in exactly one of them.
 */
export const NAV_GROUPS = [
  {
    id: 'contact',
    sections: ['overview', 'activities', 'conversations', 'notes', 'tasks', 'meetings', 'files'],
  },
  { id: 'related', sections: ['deals', 'appointments', 'sales', 'company'] },
  { id: 'record', sections: ['details', 'stats', 'lead-source', 'consent', 'history'] },
] as const satisfies readonly { id: string; sections: readonly SectionId[] }[];
export type NavGroupId = (typeof NAV_GROUPS)[number]['id'];

export function navGroups(
  has: (permission: string) => boolean,
): Array<{ id: NavGroupId; sections: SectionId[] }> {
  return NAV_GROUPS.map((g) => ({
    id: g.id,
    sections: (g.sections as readonly SectionId[]).filter((s) => sectionAllowed(s, has)),
  })).filter((g) => g.sections.length > 0);
}
