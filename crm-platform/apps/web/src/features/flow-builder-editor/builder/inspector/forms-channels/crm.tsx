'use client';

import { GoogleConnectionNotice } from './google-connection';
import { useTranslations } from 'next-intl';
import { Check, Field } from '../kit';
import type { FormComponent } from '../types';
import { formLabel, serviceLabel, stageOptions, withSavedOption } from './helpers';
import { ExtLink, Intro, Mono, Num, Sel, Ta, Txt, voiceAssistantOptions } from './shared';

const NS = 'flb.builder.formsChannels.crm';

export const BookAppointmentForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const { bookingTypes } = p.env.ctx;
  const svcOpts = withSavedOption(
    [
      {
        v: '',
        l: p.env.loading ? t('loadingServices') : t('allServices'),
      },
      ...bookingTypes.map((s) => ({
        v: s.id,
        l: serviceLabel(s.name, s.active, s.duration, th),
      })),
    ],
    p.data.bookingTypeId,
    (id) => t('savedService', { id: id.slice(0, 8) }),
  );
  return (
    <>
      <Intro
        sub={t.rich('bookingSub', {
          link: (c) => <ExtLink href="/appointments">{c}</ExtLink>,
          b: (c) => <b>{c}</b>,
        })}
      >
        {t.rich('bookingIntro', {
          b: (c) => <b>{c}</b>,
          i: (c) => <i>{c}</i>,
          mono: (c) => <Mono>{c}</Mono>,
        })}
      </Intro>
      <Field
        label={t('service')}
        hint={p.env.loading ? t('loadingYourServices') : t('serviceHint')}
      >
        {Sel(p, 'bookingTypeId', svcOpts)}
      </Field>
      <Field label={t('slots')}>{Num(p, 'slotCount', '5')}</Field>
      <Field label={t('prompt')}>{Txt(p, 'prompt', t('promptPlaceholder'))}</Field>
      <Field label={t('confirmation')}>
        {Txt(p, 'confirmation', t('confirmationPlaceholder'))}
      </Field>
    </>
  );
};

export const AiCallForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ts = useTranslations('flb.builder.formsChannels.shared');
  return (
    <>
      <Intro
        sub={t.rich('aiCallSub', {
          link: (c) => <ExtLink href="/ai-training">{c}</ExtLink>,
        })}
      >
        {t.rich('aiCallIntro', { b: (c) => <b>{c}</b>, mono: (c) => <Mono>{c}</Mono> })}
      </Intro>
      <Field label={t('voiceAssistant')} hint={t('voiceAssistantHint')}>
        {Sel(
          p,
          'assistantId',
          voiceAssistantOptions(p, 'assistantId', t('workspaceDefaultAssistant'), ts),
        )}
      </Field>
    </>
  );
};

export const GoogleMeetForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const invite = !!p.data.sendCalendarInvite;
  return (
    <>
      <Intro
        sub={t.rich('meetSub', {
          link: (c) => <ExtLink href="/appointments/settings">{c}</ExtLink>,
        })}
      >
        {t('meetIntro')}
      </Intro>
      <GoogleConnectionNotice need="calendar" />
      <Field label={t('meetingTitle')} hint={t('meetingTitleHint')}>
        {Txt(p, 'title', t('meetingTitlePlaceholder'))}
      </Field>
      <Field label={t('duration')} hint={t('durationHint')}>
        {Num(p, 'durationMinutes', '30')}
      </Field>
      <Field label={t('leadTime')} hint={t('leadTimeHint')}>
        {Num(p, 'leadMinutes', '5')}
      </Field>
      <Field label={t('messageTemplate')} hint={t('messageTemplateHint')}>
        {Ta(p, 'messageTemplate', t('messageTemplatePlaceholder'), 4)}
      </Field>
      <Field label={t('sendInvite')} hint={t('sendInviteHint')}>
        <Check checked={invite} onChange={(v) => p.set('sendCalendarInvite', v)}>
          {invite ? t('inviteOn') : t('inviteOff')}
        </Check>
      </Field>
    </>
  );
};

export const WaFormForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const { forms } = p.env.ctx;
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? t('loadingForms') : t('pickForm') },
      ...forms.map((f) => ({ v: f.id, l: formLabel(f.title, f.isPublished, th) })),
    ],
    p.data.formId,
    (id) => t('savedForm', { id: id.slice(0, 8) }),
  );
  const token = '{{field_id}}';
  return (
    <>
      <Intro
        sub={t.rich('formSub', {
          link: (c) => <ExtLink href="/wa-forms">{c}</ExtLink>,
        })}
      >
        {t.rich('formIntro', { token, mono: (c) => <Mono>{c}</Mono> })}
      </Intro>
      <Field label={t('form')} hint={p.env.loading ? t('loading') : t('formHint')}>
        {Sel(p, 'formId', opts)}
      </Field>
      <Field label={t('bodyBubble')}>{Txt(p, 'bodyText', t('bodyBubblePlaceholder'))}</Field>
      <Field label={t('ctaLabel')}>{Txt(p, 'ctaLabel', t('ctaPlaceholder'))}</Field>
      <Field
        label={t('saveSubmission')}
        hint={t.rich('saveSubmissionHint', { token, mono: (c) => <Mono>{c}</Mono> })}
      >
        {Txt(p, 'flowVariable', 'form_submission')}
      </Field>
    </>
  );
};

export const DealForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const th = useTranslations('flb.builder.formsChannels.helpers');
  const { stages } = p.env.ctx;
  const stageOpts = withSavedOption(
    [
      { v: '', l: p.env.loading ? t('loadingStages') : t('pickStage') },
      ...stageOptions(stages, th),
    ],
    p.data.stageId,
    (id) => t('savedStage', { id: id.slice(0, 8) }),
  );
  const saveAs = String(p.data.saveAs || 'deal_id');
  return (
    <>
      <Intro>
        {t.rich('dealIntro', {
          token: `{{${saveAs}}}`,
          mono: (c) => <Mono>{c}</Mono>,
          b: (c) => <b>{c}</b>,
        })}
      </Intro>
      <Field
        label={t('action')}
        hint={p.data.action === 'move' ? t('actionMoveHint') : t('actionCreateHint')}
      >
        {Sel(p, 'action', [
          { v: 'create', l: t('actionCreate') },
          { v: 'move', l: t('actionMove') },
        ])}
      </Field>
      <Field
        label={t('stage')}
        hint={t.rich('stageHint', { link: (c) => <ExtLink href="/deals">{c}</ExtLink> })}
      >
        {Sel(p, 'stageId', stageOpts)}
      </Field>
      <Field label={t('dealName')} hint={t('dealNameHint')}>
        {Txt(p, 'dealName', t('dealNamePlaceholder'))}
      </Field>
      <Field label={t('dealValue')} hint={t('dealValueHint')}>
        {Txt(p, 'value', '5000')}
      </Field>
      <Field
        label={t('saveDealId')}
        hint={t.rich('saveDealIdHint', { token: '{{deal_id}}', mono: (c) => <Mono>{c}</Mono> })}
      >
        {Txt(p, 'saveAs', 'deal_id')}
      </Field>
    </>
  );
};
