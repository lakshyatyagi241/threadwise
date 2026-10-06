import type { Definition, FormDetail, FormLiveSettings, CrmProperty } from '../lib/types';

/**
 * What the builder shell (`builder-screen.tsx`) hands to every tab. The shell owns the state, saving, publishing and the
 * unsaved-changes guard; a tab only edits the working copies through `setDraft` / `patchLive` and reads the rest.
 */
export interface BuilderTabProps {
  /** The form as the server last returned it: status, public key, share links, versions, the saved draft. Read only. */
  form: FormDetail;
  /** The working copy of the definition (what Save writes to the draft). */
  draft: Definition;
  setDraft: (next: Definition | ((d: Definition) => Definition)) => void;
  /** The working copy of the settings that apply live (owner rule, notify, allowed origins, captcha, honeypot, retention). */
  live: FormLiveSettings;
  patchLive: (patch: Partial<FormLiveSettings>) => void;
  /** The form's name (a column of the form, not of the definition). */
  name: string;
  setName: (name: string) => void;
  /** The person may change the form (`record.forms.update`); every control is read only without it. */
  canEdit: boolean;
  /** Contact and company properties for the field picker (empty while loading or when the catalogue call failed). */
  properties: CrmProperty[];
  /** Replace the server copy after an action the tab ran itself (for example rotating the key), so `form.rowVersion` stays current. */
  onFormChange: (next: FormDetail) => void;
  /** True while a save or publish is in flight. */
  busy: boolean;
}
