'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BOOKING_PAGE_BACKGROUNDS,
  BOOKING_PAGE_CORNERS,
  BOOKING_PAGE_FONTS,
  BOOKING_PAGE_LIMITS,
  BOOKING_PAGE_MODES,
  type BookingPageAssetSlot,
  type BookingPageSettingsResponse,
} from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { pageThemeApi } from '../api/page-theme-service';
import { errorKind } from '../lib/errors';
import {
  draftFromResponse,
  isDirty,
  pictureProblem,
  previewView,
  typeInput,
  validate,
  workspaceInput,
  type Draft,
  type Staged,
} from '../lib/appearance-form';
import { buildPalette, schemeFor, warningsOf } from '../lib/booking-theme';
import { AppearancePreview } from './appearance-preview';
import { ChoiceGroup, ColourField, PictureField } from './appearance-fields';
import { ErrorLine } from './parts';
import { SettingsCard } from './settings-parts';
import { useLeaveGuard } from './use-leave-guard';

/** Literal names of the choice labels (a template string would hide them from the unused-message check). */
const FONT_LABEL = {
  default: 'style.fonts.default',
  system: 'style.fonts.system',
  serif: 'style.fonts.serif',
  rounded: 'style.fonts.rounded',
  humanist: 'style.fonts.humanist',
} as const;
const CORNER_LABEL = {
  square: 'style.cornerStyles.square',
  rounded: 'style.cornerStyles.rounded',
  pill: 'style.cornerStyles.pill',
} as const;

export const THEME_KEYS = {
  workspace: ['appointments', 'page-theme', 'workspace'] as const,
  type: (id: string) => ['appointments', 'page-theme', 'type', id] as const,
};

type Problems = ReturnType<typeof validate>;

/**
 * The booking page appearance form (BL-355, BL-356, BL-357): the workspace's look, or one service's override of it, next to a live
 * preview of the real page. One component for both, because a service sets a subset of the same things: what it leaves empty falls
 * back to the workspace, and the form says so under each field.
 *
 * Pictures are staged: choosing one shows it in the preview at once, and the files go up together with the fields when Save is
 * pressed (pictures first, so the row version the fields carry is the one the uploads left).
 */
