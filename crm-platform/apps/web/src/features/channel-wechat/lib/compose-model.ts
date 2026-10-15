import { WECHAT_LIST_MIN, type WechatAudience } from '@crm/contracts';

/** What the compose screen decides without the network. Pure. */

/** Picking a template fills the message only while it is empty, so typed text is never overwritten (Reference). */
export const bodyAfterTemplate = (body: string, template: { body: string } | undefined): string =>
  body.trim() === '' && template ? template.body : body;

export interface ComposeDraft {
  name: string;
  channelId: string;
  audience: WechatAudience;
  tagId: string;
  body: string;
  selected: ReadonlySet<string>;
}

/** The tag ID is a number (WeChat's own tag ids; 0 is the untagged group). */
export const isTagId = (v: string): boolean => /^\d{1,10}$/.test(v.trim());

/**
 * The name, a channel and a message are needed; a tag needs its number and a picked-users broadcast at least two people
 * (the server says the same).
 */
export function canCreate(d: ComposeDraft): boolean {
  if (d.name.trim() === '' || d.channelId === '' || d.body.trim() === '') return false;
  if (d.audience === 'tag') return isTagId(d.tagId);
  if (d.audience === 'list') return d.selected.size >= WECHAT_LIST_MIN;
  return true;
}
