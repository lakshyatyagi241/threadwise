'use client';

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Field,
  Input,
  Drawer,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import {
  PhoneField,
  type PhoneValue,
} from '@/features/auth-registration-security/shared/phone-field';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { CompanyPicker, useCanPickCompany } from '@/features/companies';
import { LeadScoreField, isScoreInvalid } from '@/features/lead-scoring';
import {
  createContact,
  fetchContact,
  invalidateContacts,
  KEYS,
  updateContact,
} from '../api/contacts';
import { useStatusOptions } from '../api/attributes';
import { useContactFields, useFieldDependencies, useFieldSections } from '../api/properties';
import { setContactGroups, useGroups } from '../api/groups';
import { useOwners } from '../api/owners';
import { attachTagToContact, detachTag, useContactTags, useTags } from '../api/tags';
import type { ContactRow } from '../api/schemas';
import {
  contactToForm,
  EMPTY_FORM,
  TITLES,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
  type ContactFormValues,
} from '../lib/contact-model';
import { fieldErrors, errorKind } from '../lib/errors';
import { checkValue, isFieldApplicable } from '../lib/field-values';
import { stageChoices, statusChoices } from '../lib/option-sets';
import {
  effectiveStage,
  statusAfterMove,
  statusNotice,
  type StatusNotice,
} from '../lib/status-scope';
import { CustomFieldsSection, isFormField } from './custom-fields-section';
import { ErrorLine } from './error-line';
import { LostReasonFields, useLostReasonChoices } from './lost-reason';
import { TimezoneSelect } from './timezone-select';
import {
  OTHER_REASON,
  isLostStage,
  lostReasonPayload,
  lostReasonProblem,
  type LostReasonAnswer,
} from '../lib/stage-flow';
import { GroupChip } from './chips';
import { TagsEditor, type TagLite } from './tags-editor';

export interface ContactFormModalProps {
  open: boolean;
  /** Present = edit this contact; absent = add a new one. */
  contact?: ContactRow;
  onClose: () => void;
  onSaved?: (contact: ContactRow) => void;
}

