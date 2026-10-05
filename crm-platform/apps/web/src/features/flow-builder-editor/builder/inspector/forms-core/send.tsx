'use client';

import { Field, Notice, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';
import { acceptFor, str, withCurrent } from './helpers';
import { InfoBox, Link, UploadBox, UploadedFile, uploadFile, V } from './parts';
import { MediaPreview, MessagePreview, TemplatePreview } from './previews';

export function MessageForm({ data: d, set }: FormProps) {
  return (
    <>
      <MessagePreview d={d} />
      <Field
        label="Message text"
        hint={
          <>
            Use <V>var</V> or press / to insert a variable.
          </>
        }
      >
        <TextArea
          value={d.text}
          placeholder="Hi {{name}}! …"
          rows={6}
          onChange={(v) => set('text', v)}
        />
      </Field>
    </>
  );
}

export function TemplateForm({ data: d, setMany, env }: FormProps) {
  const templates = env.ctx.templates;
  const opts = withCurrent(
    [
      { v: '', l: env.loading ? 'Loading templates…' : '— pick template —' },
      ...templates.map((t) => ({ v: t.name, l: t.name + (t.category ? ` · ${t.category}` : '') })),
    ],
    d.tpl,
    (v) => `${v} (not in workspace)`,
  );
  // Picking stamps both the name (what the runtime sends) and the template id, like WaDesk.
  const pick = (name: string) => {
    const hit = templates.find((t) => t.name === name);
    setMany({ tpl: name, tplId: hit ? hit.id : null });
  };
  return (
    <>
      <TemplatePreview d={d} templates={templates} />
      <Field
        label="Approved template"
        hint={
          <>
            Only approved templates from the workspace appear here.{' '}
            <Link href="/templates/create">Create a new one →</Link>
          </>
        }
      >
        <SelectInput value={d.tpl} options={opts} onChange={pick} />
      </Field>
      {d.tplId ? (
        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
          template_id = {str(d.tplId)}
        </div>
      ) : null}
    </>
  );
}

export function MediaForm({ data: d, set, setMany, env }: FormProps) {
  const kind = str(d.kind) || 'image';
  const url = str(d.url);
  return (
    <>
      <MediaPreview d={d} />
      <Field label="Type">
        <SelectInput
          value={d.kind}
          options={[
            { v: 'image', l: 'Image' },
            { v: 'video', l: 'Video' },
            { v: 'document', l: 'Document' },
            { v: 'audio', l: 'Audio' },
          ]}
          onChange={(v) => set('kind', v)}
        />
      </Field>
      <Field label="Upload" hint="Up to 50 MB. We host the file and give the flow a public URL.">
        <UploadBox
          accept={acceptFor(kind)}
          label={url ? 'Replace file' : `Choose ${kind} (or drag here)`}
          onFile={(file) =>
            uploadFile(env, file, kind as 'image', (res) =>
              setMany({ url: res.url, filename: res.filename }),
            )
          }
        />
        {url ? <UploadedFile kind={kind} url={url} filename={str(d.filename)} /> : null}
      </Field>
      <Field label="Or paste a URL">
        <TextInput
          value={d.url}
          placeholder="https://example.com/image.jpg"
          onChange={(v) => set('url', v)}
        />
      </Field>
      <Field label="Filename (label)">
        <TextInput
          value={d.filename}
          placeholder="catalogue.pdf"
          onChange={(v) => set('filename', v)}
        />
      </Field>
      <Field label="Caption">
        <TextArea
          value={d.caption}
          placeholder="Optional caption…"
          rows={3}
          onChange={(v) => set('caption', v)}
        />
      </Field>
    </>
  );
}

export function NotifyNumberForm({ data: d, set }: FormProps) {
  const isMedia = !!d.kind && d.kind !== 'text';
  const src = d.source === 'custom' ? 'custom' : 'mirror';
  return (
    <>
      <Notice tone="info">
        Sends a copy to a <b>fixed number</b> you set here — the flow&apos;s own contact still gets
        their normal messages. The second person just receives a normal WhatsApp message on their
        phone (no login/app needed). Use it to CC a doctor, clinic, or your own line with a report
        or alert.
      </Notice>
      <Field
        label="Copy to number"
        hint={
          <>
            Full international format, digits only (country code + number). Variables like{' '}
            <V>agent_number</V> are allowed.
          </>
        }
      >
        <TextInput
          value={d.copyNumber}
          placeholder="15551234567"
          onChange={(v) => set('copyNumber', v)}
        />
      </Field>
      <Field
        label="What to send"
        hint={
          src === 'mirror'
            ? 'Automatically forwards whatever the flow last sent to the customer (e.g. the report). No typing needed.'
            : 'Type your own message or attach a report below.'
        }
      >
        <SelectInput
          value={src}
          options={[
            { v: 'mirror', l: 'Same message the customer just received (automatic)' },
            { v: 'custom', l: 'A custom message / report' },
          ]}
          onChange={(v) => set('source', v)}
        />
      </Field>
      {src === 'mirror' ? (
        <InfoBox className="text-foreground/70">
          The doctor/clinic gets an exact copy of the last message the customer received — put this
          node right after the message or report you want copied.
        </InfoBox>
      ) : (
        <>
          <Field label="Type">
            <SelectInput
              value={d.kind}
              options={[
                { v: 'text', l: 'Text' },
                { v: 'image', l: 'Image' },
                { v: 'document', l: 'Document (PDF report, etc.)' },
                { v: 'video', l: 'Video' },
                { v: 'audio', l: 'Audio' },
              ]}
              onChange={(v) => set('kind', v)}
            />
          </Field>
          {!isMedia ? (
            <Field label="Message" hint="Supports {{variables}} captured earlier in the flow.">
              <TextArea
                value={d.text}
                placeholder="A copy of the report / alert…"
                onChange={(v) => set('text', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field
              label="Media URL"
              hint="Public HTTPS link (can be a {{variable}} holding the file URL)."
            >
              <TextInput
                value={d.url}
                placeholder="https://example.com/report.pdf"
                onChange={(v) => set('url', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field label="Filename (label)">
              <TextInput
                value={d.filename}
                placeholder="report.pdf"
                onChange={(v) => set('filename', v)}
              />
            </Field>
          ) : null}
          {isMedia ? (
            <Field label="Caption">
              <TextArea
                value={d.caption}
                placeholder="Optional caption…"
                rows={3}
                onChange={(v) => set('caption', v)}
              />
            </Field>
          ) : null}
        </>
      )}
    </>
  );
}

export function WaToInstagramForm({ data: d, set }: FormProps) {
  return (
    <>
      <Notice tone="ig">
        Sends the customer a WhatsApp message with a link that opens a DM to your Instagram.{' '}
        <b>Deep link only</b> — Instagram doesn&apos;t allow starting a DM to someone who
        hasn&apos;t messaged you first, so we can&apos;t auto-open the chat for them.
      </Notice>
      <Field
        label="Your Instagram username"
        hint="Without the @. The link becomes ig.me/m/yourbrand — tapping it opens a DM to your account."
      >
        <TextInput
          value={d.igUsername}
          placeholder="yourbrand"
          onChange={(v) => set('igUsername', v)}
        />
      </Field>
      <Field
        label="WhatsApp message"
        hint="Sent to the customer on WhatsApp with the Instagram link. Supports {{variables}}."
      >
        <TextArea
          value={d.introText}
          placeholder="Continue with us on Instagram 👇"
          rows={2}
          onChange={(v) => set('introText', v)}
        />
      </Field>
    </>
  );
}
