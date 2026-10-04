import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../../../common/errors/app-error';
import type { Env } from '../../../../../config/env.schema';
import { BookingOffersService, type OfferedType } from '../../../../appointments-booking';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeResult,
  OutboundMessage,
  WaitSpec,
} from '../../types';
import {
  checkAnswer,
  confirmationText,
  decodeChoice,
  questionPrompt,
  shown,
  slugOf,
  type BookContext,
  type BookStage,
  type BookWait,
  type Choice,
} from './book-rules';
import { sendFailed, str } from './send-failure';

const HANDLER = 'BookAppointment';
const BOOKED = 1;
const NO_SLOTS = 2;
const TAKEN = (err: unknown): boolean =>
  err instanceof AppError && err.code === ERROR_CODES.APPT_SLOT_TAKEN;

/** A day or time list, or the service menu: one row per choice, cut to what a channel lists. */
function listOf(body: string, rows: Choice[]): OutboundMessage {
  return {
    kind: 'list',
    body,
    button: 'Select',
    sections: [
      {
        title: 'Options',
        rows: shown(rows).map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.desc ? { description: r.desc } : {}),
        })),
      },
    ],
  };
}

/**
 * The Book appointment node (WD-FLR-040): the customer picks a service (when there are several), a day and a time from lists, the
 * slot is held, the booking questions are asked one by one, and the booking is made through the appointments domain, which is the one
 * place that knows the slot engine, the plan cap and the calendar. Ports: `booked` is 1, `no_slots` is 2 (no availability, booking not
 * offered by the plan, a failure, or a reply that was not a pick of anything offered after the first try).
 *
 * The node is a `Custom` wait: everything it needs between the customer's answers lives on the run's wait (`BookWait`), so a restart
 * loses nothing and no job is needed. A service with a deposit is booked pending and the customer gets the link to pay on the manage
 * page, where the payments domain finishes it (WaDesk made the pay link first and booked on the callback).
 */
@Injectable()
export class BookNode {
  private readonly webUrl: string;

  constructor(
    private readonly offers: BookingOffersService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = String(config.get('WEB_APP_URL', { infer: true }) ?? '').replace(/\/$/, '');
  }

  // --- start ---------------------------------------------------------------------------------------------------------------

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const p = ctx.node.props;
    const confirmation = str(p.confirmation) || '✅ Booked! See you on {{slot}}.';

    let offer;
    try {
      offer = await this.offers.offer(ctx.run.orgId);
    } catch (err) {
      ctx.note(`booking could not be read: ${err instanceof Error ? err.message : 'error'}`);
      return { kind: 'advance', port: NO_SLOTS, branch: true };
    }
    if (!offer.available) {
      const out = await ctx.send({
        kind: 'text',
        body: "Sorry, online booking isn't available right now.",
      });
      if (!out.ok) sendFailed(out, 'skip', ctx);
      ctx.note(`booking is not offered: ${offer.reason}`);
      return { kind: 'advance', port: NO_SLOTS, branch: true };
    }

    let types = offer.types;
    const pinned = str(p.bookingTypeId);
    if (pinned !== '') {
      const only = types.find((t) => t.id === pinned);
      if (only) types = [only];
    }
    if (types.length === 0) {
      ctx.note('no bookable services in this workspace');
      return { kind: 'advance', port: NO_SLOTS, branch: true };
    }

    const base: BookContext = {
      confirmation,
      dayOffset: 0,
      slotOffset: 0,
      questions: [],
      qIndex: 0,
      answers: {},
      dueNow: 0,
      currency: '',
      hasGateway: false,
    };

    if (types.length === 1) {
      const c = this.withType(base, types[0]!);
      const next = await this.dayList(ctx, c);
      if (next === 'send_failed') return { kind: 'advance', port: NO_SLOTS, branch: true };
      return next ?? { kind: 'advance', port: NO_SLOTS, branch: true };
    }

