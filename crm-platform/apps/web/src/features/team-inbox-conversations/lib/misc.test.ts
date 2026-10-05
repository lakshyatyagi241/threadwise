import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ERROR_KINDS, errorCode, errorKind, isRetryableSend } from './errors';
import { shortcutAction } from './shortcuts';
import { eventLabel } from './timeline';

describe('error kinds', () => {
  it('maps the codes the inbox is told about', () => {
    expect(errorKind('SERVICE_WINDOW_CLOSED')).toBe('windowClosed');
    expect(errorKind('PLAN_LIMIT_REACHED')).toBe('planLimit');
    expect(errorKind('CHANNEL_DISCONNECTED')).toBe('channelDisconnected');
    expect(errorKind('ROW_VERSION_CONFLICT')).toBe('conflict');
    expect(errorKind('CONVERSATION_NOT_FOUND')).toBe('notFound');
    expect(errorKind('SOMETHING_NEW')).toBe('generic');
  });

  it('every kind is a known one', () => {
    for (const code of ['SERVICE_WINDOW_CLOSED', 'NETWORK', 'PAYLOAD_TOO_LARGE', 'X']) {
      expect(ERROR_KINDS).toContain(errorKind(code));
    }
  });

  it('reads the code of a thrown error', () => {
    expect(errorCode(new ApiError(422, 'SERVICE_WINDOW_CLOSED', 'x'))).toBe(
      'SERVICE_WINDOW_CLOSED',
    );
    expect(errorCode(new ApiError(413, 'X', 'x'))).toBe('PAYLOAD_TOO_LARGE');
    expect(errorCode(new TypeError('network'))).toBe('NETWORK');
  });

  it('offers retry for a lost request but not for a refusal that will not change', () => {
    expect(isRetryableSend('NETWORK')).toBe(true);
    expect(isRetryableSend('SERVICE_WINDOW_CLOSED')).toBe(false);
    expect(isRetryableSend('PLAN_LIMIT_REACHED')).toBe(false);
  });
});

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => shortcutAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('shortcutAction', () => {
  it('maps j k e and /', () => {
    expect(key('j')).toBe('next');
    expect(key('k')).toBe('prev');
    expect(key('e')).toBe('resolve');
    expect(key('/')).toBe('search');
  });

  it('ignores other keys and any modifier', () => {
    expect(key('x')).toBeNull();
    expect(key('j', { ctrlKey: true })).toBeNull();
    expect(key('e', { metaKey: true })).toBeNull();
  });
});

describe('eventLabel', () => {
  it('knows the types the inbox writes', () => {
    expect(eventLabel({ type: 'assigned' })).toEqual({ known: true, key: 'assigned' });
    expect(eventLabel({ type: 'sla_breach' })).toEqual({ known: true, key: 'sla_breach' });
  });

  it('shows an unknown type with its underscores turned into spaces', () => {
    expect(eventLabel({ type: 'escalation_fired' })).toEqual({
      known: false,
      text: 'escalation fired',
    });
  });
});
