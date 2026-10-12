'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Select, Spinner, cn, useToast } from '@crm/ui';
import {
  simulatorInboundSchema,
  type ChannelResponse,
  type SimulatorInboundInput,
} from '@crm/contracts';
import { useStoredValue } from '@/lib/use-stored-value';
import { refreshChannels } from '../api/hooks';
import { inboxApi } from '../api/service';
import { errorCode } from '../lib/errors';
import { Drawer, useErrorText } from './parts';

/** What the next message the agent sends will do, chosen by the simulator's body prefixes (`/fail`, `/flaky`, `/slow`, `/ooo`). */
export const SEND_FAULTS = ['none', 'fail', 'flaky', 'slow', 'ooo'] as const;
export type SendFault = (typeof SEND_FAULTS)[number];

/** The body the simulator reads a fault from: the prefix, then the text. */
export function withFault(text: string, fault: SendFault): string {
  return fault === 'none' ? text : `/${fault}${text ? ` ${text}` : ''}`.trim();
}

type Kind = 'text' | 'image' | 'document' | 'audio' | 'video' | 'location';
const KINDS: Kind[] = ['text', 'image', 'document', 'audio', 'video', 'location'];

const SAMPLE_MIME: Record<Exclude<Kind, 'text' | 'location'>, { mime: string; name: string }> = {
  image: { mime: 'image/png', name: 'photo.png' },
  document: { mime: 'application/pdf', name: 'invoice.pdf' },
  audio: { mime: 'audio/ogg', name: 'voice-note.ogg' },
  video: { mime: 'video/mp4', name: 'clip.mp4' },
};

export interface SimulatorDrawerProps {
  open: boolean;
  onClose: () => void;
  channels: ChannelResponse[];
  fault: SendFault;
  onFault: (fault: SendFault) => void;
}

/**
 * The dev-only "Customer simulator": a pretend customer that talks to a simulator channel through the same ingest queue a real
 * provider webhook feeds. It is shown only when the API has a simulator channel (the flag is on and the environment is not
 * production), and floats beside the inbox so what it sends can be watched arriving. It never touches a real channel.
 */
