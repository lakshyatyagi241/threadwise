/**
 * The Apps Script a customer pastes into a Google Form's script editor so that a submission resumes the paused flow (WD-FLB-059).
 * Pure text generation: the webhook URL, the workspace token and the form id are the caller's. The identifiers stay brand-neutral
 * (a brand name can contain spaces), only the comment header and the log line carry it.
 */

/** A Google Form id as the picker or a pasted link yields it. */
export const GOOGLE_FORM_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const safeId = (v: string): string => v.replace(/[^A-Za-z0-9_-]/g, '');
/** Inside a double-quoted JS string: backslash and quote escaped, line breaks removed. */
const jsString = (v: string): string =>
  v
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
/** Inside a `/** ... *\/` comment: nothing may close it. */
const commentText = (v: string): string => v.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');

export function buildAppsScript(input: {
  webhookUrl: string;
  token: string;
  formId: string;
  brand: string;
}): string {
  const url = jsString(input.webhookUrl);
  const token = jsString(input.token);
  const formId = safeId(input.formId);
  const brand = commentText(input.brand || 'Flow builder');
  const brandLog = jsString(input.brand || 'Flow builder');
  return `/**
 * ${brand} → Google Forms bridge.
 * Auto-generated for form ${formId}.
 *
 * Setup (once per form):
 *   1. Open your Form → ⋮ menu → Script editor
 *   2. Paste this entire file, save
 *   3. Click the clock icon (Triggers) → Add Trigger:
 *        function: onFormSubmit
 *        event:    From form → On form submit
 *        save → Google will ask for permissions, grant them
 *   4. Done — submissions now resume the paused flow.
 */

const FORM_WEBHOOK_URL = "${url}";
const FORM_WORKSPACE_TOKEN = "${token}";
const FORM_ID = "${formId}";

function onFormSubmit(e) {
  try {
    const itemResponses = e.response.getItemResponses();
    const answers = {};
    itemResponses.forEach(function (ir) {
      answers[ir.getItem().getTitle()] = ir.getResponse();
    });

    const payload = {
      form_id: FORM_ID,
      response_id: e.response.getId(),
      respondent: e.response.getRespondentEmail() || "",
      submitted_at: e.response.getTimestamp().toISOString(),
      answers: answers,
    };

    UrlFetchApp.fetch(FORM_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Workspace-Token": FORM_WORKSPACE_TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.error("[${brandLog}] form submit hook failed:", err);
  }
}
`;
}

/** The download name: brand slug and form id, like WaDesk's `<brand>-form-<id>.gs`. */
export function appsScriptFileName(brand: string, formId: string): string {
  const slug = brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'form'}-form-${safeId(formId)}.gs`;
}
