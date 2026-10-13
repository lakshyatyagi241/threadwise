'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { FlowWidgetSaveInput, Widget } from '@crm/contracts';
import { Spinner, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  saveFlowWidget,
  uploadFlowWidgetImage,
  useDefaultCountry,
  useFlowWidget,
} from '../api/widgets';
import {
  fromWidget,
  newState,
  toPayload,
  validateWhatsapp,
  type BuilderState,
  type WhatsappCard,
} from '../lib/builder-model';
import { dialCodeOf, splitInternational } from '../lib/phone';
import type { PreviewDevice } from './launcher-preview';
import { WhatsappBuilder } from './whatsapp-builder';

/** What a WhatsApp bot already knows that its website button is made from: the number it runs on and the word that starts it. */
export interface WhatsappBotDefaults {
  /** The number picked on the bot's Trigger, as the sender lists it (digits, with or without a plus), or null when none is chosen. */
  phone: string | null;
  /** The label of that number (its name in Settings), for the line that says which number the button opens. */
  numberLabel: string;
  /** The keyword that starts the bot; empty when it starts on any message. */
  keyword: string;
}

/** The dial code and national digits of a number, or null when it has none or does not parse. */
export function splitNumber(phone: string | null): { cc: string; number: string } | null {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (digits === '') return null;
  const split = splitInternational(`+${digits}`);
  if (split) return { cc: dialCodeOf(split.country), number: split.national };
  // A number whose country cannot be told (Meta's test numbers, new ranges) still has a dial code and national digits.
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  return parsed ? { cc: `+${parsed.countryCallingCode}`, number: parsed.nationalNumber } : null;
}

/**
 * The button's number and message, always taken from the bot: its Trigger's number, and its keyword as the text a tap sends so the
 * keyword starts the bot (any-message bots keep the default text). Nothing here is asked for twice.
 */
export function botTarget(base: BuilderState, d: WhatsappBotDefaults): BuilderState {
  const split = splitNumber(d.phone);
  return {
    ...base,
    targetWhatsappCc: split?.cc ?? '',
    targetWhatsappNumber: split?.number ?? '',
    ...(d.keyword.trim() === '' ? {} : { prefilledMessage: d.keyword.trim() }),
  };
}

/** A new bot's button: the look the WhatsApp widget opens on, aimed at the bot. */
export function whatsappStart(botName: string, d: WhatsappBotDefaults): BuilderState {
  const base = newState();
  return botTarget(
    {
      ...base,
      mode: 'whatsapp',
      name: botName,
      // A new bot's button draws the eye: a popup that invites a chat, and a ripple on the button. Both can be switched off.
      launcher: {
        ...base.launcher,
        popup: { ...base.launcher.popup, enabled: true },
        animation: 'ripple',
      },
    },
    d,
  );
}

/**
 * The Customize tab of a WhatsApp bot: the website button that opens a chat with the bot on WhatsApp (the cards of the Chat widget's
 * WhatsApp page, without its page header, name, type or number card). The number and the message come from the bot, which is told
 * where they were chosen. Until it has been saved once the bot has no widget, which keeps the reminder on and Publish asking for it.
 */
export function FlowWhatsappCustomize({
  flowId,
  flowName,
  canEdit,
  defaults,
  onSaved,
}: {
  flowId: string;
  flowName: string;
  canEdit: boolean;
  defaults: WhatsappBotDefaults;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.whatsapp');
  const q = useFlowWidget(flowId);
  if (q.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (q.isError) return <p className="p-8 text-center text-[13px] text-danger">{t('loadError')}</p>;
  const widget = q.data.widget;
  return (
    <Panel
      key={widget?.rowVersion ?? 'new'}
      flowId={flowId}
      initial={widget ? fromWidget(widget) : whatsappStart(flowName, defaults)}
      untouched={widget === null}
      canEdit={canEdit}
      defaults={defaults}
      onSaved={onSaved}
    />
  );
}

function Panel({
  flowId,
  initial,
  untouched,
  canEdit,
  defaults,
  onSaved,
}: {
  flowId: string;
  initial: BuilderState;
  untouched: boolean;
  canEdit: boolean;
  defaults: WhatsappBotDefaults;
  onSaved?: (widget: Widget) => void;
}) {
  const t = useTranslations('chatbotWidget.flowBot.whatsapp');
  const w = useTranslations('chatbotWidget.whatsappBuilder');
  const qc = useQueryClient();
  const { toast } = useToast();
  const defaultCountry = useDefaultCountry();
  const [look, setLook] = useState(initial);
  const [flash, setFlash] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<0 | WhatsappCard>(1);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BuilderState>) => setLook((prev) => ({ ...prev, ...patch }));

  // What is shown, previewed and saved always follows the bot, so a number changed on the Trigger is never left behind here.
  const s = botTarget(look, defaults);
  const hasNumber = splitNumber(defaults.phone) !== null;

  const save = async () => {
    if (busy) return;
    if (!hasNumber) {
      toast(t('noNumber'), 'danger');
      return;
    }
    const bad = validateWhatsapp(s, { bot: true });
    if (!bad.ok) {
      setOpenCard(bad.card);
      toast(w(`problem.${bad.key}`), 'danger');
      setFlash(bad.field);
      window.setTimeout(() => setFlash(null), 2600);
      return;
    }
    // The bot supplies the name and the mode; the rest is the button.
    const { name: _name, mode: _mode, assistantId: _assistant, ...button } = toPayload(s);
    const body: FlowWidgetSaveInput = {
      ...button,
      ...(s.rowVersion === null ? {} : { rowVersion: s.rowVersion }),
    };
    setBusy(true);
    try {
      const saved = await saveFlowWidget(flowId, body);
      await qc.invalidateQueries({ queryKey: KEYS.flow(flowId) });
      toast(t('saved'), 'success');
      onSaved?.(saved);
    } catch (e) {
      const detail = e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : null;
      toast(detail ?? t('saveFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {untouched ? (
        <p
          role="status"
          data-testid="customize-untouched"
          className="mx-4 mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[12.5px] sm:mx-6 lg:mx-7"
        >
          {t('untouched')}
        </p>
      ) : null}
      {hasNumber ? (
        <p
          data-testid="whatsapp-from-bot"
          className="mx-4 mt-4 rounded-xl border border-border bg-background p-3 text-[12.5px] sm:mx-6 lg:mx-7"
        >
          {t('fromBot', {
            number: `${defaults.numberLabel} +${(defaults.phone ?? '').replace(/\D+/g, '')}`,
          })}
        </p>
      ) : (
        <p
          role="alert"
          data-testid="whatsapp-no-number"
          className="mx-4 mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-[12.5px] sm:mx-6 lg:mx-7"
        >
          {t('noNumber')}
        </p>
      )}
      <WhatsappBuilder
        embedded
        s={s}
        set={set}
        flash={flash}
        editing={!untouched}
        saved={!untouched}
        canSave={canEdit}
        openCard={openCard}
        onOpenCard={setOpenCard}
        device={device}
        onDevice={setDevice}
        defaultIso={defaultCountry.data}
        snippet={null}
        upload={(slot, file) => uploadFlowWidgetImage(flowId, slot, file)}
        onCopy={() => undefined}
        onSave={() => void save()}
      />
    </div>
  );
}