export function SimulatorDrawer(props: SimulatorDrawerProps) {
  const t = useTranslations('team-inbox-conversations.simulator');
  const { toast } = useToast();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const sims = props.channels.filter((c) => c.kind === 'simulator');
  const [channelId, setChannelId] = useState<string>('');
  const channel = sims.find((c) => c.id === channelId) ?? sims[0];

  const [name, setName] = useStoredValue('inbox.sim.name');
  const [number, setNumber] = useStoredValue('inbox.sim.number');
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const nameValue = name ?? 'Asha Verma';
  const numberValue = number ?? '919876543210';

  function build(dup: boolean): SimulatorInboundInput | null {
    const base = { from: numberValue.replace(/\D/g, ''), name: nameValue.trim() || undefined };
    let input: unknown;
    if (kind === 'text') {
      input = { ...base, kind: 'text', text, fault: dup ? 'dup' : undefined };
    } else if (kind === 'location') {
      input = {
        ...base,
        kind: 'location',
        text: text || undefined,
        location: {
          latitude: 19.076,
          longitude: 72.8777,
          name: text.trim() || 'Mumbai',
          address: 'Mumbai, India',
        },
        fault: dup ? 'dup' : undefined,
      };
    } else {
      const sample = SAMPLE_MIME[kind];
      input = {
        ...base,
        kind: 'media',
        text: text || undefined,
        media: {
          mediaKind: file ? mediaKindOf(file.type, kind) : kind,
          mime: file?.type || sample.mime,
          name: file?.name ?? sample.name,
          sizeBytes: file?.size,
        },
        fault: dup ? 'dup' : undefined,
      };
    }
    const parsed = simulatorInboundSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0] ?? 'form')] = issue.message;
      setErrors(next);
      return null;
    }
    setErrors({});
    return parsed.data;
  }

  async function sendAsCustomer(dup: boolean) {
    if (!channel) return;
    const body = build(dup);
    if (!body) return;
    setBusy(true);
    try {
      const out = await inboxApi.simulatorInbound(channel.id, body);
      toast(t('sent', { count: out.deliveries }), 'success');
      setText('');
      setFile(null);
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function setWindow(window: 'auto' | 'open' | 'closed') {
    if (!channel) return;
    setBusy(true);
    try {
      await inboxApi.updateChannel(channel.id, {
        rowVersion: channel.rowVersion,
        settings: { simulator: { window } },
      });
      await refreshChannels(qc);
      // The open thread's window state comes from its detail: read it again.
      await qc.invalidateQueries({ queryKey: ['inbox', 'conversation'] });
    } catch (e) {
      toast(errorText(e), 'danger');
      await refreshChannels(qc);
    } finally {
      setBusy(false);
    }
  }

  async function createChannel() {
    setBusy(true);
    try {
      const created = await inboxApi.createSimulatorChannel({ name: 'Simulator' });
      setChannelId(created.id);
      await refreshChannels(qc);
    } catch (e) {
      toast(errorCode(e) === 'CHANNEL_SIMULATOR_DISABLED' ? t('disabled') : errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  const windowMode = channel?.settings.simulator?.window ?? 'auto';

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title={t('title')}
      closeLabel={t('close')}
      modal={false}
      testId="inbox-simulator"
      className="inset-y-auto bottom-4 end-4 h-auto max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] rounded-xl border"
    >
      <div className="space-y-4 p-4 text-sm">
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{t('devOnly')}</p>

        {!channel ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">{t('noChannel')}</p>
            <Button onClick={() => void createChannel()} disabled={busy}>
              {busy && <Spinner />}
              {t('createChannel')}
            </Button>
          </div>
        ) : (
          <>
            {sims.length > 1 && (
              <Field label={t('channel')} htmlFor="sim-channel">
                <Select
                  id="sim-channel"
                  value={channel.id}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  {sims.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('customer')}
              </legend>
              <Field label={t('name')} htmlFor="sim-name" error={errors.name}>
                <Input id="sim-name" value={nameValue} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label={t('number')}
                htmlFor="sim-number"
                error={errors.from}
                hint={t('numberHint')}
              >
                <Input
                  id="sim-number"
                  inputMode="numeric"
                  dir="ltr"
                  value={numberValue}
                  onChange={(e) => setNumber(e.target.value)}
                  invalid={Boolean(errors.from)}
                />
              </Field>
              <Field label={t('kind')} htmlFor="sim-kind">
                <Select
                  id="sim-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {kind !== 'text' && kind !== 'location' && (
                <Field label={t('file')} htmlFor="sim-file" hint={t('fileHint')}>
                  <input
                    id="sim-file"
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs"
                  />
                </Field>
              )}
              <Field
                label={
                  kind === 'location'
                    ? t('placeName')
                    : kind === 'text'
                      ? t('message')
                      : t('caption')
                }
                htmlFor="sim-text"
                error={errors.text}
              >
                <Input
                  id="sim-text"
                  data-testid="sim-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void sendAsCustomer(false);
                    }
                  }}
                  invalid={Boolean(errors.text)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="sim-send"
                  disabled={busy}
                  onClick={() => void sendAsCustomer(false)}
                >
                  {busy && <Spinner />}
                  {t('send')}
                </Button>
                <Button
                  variant="secondary"
                  data-testid="sim-duplicate"
                  disabled={busy}
                  onClick={() => void sendAsCustomer(true)}
                  title={t('duplicateHint')}
                >
                  {t('duplicate')}
                </Button>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('nextSend')}
              </legend>
              <p className="text-xs text-muted-foreground">{t('nextSendHint')}</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('nextSend')}>
                {SEND_FAULTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={props.fault === f}
                    data-testid={`sim-fault-${f}`}
                    onClick={() => props.onFault(f)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary',
                      props.fault === f
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {t(`faults.${f}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('window')}
              </legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('window')}>
                {(['auto', 'open', 'closed'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={windowMode === w}
                    data-testid={`sim-window-${w}`}
                    disabled={busy}
                    onClick={() => void setWindow(w)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
                      windowMode === w
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {t(`windows.${w}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('windowHint')}</p>
            </fieldset>
          </>
        )}
      </div>
    </Drawer>
  );
}

function mediaKindOf(mime: string, fallback: Kind): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime) return 'document';
  return fallback === 'image' || fallback === 'video' || fallback === 'audio'
    ? fallback
    : 'document';
}
