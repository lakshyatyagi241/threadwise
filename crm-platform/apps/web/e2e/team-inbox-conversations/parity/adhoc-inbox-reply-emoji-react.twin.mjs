// Inbox: reply to a message, emoji in the composer, and reactions an agent sends.
//
// Reference has a text reply and an emoji button in its composer, but no reply-to-message and no agent reactions, and its stack is not
// comparable here, so every scenario runs on ours only and is judged against absolute expectations. A violated expectation is recorded as
// `sec.expect.<name> = true` (the comparator fails any `sec.` key that is true on ours). Everything goes through the simulator channel:
// no real provider, no real messages. Test data (customer names) carries the run tag.
//
// Run with `--sides ours` and PARITY_WORKERS=1: every scenario drives the same simulator channel, whose 24 hour window is a channel-wide
// setting, so scenarios must not overlap.
import { randomUUID } from 'node:crypto';

const idem = () => ({ 'Idempotency-Key': randomUUID() });

/** `cond` must hold; otherwise the scenario records a violation under `name`. */
const expect = (c, name, cond) => c.obs.set(`sec.expect.${name}`, !cond);

async function simulatorChannel(c) {
  const list = await c.http('GET', '/v2/channels');
  const found = list.body?.data?.find((x) => x.kind === 'simulator');
  if (found) return found;
  const made = await c.http('POST', '/v2/channels/simulator', {
    data: { name: 'Simulator' },
    headers: idem(),
  });
  return made.body;
}

async function setWindow(c, channelId, window) {
  const cur = (await c.http('GET', `/v2/channels/${channelId}`)).body;
  await c.http('PATCH', `/v2/channels/${channelId}`, {
    data: { rowVersion: cur.rowVersion, settings: { simulator: { window } } },
    headers: idem(),
  });
  return cur.settings?.simulator?.window ?? 'auto';
}

/** A tagged customer who has said `text`; the 24 hour window is made open (and put back after the scenario). */
async function seed(c, text, { window = 'open' } = {}) {
  const channel = await simulatorChannel(c);
  const before = await setWindow(c, channel.id, window);
  c.onCleanup(() => setWindow(c, channel.id, before).catch(() => undefined));
  const number = `9198${c.digits(8)}`;
  const name = c.tag('cust');
  const sent = await c.http('POST', `/v2/dev/simulator/channels/${channel.id}/inbound`, {
    data: { from: number, name, kind: 'text', text },
    headers: idem(),
  });
  if (!sent.ok)
    throw new Error(`simulator inbound refused: ${sent.status} ${sent.text.slice(0, 120)}`);
  return { channel, number, name, text };
}

const rowOf = (c, name) => c.page.locator('[data-testid="inbox-row"]').filter({ hasText: name });
const bubbles = (c) => c.page.locator('[data-testid="inbox-message"]');
const bubbleWith = (c, text) => bubbles(c).filter({ hasText: text }).first();

/** Opens the customer's thread (the worker ingests the simulated message, so the row may take a moment) and returns its uuid. */
async function openThread(c, name) {
  await c.goto('/inbox', { ready: 'main' });
  // The consent banner sits over the composer on a short screen: take the privacy-preserving option, like a careful visitor.
  const decline = c.page.getByRole('button', { name: 'Decline' });
  if (await decline.isVisible().catch(() => false)) await decline.click();
  const row = rowOf(c, name).first();
  for (let i = 0; i < 8; i++) {
    if (
      await row.waitFor({ timeout: 3000 }).then(
        () => true,
        () => false,
      )
    )
      break;
    await c.page.reload();
  }
  await row.click();
  await bubbles(c).first().waitFor({ timeout: 15000 });
  return new URL(c.page.url()).searchParams.get('c');
}

const thread = async (c, id) =>
  (await c.http('GET', `/v2/inbox/conversations/${id}/messages`, { query: { limit: 100 } })).body
    ?.data ?? [];

/** Polls the API until `pick(messages)` is truthy. */
async function until(c, id, pick, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const found = pick(await thread(c, id));
    if (found) return found;
    if (Date.now() > end) return null;
    await c.page.waitForTimeout(700);
  }
}

