import { describe, expect, it } from 'vitest';
import { csvCell } from '../../../src/modules/dashboards-analytics-charts/dash.service';
import {
  deltaPp,
  contactReplyRate,
  funnelOf,
  repliesPerContact,
  replyRateComparison,
  percentChange,
  totalsOf,
} from '../../../src/modules/dashboards-analytics-charts/dash-metrics';

const zero = {
  sent: 0,
  delivered: 0,
  failed: 0,
  read: 0,
  replies: 0,
  repliers: 0,
  contactsMessaged: 0,
  contactsDelivered: 0,
  contactsReplied: 0,
};

describe('metric rules (TW-DASH-002)', () => {
  it('percent change: previous 0 and now positive is +100; both 0 is 0; otherwise one decimal', () => {
    expect(percentChange(4, 0)).toBe(100);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(100, 50)).toBe(100);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(1, 3)).toBe(-66.7);
  });

  it('rate delta is in percentage points', () => {
    expect(deltaPp(25, 20)).toBe(5);
  });

  it('rates are one decimal and 0 for no sends; queued never goes below 0', () => {
    const t = totalsOf({
      sent: 200,
      delivered: 180,
      failed: 5,
      read: 50,
      replies: 30,
      repliers: 20,
      contactsMessaged: 0,
      contactsDelivered: 0,
      contactsReplied: 20,
    });
    expect(t).toMatchObject({ readRate: 25, deliverability: 90, replyRate: 15, queued: 15 });
    expect(totalsOf(zero)).toMatchObject({
      readRate: 0,
      deliverability: 0,
      replyRate: 0,
      queued: 0,
    });
    expect(totalsOf({ ...zero, sent: 1, delivered: 2 }).queued).toBe(0);
  });

  it('funnel: 100 sent, 90 delivered, 30 replies, 20 repliers', () => {
    const f = funnelOf(
      totalsOf({
        ...zero,
        sent: 100,
        delivered: 90,
        replies: 30,
        repliers: 20,
        contactsReplied: 20,
      }),
    );
    expect(f.stages.map((s) => [s.count, s.pct, s.drop])).toEqual([
      [100, 100, 0],
      [90, 90, 10],
      [30, 30, 60],
      [20, 20, 10],
    ]);
    expect(f.endToEnd).toBe(20);
  });

  it('funnel with no sends is all zero', () => {
    const f = funnelOf(totalsOf(zero));
    expect(f.stages.every((s) => s.count === 0 && s.pct === 0 && s.drop === 0)).toBe(true);
    expect(f.endToEnd).toBe(0);
  });
});

describe('contact-based funnel (Engagement funnel card)', () => {
  const t = (c: Partial<typeof zero>) => totalsOf({ ...zero, ...c });

  it('counts contacts messaged, delivered, replied, with activity and reply rate', () => {
    const cur = t({
      sent: 31,
      delivered: 31,
      replies: 27,
      repliers: 4,
      contactsMessaged: 31,
      contactsDelivered: 31,
      contactsReplied: 4,
    });
    const f = funnelOf(cur);
    expect(f.contacts).toEqual({ messaged: 31, delivered: 31, replied: 4 });
    expect(f.activity).toEqual({ inbound: 27, respondingContacts: 4, repliesPerContact: 6.8 });
    expect(f.replyRate).toBe(12.9);
    expect(f.comparison).toBeNull(); // no previous window passed
  });

  it('zero messaged: reply rate 0, no division, replies per contact is null', () => {
    const f = funnelOf(t({}), t({}));
    expect(f.replyRate).toBe(0);
    expect(f.activity.repliesPerContact).toBeNull();
    expect(f.comparison).toBeNull();
  });

  it('replied above messaged caps the rate at 100', () => {
    const cur = t({ contactsMessaged: 1, contactsReplied: 2, replies: 5, repliers: 2 });
    expect(contactReplyRate(cur)).toBe(100);
    expect(funnelOf(cur).contacts.replied).toBe(2); // the count itself stays true
  });

  it('replies per contact is one decimal and null for none', () => {
    expect(repliesPerContact(27, 4)).toBe(6.8);
    expect(repliesPerContact(10, 3)).toBe(3.3);
    expect(repliesPerContact(5, 0)).toBeNull();
  });

  it('comparison is in points with one decimal; up, down and zero; hidden without a previous messaged window', () => {
    const cur = t({ contactsMessaged: 31, contactsReplied: 4 }); // 12.9
    const prevUp = t({ contactsMessaged: 35, contactsReplied: 3 }); // 8.6
    expect(replyRateComparison(cur, prevUp)).toEqual({ previousReplyRate: 8.6, replyRatePp: 4.3 });
    const prevDown = t({ contactsMessaged: 10, contactsReplied: 5 }); // 50
    expect(replyRateComparison(cur, prevDown)?.replyRatePp).toBe(-37.1);
    expect(replyRateComparison(cur, cur)?.replyRatePp).toBe(0);
    expect(replyRateComparison(cur, t({ contactsReplied: 2 }))).toBeNull();
    expect(replyRateComparison(cur, undefined)).toBeNull();
  });
});

describe('CSV cells (TW-DASH-032)', () => {
  it('neutralises formulas, keeps plain numbers, quotes commas and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
