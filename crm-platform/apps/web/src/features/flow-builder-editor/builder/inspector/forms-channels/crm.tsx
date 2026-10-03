'use client';

import { Check, Field } from '../kit';
import type { FormComponent } from '../types';
import { formLabel, serviceLabel, stageOptions, withSavedOption } from './helpers';
import { ExtLink, Intro, Mono, Num, Sel, Ta, Txt, voiceAssistantOptions } from './shared';

export const BookAppointmentForm: FormComponent = (p) => {
  const { bookingTypes } = p.env.ctx;
  const svcOpts = withSavedOption(
    [
      {
        v: '',
        l: p.env.loading ? 'Loading services…' : '— all my services (customer picks) —',
      },
      ...bookingTypes.map((s) => ({ v: s.id, l: serviceLabel(s.name, s.active, s.duration) })),
    ],
    p.data.bookingTypeId,
    (id) => `Service ${id.slice(0, 8)} (not loaded)`,
  );
  return (
    <>
      <Intro
        sub={
          <>
            Manage services + hours at <ExtLink href="/appointments">/appointments</ExtLink>. The
            keyword lives in this flow&apos;s <b>Trigger</b>.
          </>
        }
      >
        Books an appointment inside the chat. Pin this node to one <b>service</b> for a dedicated
        flow (e.g. keyword <Mono>consult</Mono> → 30-min Consultation), or leave it on{' '}
        <i>all services</i> to let the customer choose.
      </Intro>
      <Field
        label="Service"
        hint={
          p.env.loading
            ? 'Loading your services…'
            : 'Pick one service, or leave on “all” for a menu.'
        }
      >
        {Sel(p, 'bookingTypeId', svcOpts)}
      </Field>
      <Field label="Slots to offer">{Num(p, 'slotCount', '5')}</Field>
      <Field label="Prompt (sent before the list)">
        {Txt(p, 'prompt', 'Pick a time that works for you:')}
      </Field>
      <Field label="Confirmation message">
        {Txt(p, 'confirmation', 'Booked! See you on {{slot}}.')}
      </Field>
    </>
  );
};

export const AiCallForm: FormComponent = (p) => (
  <>
    <Intro
      sub={
        <>
          Manage voice agents in <ExtLink href="/ai-training">AI voice assistants</ExtLink>.
          Requires WABA calling enabled + the customer&apos;s call permission.
        </>
      }
    >
      Places a WhatsApp <b>voice call</b> to this contact, answered by an AI voice agent. Drop it
      after a keyword trigger (e.g. <Mono>call me</Mono>) so the customer is called automatically.
    </Intro>
    <Field
      label="Voice assistant"
      hint="The AI agent that talks on the call. Blank = the workspace default voice assistant."
    >
      {Sel(
        p,
        'assistantId',
        voiceAssistantOptions(p, 'assistantId', '— workspace default assistant —'),
      )}
    </Field>
  </>
);

export const GoogleMeetForm: FormComponent = (p) => {
  const invite = !!p.data.sendCalendarInvite;
  return (
    <>
      <Intro
        sub={
          <>
            Requires Google Calendar at{' '}
            <ExtLink href="/appointments/settings">/appointments/settings</ExtLink>.
          </>
        }
      >
        Creates a Google Calendar event with a Meet link the moment this node fires, then sends the
        link to the customer.
      </Intro>
      <Field
        label="Meeting title"
        hint="Shown in Google Calendar. Use {{name}} or any flow variable."
      >
        {Txt(p, 'title', 'WhatsApp consultation with {{name}}')}
      </Field>
      <Field label="Duration (minutes)" hint="How long the calendar event lasts.">
        {Num(p, 'durationMinutes', '30')}
      </Field>
      <Field
        label="Lead time (minutes)"
        hint="Schedule the meeting N minutes from now, so the customer has time to read the message."
      >
        {Num(p, 'leadMinutes', '5')}
      </Field>
      <Field
        label="Message template"
        hint="Sent to the customer with the link. {{meet_link}} and {{meet_start}} get substituted."
      >
        {Ta(p, 'messageTemplate', 'Your meeting link:\n{{meet_link}}\n\nStarts {{meet_start}}', 4)}
      </Field>
      <Field
        label="Send Google invite to attendees"
        hint="Only useful when the contact has an email saved."
      >
        <Check checked={invite} onChange={(v) => p.set('sendCalendarInvite', v)}>
          {invite ? 'On — Google emails the attendees' : 'Off — link only via WhatsApp'}
        </Check>
      </Field>
    </>
  );
};