/** Add / edit contact (TW-CON-009, 010), in a drawer from the side. The form is mounted only while open, so it always starts from the contact's saved state. */
export function ContactFormModal({ open, contact, onClose, onSaved }: ContactFormModalProps) {
  const t = useTranslations('contacts-attributes-tags.form');
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="block">
          <span
            aria-hidden="true"
            className="block font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-muted-foreground"
          >
            {contact ? t('editEyebrow') : t('addEyebrow')}
          </span>
          {contact ? t('editTitle') : t('addTitle')}
        </span>
      }
      closeLabel={t('close')}
      className="w-[min(44rem,100vw)]"
    >
      {open && (
        <ContactForm
          key={contact?.id ?? 'new'}
          contact={contact}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}

function ContactForm({
  contact,
  onClose,
  onSaved,
}: {
  contact?: ContactRow;
  onClose: () => void;
  onSaved?: (c: ContactRow) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.form');
  const tt = useTranslations('contacts-attributes-tags.tags');
  const tl = useTranslations('contacts-attributes-tags.lost');
  const tz = useTranslations('contacts-attributes-tags.timezone');
  const canPickCompany = useCanPickCompany();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreateTags = useCan('record.tags.create');
  const session = useSession();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const editing = contact !== undefined;
  const [values, setValues] = useState<ContactFormValues>(() =>
    // A new contact belongs to whoever creates it, as in Reference (it stamped `user_id` with the caller); "Unassigned" is one click away.
    contact ? contactToForm(contact) : { ...EMPTY_FORM, ownerId: session.user.id },
  );
  const [phone, setPhone] = useState<PhoneValue>({
    e164: contact?.phone ?? null,
    empty: !contact?.phone,
    problem: null,
  });
  const [problems, setProblems] = useState<
    Partial<Record<'firstName' | 'phone' | 'email', string>>
  >({});
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(contact?.rowVersion ?? 0);
  const [conflict, setConflict] = useState(false);
  const [pendingTags, setPendingTags] = useState<TagLite[]>([]);
  const [lostProblem, setLostProblem] = useState<'pick' | 'text' | null>(null);
  const [scoreProblem, setScoreProblem] = useState(false);
  /** What changing the stage just did to the status field (shown under it until the person picks a status). */
  const [statusMove, setStatusMove] = useState<StatusNotice>({ kind: 'none' });

  const registry = useContactFields();
  const sections = useFieldSections();
  const dependencies = useFieldDependencies();
  const statusOptions = useStatusOptions();
  const groups = useGroups();
  const owners = useOwners();
  const allTags = useTags();
  const contactTags = useContactTags(contact?.id ?? null);
  const initialGroups = useRef((contact?.groups ?? []).map((g) => g.id));

  // The workspace's contact properties (Settings, Contact properties): active, not hidden. They are the fields
  // this form writes into the contact's custom values; a read-only one is shown but never sent, and one whose
  // "show only when" rule is unmet is neither shown nor sent.
  const formFields = useMemo(() => (registry.data ?? []).filter(isFormField), [registry.data]);
  const fieldsById = useMemo(() => new Map(formFields.map((f) => [f.id, f])), [formFields]);
  const fieldsByKey = useMemo(() => new Map(formFields.map((f) => [f.key, f])), [formFields]);
  const applicable = (f: (typeof formFields)[number]) =>
    isFieldApplicable(f, dependencies.data ?? [], fieldsById, values.attributes);
  const attributeKeys = formFields.filter((f) => !f.isReadOnly && applicable(f)).map((f) => f.key);
  const stages = useMemo(
    () => stageChoices(statusOptions.data, values.lifecycleStage),
    [statusOptions.data, values.lifecycleStage],
  );
  // Only the statuses that fit the chosen stage are offered (all of them in a workspace that never scoped a status).
  const statuses = useMemo(
    () =>
      statusChoices(
        statusOptions.data,
        (v) => t(`statuses.${v}`),
        values.status,
        values.lifecycleStage,
      ),
    [statusOptions.data, values.status, values.lifecycleStage, t],
  );

  const statusLabel = (v: string) =>
    statusChoices(statusOptions.data, (x) => t(`statuses.${x}`)).find((c) => c.value === v)
      ?.label ?? v;

  // Moving to a lost stage needs a reason. A stored reason that is no longer one of the options reads as "not chosen".
  const lostChoices = useLostReasonChoices();
  const isLost = isLostStage(stages, values.lifecycleStage);
  const lostAnswer: LostReasonAnswer = {
    pick:
      values.lostReason === OTHER_REASON || lostChoices.some((c) => c.value === values.lostReason)
        ? values.lostReason
        : '',
    text: values.lostText,
  };
  const lostPayload = isLost
    ? lostReasonPayload(lostAnswer, lostChoices.length > 0, editing)
    : undefined;

  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // --- tags: immediate when editing (as Reference), a pending list until the contact exists when adding ---
  const tagMutation = useMutation({
    mutationFn: async (op: { kind: 'attach' | 'detach'; tag: TagLite }) => {
      if (!contact) return;
      if (op.kind === 'detach') {
        if (op.tag.id) await detachTag(contact.id, op.tag.id);
        return;
      }
      await attachTagToContact(contact.id, op.tag);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.contactTags(contact?.id ?? '') }),
        qc.invalidateQueries({ queryKey: KEYS.tags }),
        invalidateContacts(qc),
      ]);
    },
    onError: () => toast(tt('failed'), 'danger'),
  });

  const attachedTags: TagLite[] = editing
    ? (contactTags.data ?? []).map((x) => ({ id: x.id, name: x.name, color: x.color }))
    : pendingTags;
  const knownTags: TagLite[] = (allTags.data ?? []).map((x) => ({
    id: x.id,
    name: x.name,
    color: x.color,
  }));

  function attachTag(tag: TagLite) {
    if (editing) tagMutation.mutate({ kind: 'attach', tag });
    else setPendingTags((p) => [...p, tag]);
  }
  function detachTagFromForm(tag: TagLite) {
    if (editing) tagMutation.mutate({ kind: 'detach', tag });
    else setPendingTags((p) => p.filter((x) => x.name !== tag.name));
  }

  // --- save ---
  const knownGroupIds = new Set((groups.data ?? []).map((g) => g.id));

  const save = useMutation({
    mutationFn: async (): Promise<{
      saved: ContactRow;
      duplicate: boolean;
      warnings: string[];
    }> => {
      const warnings: string[] = [];
      let saved: ContactRow;
      let duplicate = false;
      if (contact) {
        saved = await updateContact(
          contact.id,
          toUpdatePayload(
            values,
            attributeKeys,
            version,
            contact.isUnsubscribed,
            contact.customFields,
            fieldsByKey,
            lostPayload,
            contact.leadScore,
            contact.ownerId,
            contact.companyId,
            contact.timezone,
          ),
        );
        const before = initialGroups.current;
        const same =
          before.length === values.groupIds.length &&
          values.groupIds.every((g) => before.includes(g));
        if (!same) {
          try {
            await setContactGroups(saved.id, values.groupIds);
          } catch {
            warnings.push('groups');
          }
        }
      } else {
        const started = Date.now();
        saved = await createContact(
          toCreatePayload(values, attributeKeys, fieldsByKey, lostPayload),
        );
        // Creating a contact whose phone or email already belongs to someone returns that person instead of a copy.
        duplicate = Date.parse(saved.createdAt) < started - 2000;
        if (!duplicate) {
          for (const tg of pendingTags) {
            try {
              await attachTagToContact(saved.id, tg);
            } catch {
              if (!warnings.includes('tags')) warnings.push('tags');
            }
          }
          if (values.groupIds.length > 0) {
            try {
              await setContactGroups(saved.id, values.groupIds);
            } catch {
              warnings.push('groups');
            }
          }
        }
      }
      // The write contract may not carry the consent flag yet: say so instead of pretending it was saved.
      if (!duplicate && saved.isUnsubscribed !== values.optedOut) warnings.push('optOut');
      return { saved, duplicate, warnings };
    },
    onSuccess: async ({ saved, duplicate, warnings }) => {
      await Promise.all([
        invalidateContacts(qc),
        qc.invalidateQueries({ queryKey: KEYS.contact(saved.id) }),
        qc.invalidateQueries({ queryKey: KEYS.contactTags(saved.id) }),
        qc.invalidateQueries({ queryKey: KEYS.groups }),
        qc.invalidateQueries({ queryKey: KEYS.tags }),
      ]);
      if (duplicate) toast(t('duplicate'), 'info');
      else toast(editing ? t('updated') : t('added'), 'success');
      for (const w of warnings)
        toast(
          t(w === 'tags' ? 'tagsFailed' : w === 'groups' ? 'groupsFailed' : 'optOutNotApplied'),
          'danger',
        );
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      if (errorKind(e) === 'conflict') setConflict(true);
      const named = fieldErrors(e);
      setServerFields(named);
      // The API names each required property it found empty as `customFields.<key>`: mark those fields.
      const props = Object.keys(named).filter((k) => k.startsWith('customFields.'));
      if (props.length > 0) {
        setFieldProblems(
          Object.fromEntries(
            props.map((k) => [k.slice('customFields.'.length), t('fieldProblem.required')]),
          ),
        );
      }
      if (named.lostReason) setLostProblem(lostAnswer.pick === '' ? 'pick' : 'text');
    },
  });

  async function reloadLatest() {
    if (!contact) return;
    const latest = await qc.fetchQuery({
      queryKey: KEYS.contact(contact.id),
      queryFn: () => fetchContact(contact.id),
      staleTime: 0,
    });
    setValues(contactToForm(latest));
    setPhone({ e164: latest.phone, empty: !latest.phone, problem: null });
    setVersion(latest.rowVersion);
    setConflict(false);
    save.reset();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // The phone field owns its number; the form values carry the E.164 it last reported.
    const merged = { ...values, phone: phone.e164 };
    const found = validateForm(merged, phone.problem !== null);
    const next = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, t(`problems.${v}`)]));
    setProblems(next);
    setServerFields({});
    const fp: Record<string, string> = {};
    for (const f of formFields) {
      if (f.isReadOnly || !applicable(f)) continue;
      const found = checkValue(f, merged.attributes[f.key]);
      if (found) fp[f.key] = t(`fieldProblem.${found}`);
    }
    setFieldProblems(fp);
    const lostFound = isLost ? lostReasonProblem(lostAnswer, lostChoices.length > 0) : null;
    setLostProblem(lostFound);
    const scoreBad = isScoreInvalid(merged.leadScore);
    setScoreProblem(scoreBad);
    if (Object.keys(next).length > 0) {
      const first = Object.keys(next)[0];
      document.getElementById(id(first === 'firstName' ? 'first' : first))?.focus();
      return;
    }
    if (scoreBad) {
      document.getElementById(id('lead-score'))?.focus();
      return;
    }
    if (lostFound) {
      document.getElementById(id(lostFound === 'pick' ? 'lost-reason' : 'lost-text'))?.focus();
      return;
    }
    const firstField = Object.keys(fp)[0];
    if (firstField) {
      document.getElementById(id(`prop-${firstField}`))?.focus();
      return;
    }
    setValues(merged);
    save.mutate();
  }

  const loadingLookups = registry.isPending;
  const err = (key: 'firstName' | 'phone' | 'email') => problems[key] ?? serverFields[key];
  // The server refuses an owner the person's record scope does not reach (403 with the field `ownerId`): say it at the field.
  const ownerRefused =
    save.isError && errorKind(save.error) === 'forbidden' && !!serverFields.ownerId;
  // The same for a company the person's record scope does not reach (the server names the field `companyId`).
  const companyRefused = save.isError && !!serverFields.companyId;
  const people = owners.data ?? [];
  // Only people the caller may hand a contact to; the contact's current owner stays selectable so saving never silently drops them.
  const ownerChoices = people.filter((p) => p.canAssign || p.id === values.ownerId);
  const ownerKnown =
    !values.ownerId || owners.isPending || people.some((p) => p.id === values.ownerId);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {conflict && (
        <Alert tone="warning">
          {t('conflict')}
          <Button
            variant="secondary"
            size="sm"
            className="ms-2"
            onClick={() => void reloadLatest()}
          >
            {t('reload')}
          </Button>
        </Alert>
      )}
      {save.isError && !conflict && !ownerRefused && !companyRefused && (
        <ErrorLine error={save.error} />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t('title')} htmlFor={id('title')}>
          <Select
            id={id('title')}
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
          >
            <option value="">{t('titleNone')}</option>
            {TITLES.map((x) => (
              <option key={x} value={x}>
                {t(`titles.${x.toLowerCase()}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('firstName')} *`} htmlFor={id('first')} error={err('firstName')}>
          <Input
            id={id('first')}
            value={values.firstName}
            maxLength={255}
            required
            invalid={Boolean(err('firstName'))}
            placeholder={t('firstNamePlaceholder')}
            onChange={(e) => set('firstName', e.target.value)}
            autoFocus
          />
        </Field>
        <Field label={t('middleName')} htmlFor={id('middle')}>
          <Input
            id={id('middle')}
            value={values.middleName}
            maxLength={255}
            placeholder={t('optional')}
            onChange={(e) => set('middleName', e.target.value)}
          />
        </Field>
        <Field label={t('lastName')} htmlFor={id('last')}>
          <Input
            id={id('last')}
            value={values.lastName}
            maxLength={255}
            placeholder={t('lastNamePlaceholder')}
            onChange={(e) => set('lastName', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          className="sm:col-span-2"
          label={`${t('phone')} *`}
          htmlFor={id('phone')}
          error={err('phone')}
          hint={t('phoneHint')}
        >
          <PhoneField
            id={id('phone')}
            initial={contact?.phone}
            invalid={Boolean(err('phone'))}
            onChange={(v) => {
              setPhone(v);
              setValues((x) => ({ ...x, phone: v.e164 }));
            }}
          />
        </Field>
        <Field label={t('email')} htmlFor={id('email')} error={err('email')}>
          <Input
            id={id('email')}
            type="email"
            value={values.email}
            maxLength={191}
            invalid={Boolean(err('email'))}
            placeholder={t('emailPlaceholder')}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <Field label={t('language')} htmlFor={id('language')}>
          <Input
            id={id('language')}
            value={values.language}
            maxLength={80}
            placeholder={t('languagePlaceholder')}
            onChange={(e) => set('language', e.target.value)}
          />
        </Field>
        <Field label={tz('title')} htmlFor={id('timezone')} hint={tz('hint')}>
          <TimezoneSelect
            id={id('timezone')}
            value={values.timezone}
            onChange={(zone) => set('timezone', zone)}
          />
        </Field>
        <Field label={t('dateOfBirth')} htmlFor={id('dob')} hint={t('dateOfBirthHint')}>
          <Input
            id={id('dob')}
            type="date"
            value={values.dateOfBirth}
            min="1900-01-01"
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => set('dateOfBirth', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('memo')} htmlFor={id('memo')}>
          <Textarea
            id={id('memo')}
            rows={3}
            maxLength={2000}
            value={values.memo}
            placeholder={t('memoPlaceholder')}
            onChange={(e) => set('memo', e.target.value)}
          />
        </Field>
        <Field label={t('address')} htmlFor={id('address')}>
          <Textarea
            id={id('address')}
            rows={3}
            maxLength={1000}
            value={values.address}
            placeholder={t('addressPlaceholder')}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LeadScoreField
          id={id('lead-score')}
          value={values.leadScore}
          invalid={scoreProblem}
          onChange={(v) => {
            set('leadScore', v);
            setScoreProblem(false);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('stage')} htmlFor={id('stage')}>
          <Select
            id={id('stage')}
            value={values.lifecycleStage}
            onChange={(e) => {
              const next = e.target.value;
              // The status follows the stage: one that does not fit is replaced by the stage's default, or cleared.
              const move = statusAfterMove(
                statusOptions.data,
                values.status || null,
                effectiveStage(statusOptions.data, next),
              );
              setValues((v) => ({
                ...v,
                lifecycleStage: next,
                ...(move.changed ? { status: move.status ?? '' } : {}),
              }));
              setStatusMove(
                move.changed ? statusNotice(values.status, move.status) : { kind: 'none' },
              );
              setLostProblem(null);
            }}
          >
            {!editing && <option value="">{t('stageDefault')}</option>}
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('status')}
          htmlFor={id('status')}
          hint={
            statusMove.kind === 'reset'
              ? t('statusNoticeReset', { status: statusLabel(statusMove.status) })
              : statusMove.kind === 'set'
                ? t('statusNoticeSet', { status: statusLabel(statusMove.status) })
                : statusMove.kind === 'cleared'
                  ? t('statusNoticeCleared')
                  : statuses.length === 0
                    ? t('statusNoneForStage')
                    : t('statusHelp')
          }
        >
          <Select
            id={id('status')}
            value={values.status}
            onChange={(e) => {
              set('status', e.target.value);
              setStatusMove({ kind: 'none' });
            }}
          >
            <option value="">{t('statusNone')}</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('source')} htmlFor={id('source')}>
          <Input
            id={id('source')}
            value={values.source}
            maxLength={128}
            placeholder={t('sourcePlaceholder')}
            onChange={(e) => set('source', e.target.value)}
          />
        </Field>
        <Field
          label={t('owner')}
          htmlFor={id('owner')}
          hint={t('ownerHelp')}
          error={ownerRefused ? t('ownerOutOfScope') : undefined}
        >
          <Select
            id={id('owner')}
            value={values.ownerId}
            invalid={ownerRefused}
            disabled={owners.isLoading}
            onChange={(e) => {
              set('ownerId', e.target.value);
              setServerFields(({ ownerId: _gone, ...rest }) => rest);
            }}
          >
            <option value="">{t('ownerNone')}</option>
            {!ownerKnown && <option value={values.ownerId}>{t('ownerFormer')}</option>}
            {ownerChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === session.user.id ? t('ownerMe', { name: p.fullName }) : p.fullName}
              </option>
            ))}
          </Select>
        </Field>
        {canPickCompany && (
          <Field
            label={t('company')}
            htmlFor={id('company')}
            hint={t('companyHint')}
            error={companyRefused ? t('companyRefused') : undefined}
            className="sm:col-span-2"
          >
            <CompanyPicker
              id={id('company')}
              value={values.companyId ? { id: values.companyId } : null}
              invalid={companyRefused}
              onChange={(c) => {
                set('companyId', c?.id ?? '');
                setServerFields(({ companyId: _gone, ...rest }) => rest);
              }}
            />
          </Field>
        )}
      </div>

      {isLost && (
        <fieldset className="space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3">
          <legend className="px-1 text-sm font-medium">
            {tl('title', { name: tl('contactFallback') })}
          </legend>
          <LostReasonFields
            choices={lostChoices}
            value={lostAnswer}
            onChange={(a) => {
              set('lostReason', a.pick);
              set('lostText', a.text);
              setLostProblem(null);
            }}
            problem={lostProblem}
            idPrefix={id('lost')}
          />
        </fieldset>
      )}

      <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
        <div className="min-w-0 text-sm">
          <label htmlFor={id('optout')} className="block font-medium">
            {t('optOut')}
          </label>
          <p className="text-xs text-muted-foreground">{t('optOutHint')}</p>
        </div>
        <Switch
          id={id('optout')}
          checked={values.optedOut}
          onCheckedChange={(v) => set('optedOut', v)}
          label={t('optOut')}
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t('groups')}</legend>
        <div className="flex min-h-[2.5rem] flex-wrap gap-1.5 rounded-md border border-border p-2">
          {groups.isPending ? (
            <Spinner label={t('loadingGroups')} />
          ) : groups.isError ? (
            <span className="px-1 text-sm text-muted-foreground">
              {errorKind(groups.error) === 'unavailable'
                ? t('groupsUnavailable')
                : t('groupsLoadFailed')}
            </span>
          ) : (groups.data ?? []).length === 0 ? (
            <span className="px-1 text-sm text-muted-foreground">
              {editing ? t('noGroups') : t('noGroupsCreate')}
            </span>
          ) : (
            (groups.data ?? []).map((g) => {
              const checked = values.groupIds.includes(g.id);
              return (
                <label
                  key={g.id}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                >
                  <input
                    type="checkbox"
                    className="size-3 accent-[var(--primary)]"
                    checked={checked}
                    onChange={() =>
                      set(
                        'groupIds',
                        checked
                          ? values.groupIds.filter((x) => x !== g.id)
                          : [...values.groupIds, g.id],
                      )
                    }
                  />
                  <GroupChip name={g.name} color={g.color} />
                </label>
              );
            })
          )}
        </div>
        {groups.isSuccess && values.groupIds.some((g) => !knownGroupIds.has(g)) && (
          <p className="text-xs text-muted-foreground">{t('groupsGone')}</p>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{tt('title')}</span>
          <span className="text-xs text-muted-foreground">
            {editing ? tt('hintEdit') : tt('hintAdd')}
          </span>
        </div>
        <TagsEditor
          attached={attachedTags}
          all={knownTags}
          loading={editing ? contactTags.isPending || allTags.isPending : allTags.isPending}
          busy={tagMutation.isPending}
          canCreate={canCreateTags}
          onAttach={attachTag}
          onDetach={detachTagFromForm}
        />
      </div>

      <CustomFieldsSection
        fields={formFields}
        sections={sections.data ?? []}
        dependencies={dependencies.data ?? []}
        values={values.attributes}
        errors={fieldProblems}
        idPrefix={uid}
        onChange={(key, value) => {
          set('attributes', { ...values.attributes, [key]: value });
          if (fieldProblems[key]) setFieldProblems(({ [key]: _gone, ...rest }) => rest);
        }}
      />

      <div className="sticky bottom-0 z-10 -mx-5 -mb-4 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending || loadingLookups || conflict}>
          {save.isPending && <Spinner />}
          {editing ? t('saveChanges') : t('saveContact')}
        </Button>
      </div>
    </form>
  );
}