    const rows: Choice[] = types.map((t, i) => ({
      id: `bk_type_${i}`,
      title: t.name,
      desc: `${t.durationMinutes} min`,
      type: t.id,
    }));
    const out = await ctx.send(listOf(str(p.prompt) || 'What would you like to book?', rows));
    if (!out.ok) {
      return sendFailed(out, 'skip', ctx) ?? { kind: 'advance', port: NO_SLOTS, branch: true };
    }
    // The services are kept whole on the wait: picking one needs its questions and price without asking again.
    return this.park(ctx, { stage: 'CHOOSE_TYPE', ctx: base, choices: rows }, { types });
  }

  // --- an answer -----------------------------------------------------------------------------------------------------------

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    const wait = ctx.run.wait;
    const data = wait?.data as (BookWait & { types?: OfferedType[] }) | undefined;
    if (!wait || !data?.stage) return { action: 'ignore' };
    if (reply.kind !== 'text' && reply.kind !== 'tap') return { action: 'ignore' };

    try {
      return await this.step(ctx, data, reply);
    } catch (err) {
      ctx.note(`booking failed: ${err instanceof Error ? err.message : 'error'}`);
      return { action: 'route', port: NO_SLOTS };
    }
  }

  private async step(
    ctx: NodeContext,
    data: BookWait & { types?: OfferedType[] },
    reply: InboundReply,
  ): Promise<CustomDecision> {
    const c = data.ctx;
    const stay = (stage: BookStage, choices: Choice[]) => ({
      action: 'stay' as const,
      data: { stage, ctx: c, choices },
    });

    if (data.stage === 'ASK_QUESTIONS') return this.answer(ctx, data, reply);

    const pick = decodeChoice(reply, data.choices);
    if (!pick) {
      await ctx.send({
        kind: 'text',
        body: "Sorry, I didn't catch that — tap one of the options.",
      });
      return { action: 'stay', data: data as unknown as Record<string, unknown> };
    }

    if (data.stage === 'CHOOSE_TYPE') {
      const type = data.types?.find((t) => t.id === pick.type);
      if (!type) return { action: 'route', port: NO_SLOTS };
      Object.assign(c, this.withType(c, type));
      return this.showDays(ctx, c);
    }

    if (data.stage === 'CHOOSE_DAY') {
      if (pick.more) {
        c.dayOffset = c.nextDayOffset || c.dayOffset + 9;
        return this.showDays(ctx, c);
      }
      if (pick.back) {
        c.dayOffset = Math.max(0, c.dayOffset - 9);
        return this.showDays(ctx, c);
      }
      c.day = pick.day;
      c.dayLabel = pick.title;
      c.slotOffset = 0;
      return this.showTimes(ctx, c);
    }

    // CHOOSE_SLOT
    if (pick.more) {
      c.slotOffset = c.nextSlotOffset || c.slotOffset + 9;
      return this.showTimes(ctx, c);
    }
    if (pick.back) return this.showDays(ctx, c);

    c.slotStart = pick.start;
    c.slotLabel = `${c.dayLabel ?? ''} ${pick.title}`.trim();
    try {
      const held = await this.offers.reserve(
        ctx.run.orgId,
        c.typeId!,
        new Date(c.slotStart!),
        ctx.run.uuid,
      );
      c.reservationId = held.reservationId;
    } catch (err) {
      if (TAKEN(err)) {
        await ctx.send({
          kind: 'text',
          body: 'That time was just taken — here are the latest times.',
        });
        c.slotOffset = 0;
        return this.showTimes(ctx, c);
      }
      // WaDesk went on without a hold when the reservation call failed: the booking itself still guards the slot.
      ctx.note(`the slot could not be held: ${err instanceof Error ? err.message : 'error'}`);
    }

    if (c.questions.length > 0) {
      c.qIndex = 0;
      c.answers = {};
      const out = await ctx.send({ kind: 'text', body: questionPrompt(c) });
      if (!out.ok) return { action: 'route', port: NO_SLOTS };
      return stay('ASK_QUESTIONS', []);
    }
    return this.finalize(ctx, c);
  }

  private async answer(
    ctx: NodeContext,
    data: BookWait & { types?: OfferedType[] },
    reply: InboundReply,
  ): Promise<CustomDecision> {
    const c = data.ctx;
    const q = c.questions[c.qIndex]!;
    const checked = checkAnswer(q, reply.text);
    if (!checked.ok) {
      await ctx.send({ kind: 'text', body: checked.say });
      return { action: 'stay', data: data as unknown as Record<string, unknown> };
    }
    const vars: Record<string, unknown> = {};
    const ans = checked.value;
    c.answers[q.id] = ans;
    if (q.type === 'email' && ans !== '') c.email = ans;
    if (ans !== '') {
      // The answer is a flow variable for what comes next: under its mapped contact field and under its label.
      if (q.mapToContactField) vars[q.mapToContactField] = ans;
      const slug = slugOf(q.label);
      if (slug !== '') vars[slug] = ans;
    }
    c.qIndex += 1;
    Object.assign(ctx.run.vars, vars);
    if (c.qIndex < c.questions.length) {
      const out = await ctx.send({ kind: 'text', body: questionPrompt(c) });
      if (!out.ok) return { action: 'route', port: NO_SLOTS, setVars: vars };
      return {
        action: 'stay',
        setVars: vars,
        data: { stage: 'ASK_QUESTIONS', ctx: c, choices: [] },
      };
    }
    const done = await this.finalize(ctx, c);
    if (done.action === 'route') return { ...done, setVars: { ...vars, ...done.setVars } };
    return done;
  }

  // --- the booking ---------------------------------------------------------------------------------------------------------

  private async finalize(ctx: NodeContext, c: BookContext): Promise<CustomDecision> {
    let booked;
    try {
      booked = await this.offers.book(ctx.run.orgId, {
        typeId: c.typeId!,
        startsAt: new Date(c.slotStart!),
        answers: c.answers,
        name: str(ctx.run.vars.name) || null,
        // A phone number only where the peer key is one (WhatsApp); on another channel the booking has none.
        phone: /^(whatsapp|simulator)/.test(ctx.run.channelKind ?? '') ? ctx.run.peerKey : null,
        email: c.email ?? (str(ctx.run.vars.email) || null),
        contactId: ctx.run.contactId,
        conversationId: ctx.run.conversationId,
        ...(c.reservationId ? { reservationId: c.reservationId } : {}),
        sessionRef: ctx.run.uuid,
      });
    } catch (err) {
      if (TAKEN(err)) {
        await ctx.send({ kind: 'text', body: 'That time was just taken — pick another, please.' });
        c.slotOffset = 0;
        c.reservationId = undefined;
        return this.showTimes(ctx, c);
      }
      ctx.note(`the booking was refused: ${err instanceof Error ? err.message : 'error'}`);
      return { action: 'route', port: NO_SLOTS };
    }

    const slot = c.slotLabel ?? c.slotStart ?? '';
    const manageUrl = `${this.webUrl}${booked.manageUrl}`;
    const appt = booked.appointment;
    const setVars = { slot, appointment_choice: slot, appointment_id: appt.uuid };

    if (c.dueNow > 0 && c.hasGateway && appt.paymentStatus === 'pending') {
      const out = await ctx.send({
        kind: 'text',
        body: `Almost done! Please pay ${[c.currency, c.dueNow.toFixed(2)].filter(Boolean).join(' ')} to confirm your ${c.typeName || 'booking'}:\n${manageUrl}\n\nYour slot is held for a few minutes.`,
      });
      if (!out.ok) sendFailed(out, 'skip', ctx);
      // The booking is finished on the payment page, not in the chat: the flow stops here, as WaDesk's did.
      return { action: 'end', reason: 'end_node' };
    }

    const text = ctx.render(confirmationText(c.confirmation, slot, c.typeName ?? '', manageUrl));
    const out = await ctx.send({ kind: 'text', body: text });
    if (!out.ok) sendFailed(out, 'skip', ctx);
    return { action: 'route', port: BOOKED, setVars };
  }

  // --- lists ---------------------------------------------------------------------------------------------------------------

  private withType(c: BookContext, t: OfferedType): BookContext {
    return {
      ...c,
      typeId: t.id,
      typeName: t.name,
      questions: t.questions,
      introMessage: t.introMessage ?? '',
      dueNow: Number(t.dueNow) || 0,
      currency: t.currency ?? '',
      hasGateway: t.hasGateway,
      dayOffset: 0,
      slotOffset: 0,
    };
  }

  /** The days, parked at CHOOSE_DAY; `null` when there is nothing to offer at the first page. */
  private async dayList(
    ctx: NodeContext,
    c: BookContext,
  ): Promise<NodeResult | 'send_failed' | null> {
    const r = await this.offers.days(ctx.run.orgId, c.typeId!, c.dayOffset);
    if (r.days.length === 0 && c.dayOffset === 0) return null;
    const rows = this.dayRows(c, r);
    const out = await ctx.send(listOf('Pick a day:', rows));
    if (!out.ok) return sendFailed(out, 'skip', ctx) ?? 'send_failed';
    return this.park(ctx, { stage: 'CHOOSE_DAY', ctx: c, choices: rows });
  }

  private dayRows(
    c: BookContext,
    r: { days: Array<{ date: string; label: string }>; hasMore: boolean; nextOffset: number },
  ): Choice[] {
    const rows: Choice[] = r.days.map((d, i) => ({
      id: `bk_day_${i}`,
      title: d.label,
      day: d.date,
    }));
    if (r.hasMore) rows.push({ id: 'bk_more', title: 'More days ▸', special: true, more: 'day' });
    if (c.dayOffset > 0) rows.push({ id: 'bk_back', title: '◂ Back', special: true, back: 'day' });
    c.nextDayOffset = r.nextOffset;
    return rows;
  }

  private async showDays(ctx: NodeContext, c: BookContext): Promise<CustomDecision> {
    const r = await this.offers.days(ctx.run.orgId, c.typeId!, c.dayOffset);
    if (r.days.length === 0 && c.dayOffset === 0) return { action: 'route', port: NO_SLOTS };
    const rows = this.dayRows(c, r);
    const out = await ctx.send(listOf('Pick a day:', rows));
    if (!out.ok) return { action: 'route', port: NO_SLOTS };
    return { action: 'stay', data: { stage: 'CHOOSE_DAY', ctx: c, choices: rows } };
  }

  private async showTimes(ctx: NodeContext, c: BookContext): Promise<CustomDecision> {
    const r = await this.offers.times(ctx.run.orgId, c.typeId!, c.day!, c.slotOffset);
    const rows: Choice[] = r.times.map((t, i) => ({
      id: `bk_slot_${i}`,
      title: t.label,
      start: t.start,
      end: t.end,
    }));
    if (r.hasMore) rows.push({ id: 'bk_more', title: 'More times ▸', special: true, more: 'slot' });
    rows.push({ id: 'bk_back', title: '◂ Back to days', special: true, back: 'slot' });
    c.nextSlotOffset = r.nextOffset;
    const out = await ctx.send(listOf('Pick a time:', rows));
    if (!out.ok) return { action: 'route', port: NO_SLOTS };
    return { action: 'stay', data: { stage: 'CHOOSE_SLOT', ctx: c, choices: rows } };
  }

  private park(ctx: NodeContext, wait: BookWait, extra: Record<string, unknown> = {}): NodeResult {
    const spec: WaitSpec = {
      nodeId: ctx.node.id,
      variable: 'appointment_choice',
      kind: 'Custom',
      handler: HANDLER,
      data: { ...wait, ...extra } as unknown as Record<string, unknown>,
    };
    return { kind: 'wait', wait: spec };
  }
}
