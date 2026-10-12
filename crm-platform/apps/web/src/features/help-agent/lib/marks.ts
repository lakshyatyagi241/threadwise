/**
 * Regions of the page the model must never read (docs/specs/help-agent-assistant.md section 6.3). The page-agent library skips any
 * subtree that carries `data-page-agent-ignore="true"`; our components carry the shorter `data-agent-ignore` (customer-written text:
 * notes, messages, form answers) or `data-agent-pii` (personal fields), and this copies both onto the library's attribute before every
 * step. The assistant's own panel carries the library attribute directly.
 */
export const IGNORE_ATTRIBUTE = 'data-page-agent-ignore';
const OURS = '[data-agent-ignore], [data-agent-pii]';

/** Marks every region our components flagged. Returns how many it marked (for tests). */
export function applyAgentMarks(root: ParentNode = document): number {
  let marked = 0;
  root.querySelectorAll(OURS).forEach((el) => {
    if (el.getAttribute(IGNORE_ATTRIBUTE) !== 'true') {
      el.setAttribute(IGNORE_ATTRIBUTE, 'true');
      marked += 1;
    }
  });
  return marked;
}

export { AGENT_IGNORE, AGENT_PII, AGENT_RISK_HIGH } from '@/lib/agent-marks';