const ours = (fn) => ({
  threadwise: async (c) =>
    c.obs.info('n/a', 'ours only: Reference has no counterpart in this stack'),
  ours: fn,
});

export default () => ({
  feature: 'adhoc:inbox-reply-emoji-react',
  title: 'Inbox: reply to a message, emoji picker, agent reactions',
  pages: [
    {
      id: 'inbox',
      title: 'Inbox',
      path: { threadwise: '/team-inbox', ours: '/inbox' },
      ready: { threadwise: 'body', ours: 'main' },
      probes: ['load', 'responsive', 'a11y', 'keyboard', 'auth'],
    },
  ],
  scenarios: [
    {
      id: 'reply.sends-with-quote',
      title:
        'Reply on a bubble: reply bar, send, quote in the sent message, link stored by the API',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Is the blue jacket in stock?');
        const id = await openThread(c, name);
        const target = bubbleWith(c, 'Is the blue jacket in stock?');
        await target.hover();
        await target.getByTestId('inbox-reply').click();
        const bar = c.page.getByTestId('inbox-reply-bar');
        expect(c, 'replyBarShown', await bar.isVisible());
        expect(c, 'replyBarQuotesText', (await bar.innerText()).includes('blue jacket'));
        expect(
          c,
          'composerFocused',
          await c.page
            .getByTestId('inbox-composer')
            .evaluate((el) => el === document.activeElement),
        );

        await c.page.getByTestId('inbox-composer').fill('Yes, two left');
        await c.page.keyboard.press('Enter');
        const sent = bubbleWith(c, 'Yes, two left');
        await sent.waitFor({ timeout: 15000 });
        expect(c, 'replyBarClearedAfterSend', !(await bar.isVisible()));
        expect(c, 'sentBubbleHasQuote', (await sent.getByTestId('inbox-quote').count()) === 1);

        const row = await until(c, id, (m) =>
          m.find((x) => x.direction === 'out' && x.body === 'Yes, two left'),
        );
        const original = (await thread(c, id)).find(
          (x) => x.body === 'Is the blue jacket in stock?',
        );
        expect(
          c,
          'apiStoresReplyLink',
          !!row && !!original && row.replyToMessageId === original.id,
        );
      }),
    },
    {
      id: 'reply.cancel',
      title: 'Escape and the close button drop the reply; the next send is a plain message',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Do you ship abroad?');
        const id = await openThread(c, name);
        const target = bubbleWith(c, 'Do you ship abroad?');
        const bar = c.page.getByTestId('inbox-reply-bar');
        await target.hover();
        await target.getByTestId('inbox-reply').click();
        await c.page.keyboard.press('Escape');
        expect(c, 'escapeCancels', !(await bar.isVisible()));

        await target.hover();
        await target.getByTestId('inbox-reply').click();
        await c.page.getByTestId('inbox-reply-cancel').click();
        expect(c, 'closeCancels', !(await bar.isVisible()));

        await c.page.getByTestId('inbox-composer').fill('We do');
        await c.page.keyboard.press('Enter');
        await bubbleWith(c, 'We do').waitFor({ timeout: 15000 });
        const row = await until(c, id, (m) =>
          m.find((x) => x.direction === 'out' && x.body === 'We do'),
        );
        expect(c, 'cancelledReplyNotLinked', !!row && row.replyToMessageId === null);
      }),
    },
    {
      id: 'reply.quote-jumps',
      title: 'Tapping a quote scrolls to the original and does not error',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Where is my order 1234?');
        await openThread(c, name);
        const target = bubbleWith(c, 'Where is my order 1234?');
        await target.hover();
        await target.getByTestId('inbox-reply').click();
        await c.page.getByTestId('inbox-composer').fill('Checking now');
        await c.page.keyboard.press('Enter');
        const sent = bubbleWith(c, 'Checking now');
        await sent.waitFor({ timeout: 15000 });
        await sent.getByTestId('inbox-quote').click();
        await c.page.waitForTimeout(300);
        const flashed = await target.evaluate((el) => el.classList.contains('inbox-flash'));
        expect(c, 'originalFlashes', flashed);
      }),
    },
    {
      id: 'reply.hostile-text',
      title: 'A customer message with markup is shown as text in the quote and the reply bar',
      tags: ['xss', 'ours'],
      run: ours(async (c) => {
        await c.page.addInitScript(() => {
          window.__x = 0;
        });
        const text = '<img src=x onerror="window.__x=1"> quoted';
        const { name } = await seed(c, text);
        await openThread(c, name);
        const target = bubbleWith(c, 'quoted');
        await target.hover();
        await target.getByTestId('inbox-reply').click();
        await c.page.getByTestId('inbox-composer').fill('seen');
        await c.page.keyboard.press('Enter');
        await bubbleWith(c, 'seen').waitFor({ timeout: 15000 });
        c.obs.set('sec.xss', await c.page.evaluate(() => window.__x === 1));
      }),
    },
    {
      id: 'emoji.picker',
      title:
        'Emoji button inserts at the caret, Escape closes, recents come back first, the emoji is sent',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Thanks for the help');
        const id = await openThread(c, name);
        const box = c.page.getByTestId('inbox-composer');
        await box.fill('Glad to help ');
        await c.page.getByTestId('inbox-emoji-button').click();
        const panel = c.page.getByTestId('inbox-emoji-panel');
        expect(c, 'panelOpens', await panel.isVisible());
        const first = panel.getByTestId('inbox-emoji').first();
        const glyph = (await first.getAttribute('aria-label')) ?? '';
        await first.click();
        expect(c, 'insertedAtCaret', (await box.inputValue()) === `Glad to help ${glyph}`);
        expect(c, 'panelStaysForMore', await panel.isVisible());

        await c.page.keyboard.press('Escape');
        expect(c, 'escapeClosesPanel', !(await panel.isVisible()));
        expect(c, 'composerKeepsDraft', (await box.inputValue()).startsWith('Glad to help'));

        await c.page.getByTestId('inbox-emoji-button').click();
        expect(c, 'recentFirst', (await panel.innerText()).includes('Recently used'));
        await c.page.getByTestId('inbox-emoji-button').click();
        expect(c, 'toggleClosesPanel', !(await panel.isVisible()));

        await box.click(); // the toggle left focus on the button: Enter belongs to the box
        await c.page.keyboard.press('Enter');
        const row = await until(c, id, (m) =>
          m.find((x) => x.direction === 'out' && x.body === `Glad to help ${glyph}`),
        );
        expect(c, 'emojiDeliveredIntact', !!row);
      }),
    },
    {
      id: 'react.send-and-take-back',
      title:
        'React on a customer message: chip, no new bubble, stored as a reaction, preview untouched, then take it back',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Great service!');
        const id = await openThread(c, name);
        const target = bubbleWith(c, 'Great service!');
        const before = await bubbles(c).count();
        const detail0 = (await c.http('GET', `/v2/inbox/conversations/${id}`)).body;

        await target.hover();
        await target.getByTestId('inbox-react').click();
        expect(c, 'barOpens', await c.page.getByTestId('inbox-reaction-bar').isVisible());
        await c.page.getByRole('button', { name: 'React with 👍' }).click();
        expect(c, 'barClosesOnPick', !(await c.page.getByTestId('inbox-reaction-bar').isVisible()));

        const chip = target.getByTestId('inbox-agent-reaction');
        await chip.waitFor({ timeout: 15000 });
        expect(c, 'chipShowsEmoji', (await chip.innerText()).includes('👍'));
        expect(c, 'noExtraBubble', (await bubbles(c).count()) === before);

        const targetMsg = (await thread(c, id)).find((x) => x.body === 'Great service!');
        const stored = await until(c, id, (m) =>
          m.find((x) => x.kind === 'reaction' && x.direction === 'out' && x.body === '👍'),
        );
        expect(
          c,
          'storedAsReactionRow',
          !!stored && !!targetMsg && stored.replyToMessageId === targetMsg.id,
        );
        const settled = await until(c, id, (m) => {
          const r = m.find((x) => x.kind === 'reaction' && x.body === '👍');
          return r && ['sent', 'delivered', 'read'].includes(r.status) ? r : null;
        });
        expect(c, 'reactionReachesProvider', !!settled);

        const detail1 = (await c.http('GET', `/v2/inbox/conversations/${id}`)).body;
        expect(c, 'previewUntouched', detail1.preview === detail0.preview);
        expect(
          c,
          'waitNotEnded',
          JSON.stringify(detail1.waitingSince ?? null) ===
            JSON.stringify(detail0.waitingSince ?? null),
        );

        await chip.click();
        await chip.waitFor({ state: 'detached', timeout: 15000 });
        const removed = await until(
          c,
          id,
          (m) => m.filter((x) => x.kind === 'reaction' && x.direction === 'out').length === 2,
        );
        expect(c, 'takeBackStored', !!removed);
        expect(c, 'bubbleCountStable', (await bubbles(c).count()) === before);

        await c.page.reload();
        await bubbles(c).first().waitFor({ timeout: 15000 });
        expect(
          c,
          'stillGoneAfterReload',
          (await bubbleWith(c, 'Great service!').getByTestId('inbox-agent-reaction').count()) === 0,
        );
      }),
    },
    {
      id: 'react.persists-and-switches',
      title: 'A reaction survives a reload and changing it shows only the newest emoji',
      tags: ['ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Nice one');
        await openThread(c, name);
        const target = bubbleWith(c, 'Nice one');
        for (const emoji of ['👍', '❤️']) {
          await target.hover();
          await target.getByTestId('inbox-react').click();
          await c.page.getByRole('button', { name: `React with ${emoji}` }).click();
          await target
            .getByTestId('inbox-agent-reaction')
            .filter({ hasText: emoji })
            .waitFor({ timeout: 15000 });
        }
        expect(
          c,
          'onlyNewestChip',
          (await target.getByTestId('inbox-agent-reaction').count()) === 1,
        );
        await c.page.reload();
        await bubbles(c).first().waitFor({ timeout: 15000 });
        const chip = bubbleWith(c, 'Nice one').getByTestId('inbox-agent-reaction');
        expect(
          c,
          'survivesReload',
          (await chip.count()) === 1 && (await chip.innerText()).includes('❤️'),
        );
      }),
    },
    {
      id: 'react.api-rules',
      title:
        'Reaction API: unknown target, bad emoji, missing target, auth, replay, reaction-on-reaction',
      tags: ['edge', 'ours'],
      api: true,
      run: ours(async (c) => {
        const { name } = await seed(c, 'API rules');
        // The thread must exist to react in it: open the list through the API.
        let conv = null;
        for (let i = 0; i < 12 && !conv; i++) {
          const list = await c.http('GET', '/v2/inbox/conversations', {
            query: { q: name, limit: 5 },
          });
          conv = list.body?.data?.find((x) => (x.title ?? '').includes(name)) ?? null;
          if (!conv) await new Promise((r) => setTimeout(r, 1500));
        }
        if (!conv) throw new Error('the seeded thread never appeared in the list');
        const url = `/v2/inbox/conversations/${conv.id}/messages`;
        const target = await until(c, conv.id, (m) => m.find((x) => x.body === 'API rules'));
        const post = (data, extra = {}) =>
          c.http('POST', url, { data, headers: { ...idem(), ...extra } });
        const cid = () => randomUUID();

        const unknown = await post({
          kind: 'reaction',
          clientMessageId: cid(),
          targetMessageId: randomUUID(),
          emoji: '👍',
        });
        expect(c, 'unknownTarget404', unknown.status === 404);

        const long = await post({
          kind: 'reaction',
          clientMessageId: cid(),
          targetMessageId: target.id,
          emoji: 'x'.repeat(17),
        });
        expect(c, 'overlongEmoji4xx', long.status === 400 || long.status === 422);

        const noTarget = await post({ kind: 'reaction', clientMessageId: cid(), emoji: '👍' });
        expect(c, 'missingTarget4xx', noTarget.status === 400 || noTarget.status === 422);

        const anon = await c.http('POST', url, {
          data: {
            kind: 'reaction',
            clientMessageId: cid(),
            targetMessageId: target.id,
            emoji: '👍',
          },
          headers: idem(),
          anonymous: true,
        });
        expect(c, 'anonymous401', anon.status === 401);

        const clientMessageId = cid();
        const body = { kind: 'reaction', clientMessageId, targetMessageId: target.id, emoji: '🙏' };
        const a = await post(body);
        const b = await post(body);
        expect(c, 'accepted202', a.status === 202);
        expect(c, 'replayReturnsFirst', b.status === 202 && b.body?.id === a.body?.id);
        const rows = (await thread(c, conv.id)).filter(
          (x) => x.kind === 'reaction' && x.body === '🙏',
        );
        expect(c, 'replayCreatesOneRow', rows.length === 1);

        const onReaction = await post({
          kind: 'reaction',
          clientMessageId: cid(),
          targetMessageId: a.body?.id,
          emoji: '👍',
        });
        expect(c, 'reactionOnReactionRefused', onReaction.status === 422);
      }),
    },
    {
      id: 'react.window-closed',
      title:
        'Closed 24 hour window: the API refuses the reaction and the UI offers neither Reply nor React',
      tags: ['edge', 'ours'],
      run: ours(async (c) => {
        const { name, channel } = await seed(c, 'Hello?', { window: 'open' });
        const id = await openThread(c, name);
        const target = (await thread(c, id)).find((x) => x.body === 'Hello?');
        await setWindow(c, channel.id, 'closed');
        const refused = await c.http('POST', `/v2/inbox/conversations/${id}/messages`, {
          data: {
            kind: 'reaction',
            clientMessageId: randomUUID(),
            targetMessageId: target.id,
            emoji: '👍',
          },
          headers: idem(),
        });
        expect(c, 'closedWindow422', refused.status === 422);
        expect(
          c,
          'closedWindowCode',
          JSON.stringify(refused.body ?? '').includes('SERVICE_WINDOW_CLOSED'),
        );

        await c.page.reload();
        await bubbles(c).first().waitFor({ timeout: 15000 });
        const li = bubbleWith(c, 'Hello?');
        await li.hover();
        expect(c, 'noReactButton', (await li.getByTestId('inbox-react').count()) === 0);
        expect(c, 'noReplyButton', (await li.getByTestId('inbox-reply').count()) === 0);
      }),
    },
    {
      id: 'react.keyboard',
      title: 'Reply and React buttons are reachable by keyboard and Escape closes the reaction bar',
      tags: ['a11y', 'ours'],
      run: ours(async (c) => {
        const { name } = await seed(c, 'Keyboard test');
        await openThread(c, name);
        const li = bubbleWith(c, 'Keyboard test');
        const react = li.getByTestId('inbox-react');
        // Real keyboard modality (so :focus-visible applies): from the composer, Shift+Tab back to the button.
        const reached = async (loc) => {
          await c.page.getByTestId('inbox-composer').focus();
          for (let i = 0; i < 60; i++) {
            await c.page.keyboard.press('Shift+Tab');
            if (await loc.evaluate((el) => el === document.activeElement)) return true;
          }
          return false;
        };
        expect(c, 'reactReachableByTab', await reached(react));
        const opacity = await react.evaluate((el) => getComputedStyle(el).opacity);
        expect(c, 'focusRevealsReact', opacity === '1');
        await c.page.keyboard.press('Enter');
        const bar = c.page.getByTestId('inbox-reaction-bar');
        expect(c, 'enterOpensBar', await bar.isVisible());
        await c.page.keyboard.press('Escape');
        expect(c, 'escapeClosesBar', !(await bar.isVisible()));
        expect(c, 'replyReachableByTab', await reached(li.getByTestId('inbox-reply')));
        expect(
          c,
          'focusRevealsReply',
          (await li.getByTestId('inbox-reply').evaluate((el) => getComputedStyle(el).opacity)) ===
            '1',
        );
      }),
    },
  ],
  skip: [
    {
      scenario: /./,
      side: 'threadwise',
      reason:
        'Reference has no reply-to-message or agent reactions and is not running in this environment; judged on absolute expectations',
    },
  ],
});