export function AppearanceEditor({
  scope,
  initial,
  orgName,
  typeName,
  canEdit,
}: {
  /** Null: the workspace theme. Otherwise the booking type's uuid. */
  scope: string | null;
  initial: BookingPageSettingsResponse;
  orgName: string;
  typeName: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('appointments.appearance');
  const qc = useQueryClient();
  const { toast } = useToast();
  const base = useId();
  const locale = useLocale();
  const savingRef = useRef(false);

  const [data, setData] = useState(initial);
  const initialDraft = useMemo(() => draftFromResponse(data), [data]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [staged, setStaged] = useState<Staged>({});
  const [pictureErrors, setPictureErrors] = useState<Partial<Record<BookingPageAssetSlot, string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const workspace = data.scope === 'workspace';
  const readOnly = !canEdit;
  const dirty = isDirty(initialDraft, draft, staged);
  const guard = useLeaveGuard(dirty && !readOnly);
  const problems: Problems = useMemo(() => validate(draft), [draft]);
  const problemCount = Object.keys(problems).length;

  // The browser addresses of the files just chosen, for the preview; each is released when it is replaced or the form closes.
  const [blobs, setBlobs] = useState<{ logo?: string; cover?: string }>({});
  useEffect(() => {
    const made: { logo?: string; cover?: string } = {};
    if (staged.logo) made.logo = URL.createObjectURL(staged.logo);
    if (staged.cover) made.cover = URL.createObjectURL(staged.cover);
    // The addresses only exist after mount (and are released in the cleanup), so they cannot be derived while rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlobs(made);
    return () => {
      if (made.logo) URL.revokeObjectURL(made.logo);
      if (made.cover) URL.revokeObjectURL(made.cover);
    };
  }, [staged.logo, staged.cover]);

  const view = useMemo(() => previewView(data, draft, staged, blobs), [data, draft, staged, blobs]);
  const checks = useMemo(() => buildPalette(view, schemeFor(view.colorMode, false)).checks, [view]);
  const findings = warningsOf(checks);
  const darkChecks = useMemo(
    () => (view.colorMode === 'auto' ? warningsOf(buildPalette(view, 'dark').checks) : []),
    [view],
  );

  const patch = useCallback((next: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setConflict(false);
    setError(null);
  }, []);

  function stage(slot: BookingPageAssetSlot, file: File | null) {
    if (file) {
      const problem = pictureProblem(file, slot);
      if (problem) {
        setPictureErrors((e) => ({
          ...e,
          [slot]:
            problem === 'type'
              ? t('fields.pictureType')
              : t('fields.pictureSize', {
                  mb:
                    (slot === 'logo'
                      ? BOOKING_PAGE_LIMITS.logoBytes
                      : BOOKING_PAGE_LIMITS.coverBytes) /
                    1024 /
                    1024,
                }),
        }));
        return;
      }
    }
    setPictureErrors((e) => ({ ...e, [slot]: undefined }));
    setStaged((s) => ({ ...s, [slot]: file }));
  }

  function adopt(next: BookingPageSettingsResponse, keepEdits = false) {
    setData(next);
    if (!keepEdits) {
      setDraft(draftFromResponse(next));
      setStaged({});
    }
    qc.setQueryData(scope === null ? THEME_KEYS.workspace : THEME_KEYS.type(scope), next);
    setError(null);
    setConflict(false);
    setTried(false);
  }

  async function save() {
    if (savingRef.current || readOnly) return;
    setTried(true);
    setError(null);
    if (problemCount > 0) {
      toast(t('fixFirst'), 'danger');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      // Pictures first: each answer carries the row version the next call must send.
      let current = data;
      for (const slot of ['logo', 'cover'] as const) {
        const file = staged[slot];
        if (file === undefined) continue;
        const own = current.theme[slot];
        current = file
          ? await pageThemeApi.putAsset(scope, slot, file)
          : own
            ? await pageThemeApi.removeAsset(scope, slot)
            : current;
      }
      const rowVersion = current.theme.rowVersion;
      const next =
        scope === null
          ? await pageThemeApi.saveWorkspace(workspaceInput(draft, rowVersion))
          : await pageThemeApi.saveType(scope, typeInput(draft, rowVersion));
      adopt(next);
      void qc.invalidateQueries({ queryKey: ['appointments', 'public'] });
      toast(t('saved'));
    } catch (e) {
      // A picture that went up before the failure is saved already; keep the rest of the edits and the version it left.
      if (errorKind(e) === 'conflict') setConflict(true);
      else if (e instanceof ApiError && e.code === 'AUTH_UPLOAD_REJECTED') {
        setError(null);
        toast(t('fields.pictureRejected'), 'danger');
      } else setError(e);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reloadLatest() {
    try {
      adopt(await pageThemeApi.get(scope));
    } catch (e) {
      setError(e);
    }
  }

  async function resetToWorkspace() {
    if (scope === null) return;
    setConfirmReset(false);
    setSaving(true);
    try {
      adopt(await pageThemeApi.reset(scope));
      void qc.invalidateQueries({ queryKey: ['appointments', 'public'] });
      toast(t('type.resetDone'));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const pageUrl = `${origin}/book/${encodeURIComponent(data.workspaceSlug)}${
    data.typeSlug ? `/${encodeURIComponent(data.typeSlug)}` : ''
  }`;
  const inherited = data.inherited;
  const brandHint = (colour: string | null) =>
    colour ? t('fields.inheritedColour', { colour }) : t('fields.productColour');
  const logoSrc = view.logoUrl;
  const coverSrc = view.coverUrl;
  const ownLogo = staged.logo !== undefined ? staged.logo !== null : data.theme.logo !== null;
  const ownCover = staged.cover !== undefined ? staged.cover !== null : data.theme.cover !== null;

  return (
    <div className="space-y-4">
      {readOnly && <Alert tone="info">{t('readOnly')}</Alert>}
      {conflict && (
        <Alert
          tone="danger"
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{t('conflict.message')}</span>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void reloadLatest()}
          >
            {t('conflict.reload')}
          </Button>
        </Alert>
      )}
      {error !== null && !conflict && <ErrorLine error={error} />}
      {tried && problemCount > 0 && !saving && (
        <Alert tone="danger">{t('issues', { count: problemCount })}</Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-4">
          <SettingsCard
            id={`${base}-pictures`}
            title={t('pictures.title')}
            description={t('pictures.description')}
          >
            <PictureField
              label={t('pictures.logo')}
              hint={t('pictures.logoHint', { mb: BOOKING_PAGE_LIMITS.logoBytes / 1024 / 1024 })}
              src={logoSrc}
              inherited={!ownLogo}
              error={pictureErrors.logo}
              disabled={readOnly}
              canRemove={ownLogo}
              shape="logo"
              onPick={(f) => stage('logo', f)}
              onRemove={() => stage('logo', null)}
            />
            <PictureField
              label={t('pictures.cover')}
              hint={t('pictures.coverHint', { mb: BOOKING_PAGE_LIMITS.coverBytes / 1024 / 1024 })}
              src={coverSrc}
              inherited={!ownCover}
              error={pictureErrors.cover}
              disabled={readOnly}
              canRemove={ownCover}
              shape="cover"
              onPick={(f) => stage('cover', f)}
              onRemove={() => stage('cover', null)}
            />
            {workspace && (
              <label className="flex items-start gap-3 text-sm">
                <Switch
                  checked={draft.useWorkspaceBrand}
                  onCheckedChange={(v) => patch({ useWorkspaceBrand: v })}
                  label={t('pictures.useBrand')}
                  disabled={readOnly}
                />
                <span>
                  <span className="block font-medium">{t('pictures.useBrand')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('pictures.useBrandHint')}
                  </span>
                </span>
              </label>
            )}
          </SettingsCard>

          <SettingsCard
            id={`${base}-colours`}
            title={t('colours.title')}
            description={t('colours.description')}
          >
            <ColourField
              label={t('colours.primary')}
              value={draft.primaryColor}
              fallback={inherited.primaryColor}
              hint={workspace ? brandHint(inherited.primaryColor) : t('colours.typeHint')}
              error={problems.primaryColor ? t('colours.invalid') : undefined}
              disabled={readOnly}
              onChange={(v) => patch({ primaryColor: v })}
            />
            <ColourField
              label={t('colours.button')}
              value={draft.accentColor}
              fallback={inherited.accentColor ?? view.primaryColor}
              hint={t('colours.buttonHint')}
              error={problems.accentColor ? t('colours.invalid') : undefined}
              disabled={readOnly}
              onChange={(v) => patch({ accentColor: v })}
            />
            <Field
              label={t('colours.background')}
              htmlFor={`${base}-bg`}
              hint={t('colours.backgroundHint')}
            >
              <Select
                id={`${base}-bg`}
                value={draft.backgroundStyle}
                disabled={readOnly}
                onChange={(e) =>
                  patch({ backgroundStyle: e.target.value as Draft['backgroundStyle'] })
                }
              >
                {!workspace && <option value="">{t('colours.sameAsWorkspace')}</option>}
                {BOOKING_PAGE_BACKGROUNDS.map((b) => (
                  <option key={b} value={b}>
                    {t(`colours.backgrounds.${b}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {workspace && draft.backgroundStyle === 'solid' && (
              <ColourField
                label={t('colours.backgroundColour')}
                value={draft.backgroundColor}
                fallback={inherited.backgroundColor}
                error={problems.backgroundColor ? t('colours.invalid') : undefined}
                disabled={readOnly}
                onChange={(v) => patch({ backgroundColor: v })}
              />
            )}
            {draft.backgroundStyle === 'image' && !coverSrc && (
              <p className="text-xs text-warning">{t('colours.needCover')}</p>
            )}
            <ul className="space-y-1.5" aria-label={t('checks.title')}>
              {view.primaryColor && (
                <li className="text-xs text-muted-foreground">{t('checks.autoText')}</li>
              )}
              {[...findings, ...darkChecks.map((c) => ({ ...c, dark: true }))].map((c, i) => (
                <li key={`${c.pair}-${i}`}>
                  <Alert tone="warning" className="text-xs">
                    {t(`checks.${c.pair}`, { ratio: c.ratio.toFixed(1), min: c.min })}
                    {'dark' in c ? ` ${t('checks.inDark')}` : ''}
                  </Alert>
                </li>
              ))}
            </ul>
          </SettingsCard>

          <SettingsCard
            id={`${base}-wording`}
            title={t('wording.title')}
            description={t('wording.description')}
          >
            {workspace && (
              <Field
                label={t('wording.pageTitle')}
                htmlFor={`${base}-title`}
                hint={t('wording.pageTitleHint')}
                error={
                  problems.pageTitle
                    ? t('wording.tooLong', { max: BOOKING_PAGE_LIMITS.pageTitle })
                    : undefined
                }
              >
                <Input
                  id={`${base}-title`}
                  value={draft.pageTitle}
                  maxLength={BOOKING_PAGE_LIMITS.pageTitle + 20}
                  disabled={readOnly}
                  onChange={(e) => patch({ pageTitle: e.target.value })}
                  dir="auto"
                />
              </Field>
            )}
            <Field
              label={t('wording.welcome')}
              htmlFor={`${base}-welcome`}
              hint={t('wording.welcomeHint', {
                count: [...draft.welcomeText].length,
                max: BOOKING_PAGE_LIMITS.welcomeText,
              })}
              error={
                problems.welcomeText
                  ? t('wording.tooLong', { max: BOOKING_PAGE_LIMITS.welcomeText })
                  : undefined
              }
            >
              <Textarea
                id={`${base}-welcome`}
                rows={4}
                value={draft.welcomeText}
                disabled={readOnly}
                placeholder={workspace ? undefined : (inherited.welcomeText ?? undefined)}
                onChange={(e) => patch({ welcomeText: e.target.value })}
                dir="auto"
              />
            </Field>
            <Field
              label={t('wording.button')}
              htmlFor={`${base}-button`}
              hint={t('wording.buttonHint')}
              error={
                problems.buttonLabel
                  ? t('wording.tooLong', { max: BOOKING_PAGE_LIMITS.buttonLabel })
                  : undefined
              }
            >
              <Input
                id={`${base}-button`}
                value={draft.buttonLabel}
                maxLength={BOOKING_PAGE_LIMITS.buttonLabel + 10}
                disabled={readOnly}
                placeholder={inherited.buttonLabel ?? t('wording.buttonDefault')}
                onChange={(e) => patch({ buttonLabel: e.target.value })}
                dir="auto"
              />
            </Field>
          </SettingsCard>

          {workspace && (
            <SettingsCard
              id={`${base}-style`}
              title={t('style.title')}
              description={t('style.description')}
            >
              <Field label={t('style.font')} htmlFor={`${base}-font`} hint={t('style.fontHint')}>
                <Select
                  id={`${base}-font`}
                  value={draft.font}
                  disabled={readOnly}
                  onChange={(e) => patch({ font: e.target.value as Draft['font'] })}
                >
                  {BOOKING_PAGE_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {t(FONT_LABEL[f])}
                    </option>
                  ))}
                </Select>
              </Field>
              <ChoiceGroup
                label={t('style.corners')}
                value={draft.cornerStyle}
                disabled={readOnly}
                onChange={(v) => patch({ cornerStyle: v })}
                options={BOOKING_PAGE_CORNERS.map((c) => ({
                  id: c,
                  label: t(CORNER_LABEL[c]),
                }))}
              />
              <ChoiceGroup
                label={t('style.mode')}
                value={draft.colorMode}
                disabled={readOnly}
                onChange={(v) => patch({ colorMode: v })}
                options={BOOKING_PAGE_MODES.map((m) => ({ id: m, label: t(`style.modes.${m}`) }))}
              />
            </SettingsCard>
          )}

          {workspace && (
            <SettingsCard
              id={`${base}-options`}
              title={t('options.title')}
              description={t('options.description')}
            >
              <label className="flex items-start gap-3 text-sm">
                <Switch
                  checked={draft.showLanguageSwitch}
                  onCheckedChange={(v) => patch({ showLanguageSwitch: v })}
                  label={t('options.language')}
                  disabled={readOnly}
                />
                <span>
                  <span className="block font-medium">{t('options.language')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('options.languageHint')}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <Switch
                  checked={draft.showPoweredBy || !data.canRemovePoweredBy}
                  onCheckedChange={(v) => patch({ showPoweredBy: v })}
                  label={t('options.poweredBy')}
                  disabled={readOnly || !data.canRemovePoweredBy}
                />
                <span>
                  <span className="block font-medium">{t('options.poweredBy')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {data.canRemovePoweredBy
                      ? t('options.poweredByHint')
                      : t('options.poweredByLocked')}
                  </span>
                </span>
              </label>
            </SettingsCard>
          )}

          <SettingsCard
            id={`${base}-links`}
            title={t('links.title')}
            description={t('links.description')}
          >
            <Field label={t('links.page')} htmlFor={`${base}-url`}>
              <div className="flex gap-2">
                <Input
                  id={`${base}-url`}
                  readOnly
                  dir="ltr"
                  value={pageUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton value={pageUrl} />
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 shrink-0 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('links.open')}
                </a>
              </div>
            </Field>
            <p className="text-xs text-muted-foreground">{t('links.later')}</p>
          </SettingsCard>

          {!workspace && (
            <SettingsCard
              id={`${base}-reset`}
              title={t('type.resetTitle')}
              description={t('type.resetDescription')}
            >
              <Button
                variant="secondary"
                disabled={readOnly || saving || data.theme.rowVersion === null}
                onClick={() => setConfirmReset(true)}
              >
                {t('type.reset')}
              </Button>
            </SettingsCard>
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-4" lang={locale}>
          <AppearancePreview
            view={view}
            orgName={orgName}
            orgSlug={data.workspaceSlug}
            typeName={typeName}
          />
        </div>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/95 px-4 py-3 backdrop-blur">
          <p role="status" className="text-sm text-muted-foreground">
            {saving ? (
              t('saving')
            ) : dirty ? (
              <span className="font-medium text-warning">{t('unsaved')}</span>
            ) : (
              t('allSaved')
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(initialDraft);
                setStaged({});
                setPictureErrors({});
                setTried(false);
              }}
            >
              {t('discard')}
            </Button>
            <Button variant="brand" disabled={!dirty || saving} onClick={() => void save()}>
              {saving && <Spinner />} {t('save')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={guard.target !== null}
        title={t('leave.title')}
        message={t('leave.message')}
        confirmLabel={t('leave.leave')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onConfirm={guard.leave}
        onClose={guard.stay}
      />
      <ConfirmDialog
        open={confirmReset}
        title={t('type.resetConfirmTitle')}
        message={t('type.resetConfirmMessage')}
        confirmLabel={t('type.reset')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onConfirm={() => void resetToWorkspace()}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('appointments.appearance.links');
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 2000);
          },
          () => undefined,
        );
      }}
    >
      {done ? t('copied') : t('copy')}
    </Button>
  );
}