export const WaFormForm: FormComponent = (p) => {
  const { forms } = p.env.ctx;
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? 'Loading forms…' : '— pick form —' },
      ...forms.map((f) => ({ v: f.id, l: formLabel(f.title, f.isPublished) })),
    ],
    p.data.formId,
    (id) => `Form ${id.slice(0, 8)} (not loaded)`,
  );
  return (
    <>
      <Intro
        sub={
          <>
            Build + publish forms at <ExtLink href="/wa-forms">/wa-forms</ExtLink>.
          </>
        }
      >
        Sends a published WhatsApp Form to the customer. The flow pauses until they submit, then
        advances with each field available as <Mono>{'{{field_id}}'}</Mono>.
      </Intro>
      <Field label="Form" hint={p.env.loading ? 'Loading…' : 'Only published forms appear here.'}>
        {Sel(p, 'formId', opts)}
      </Field>
      <Field label="Body bubble text (above the form button)">
        {Txt(p, 'bodyText', 'Please tap below to fill out our quick form.')}
      </Field>
      <Field label="CTA label (on the button)">{Txt(p, 'ctaLabel', 'Open form')}</Field>
      <Field
        label="Save submission under variable"
        hint={
          <>
            Field values land as <Mono>{'{{field_id}}'}</Mono> regardless — this is just a marker
            for the audit log.
          </>
        }
      >
        {Txt(p, 'flowVariable', 'form_submission')}
      </Field>
    </>
  );
};

export const DealForm: FormComponent = (p) => {
  const { stages } = p.env.ctx;
  const stageOpts = withSavedOption(
    [{ v: '', l: p.env.loading ? 'Loading stages…' : '— pick stage —' }, ...stageOptions(stages)],
    p.data.stageId,
    (id) => `Stage ${id.slice(0, 8)} (not loaded)`,
  );
  const saveAs = String(p.data.saveAs || 'deal_id');
  return (
    <>
      <Intro>
        Creates a CRM deal (or moves the contact&apos;s open deal) into a pipeline stage — so a
        chatbot can qualify a lead and push it up the board. The deal id is saved as{' '}
        <Mono>{`{{${saveAs}}}`}</Mono>. Moving into a stage fires the <b>deal stage</b> trigger on
        other flows.
      </Intro>
      <Field
        label="Action"
        hint={
          p.data.action === 'move'
            ? "Re-stages the contact's most recent open deal. If they have none, a new deal is created."
            : 'Always creates a fresh deal linked to this contact.'
        }
      >
        {Sel(p, 'action', [
          { v: 'create', l: 'Create a new deal' },
          { v: 'move', l: "Move the contact's deal to a stage" },
        ])}
      </Field>
      <Field
        label="Pipeline stage"
        hint={
          <>
            Required. Manage stages on the <ExtLink href="/deals">deals board</ExtLink>.
          </>
        }
      >
        {Sel(p, 'stageId', stageOpts)}
      </Field>
      <Field label="Deal name" hint="Supports {{contact_name}}, {{phone}}, and any flow variable.">
        {Txt(p, 'dealName', '{{contact_name}} — deal')}
      </Field>
      <Field
        label="Deal value (optional)"
        hint="A number or a {{variable}}. Stored in the pipeline currency."
      >
        {Txt(p, 'value', '5000')}
      </Field>
      <Field
        label="Save deal id under variable"
        hint={
          <>
            Use <Mono>{'{{deal_id}}'}</Mono> in later nodes.
          </>
        }
      >
        {Txt(p, 'saveAs', 'deal_id')}
      </Field>
    </>
  );
};
