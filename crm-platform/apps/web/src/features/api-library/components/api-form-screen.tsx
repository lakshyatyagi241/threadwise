'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  API_LIBRARY_METHODS,
  API_LIBRARY_NAME_MAX,
  API_LIBRARY_NAME_RE,
  apiLibraryMethodHasBody,
  type ApiLibraryDetail,
  type ApiLibraryMethod,
  type TestApiLibraryApiResponse,
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
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  KEYS,
  refreshApis,
  useApiDetail,
  useApiLibraryOptions,
  useContactProperties,
} from '../api/hooks';
import { apiLibraryApi } from '../api/service';
import { errorKey, serverFieldProblems } from '../lib/errors';
import {
  buildCreate,
  buildTest,
  buildUpdate,
  emptyForm,
  fromDetail,
  fromImport,
  fullSignature,
  jsonStatus,
  keptSecretsAtRisk,
  newRowId,
  noErrors,
  requestSignature,
  syncVariables,
  type ApiFormState,
  type Built,
  type FormErrors,
} from '../lib/form-model';
import { peekImport } from '../lib/import-handoff';
import type { PathUse } from '../lib/paths';
import { FunctionEditor } from './function-editor';
import { MappingEditor, ResponseVariablesEditor } from './mapping-editor';
import { ApiIcon, PlayIcon } from './icons';
import { CARD, LinkButton, PageHeader, SectionCard } from './page-chrome';
import { LoadError } from './parts';
import { FieldRowsEditor, HeadersEditor, SecretAddressWarning } from './rows-editors';
import { TestPanel } from './test-panel';
import { useLeaveGuard } from './use-leave-guard';
import { VariableField, VariableSourcesContext } from './variable-field';
import { VariablesPanel } from './variables-panel';

/** `/api-library/new` and `/api-library/[id]`: the create / edit form with the test run beside it. */
export function ApiFormScreen({ id }: { id?: string }) {
  const t = useTranslations('api-library.form');
  const te = useTranslations('api-library.errors');
  const canRead = useCan('integ.apilibrary.read');
  const canCreate = useCan('integ.apilibrary.create');
  const detail = useApiDetail(id ?? null);
  const params = useSearchParams();
  const wantsImport = params.get('from') === 'curl';
  // The cURL import is handed over through session storage, which only exists in the browser; the server snapshot is null.
  const imported = useSyncExternalStore(
    noopSubscribe,
    () => (wantsImport ? peekImport() : null),
    () => null,
  );

  if (!canRead || (id === undefined && !canCreate)) {
    return (
      <section className="max-w-none">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }
  if (id !== undefined) {
    if (detail.isPending)
      return (
        <div className="flex justify-center p-16">
          <Spinner />
        </div>
      );
    if (detail.isError)
      return (
        <section className="max-w-none space-y-4">
          <LoadError message={te(errorKey(detail.error))} onRetry={() => void detail.refetch()} />
          <Link href="/api-library" className="text-sm text-primary underline">
            {t('backToList')}
          </Link>
        </section>
      );
    return (
      <ApiForm
        key={`${detail.data.id}:${detail.data.rowVersion}`}
        saved={detail.data}
        initial={fromDetail(detail.data)}
      />
    );
  }
  return imported ? (
    <ApiForm key="import" initial={fromImport(imported)} />
  ) : (
    <ApiForm key="new" initial={emptyForm()} />
  );
}

const noopSubscribe = () => () => undefined;

function ApiForm({ saved, initial }: { saved?: ApiLibraryDetail; initial: ApiFormState }) {
  const t = useTranslations('api-library.form');
  const tt = useTranslations('api-library.test');
  const te = useTranslations('api-library.errors');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const editing = saved !== undefined;
  const canWrite = useCan(editing ? 'integ.apilibrary.update' : 'integ.apilibrary.create');
  const canTest = useCan('integ.apilibrary.test');

  const [form, setFormRaw] = useState<ApiFormState>(() => syncVariables(initial));
  const [baseline] = useState(() => fullSignature(editing ? initial : emptyForm()));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrors>(noErrors());
  const [result, setResult] = useState<TestApiLibraryApiResponse | null>(null);
  const [testedSig, setTestedSig] = useState<string | null>(null);
  const [ranCode, setRanCode] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const options = useApiLibraryOptions(true);
  const props = useContactProperties(true);
  const sources = useMemo(
    () => ({
      contacts: props.data?.data ?? [],
      apis: options.data?.data ?? [],
      selfName: form.name,
    }),
    [props.data, options.data, form.name],
  );

  /** Every edit goes through here so the declared variables always match the `{{tokens}}` in use. */
  const update = (patch: Partial<ApiFormState>) => {
    setFormRaw((f) => syncVariables({ ...f, ...patch }));
    setServerErrors(noErrors());
    setConflict(false);
  };

  const dirty = fullSignature(form) !== baseline;
  const disabled = !canWrite;
  const hasBody = apiLibraryMethodHasBody(form.method);
  const isJson = form.payloadType === 'application/json';
  const usesFunction = hasBody && isJson && form.useFunction;

  const built: Built<unknown> = editing ? buildUpdate(form, saved.rowVersion) : buildCreate(form);
  const local = showErrors && !built.ok ? built.errors : noErrors();
  const errors: FormErrors = {
    fields: { ...local.fields, ...serverErrors.fields },
    general: [...local.general, ...serverErrors.general],
  };

  const sig = requestSignature(form);
  const tested = testedSig === sig;
  const codeRan = ranCode === form.functionCode;
  const addressAtRisk = editing && keptSecretsAtRisk(saved.url, form);
  const body = jsonStatus(form.bodyText);

  const save = useMutation({
    mutationFn: async () => {
      if (!built.ok) throw new Error('invalid');
      return editing
        ? apiLibraryApi.update(saved.id, built.input as Parameters<typeof apiLibraryApi.update>[1])
        : apiLibraryApi.create(built.input as Parameters<typeof apiLibraryApi.create>[0]);
    },
    onSuccess: async () => {
      toast(editing ? t('updated') : t('created'), 'success');
      await refreshApis(qc);
      router.push('/api-library');
    },
    onError: (e) => {
      const key = errorKey(e);
      if (key === 'conflict') {
        setConflict(true);
        return;
      }
      if (key === 'nameTaken') setServerErrors({ fields: { name: te('nameTaken') }, general: [] });
      else if (key === 'validation') {
        const fields = serverFieldProblems(e);
        setServerErrors({
          fields: {},
          general:
            fields.length > 0 ? fields.map((f) => `${f.path}: ${f.message}`) : [te('validation')],
        });
      } else toast(te(key), 'danger');
      setShowErrors(true);
    },
  });

  const run = useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof apiLibraryApi.test>[0]; sig: string }) =>
      apiLibraryApi.test(input),
    onSuccess: (r, v) => {
      setResult(r);
      setTestFailure(null);
      if (r.ok) {
        setTestedSig(v.sig);
        toast(tt('passedToast'), 'success');
      } else setTestedSig(null);
    },
    onError: (e) => {
      setTestedSig(null);
      setTestFailure(te(errorKey(e)));
    },
  });

  const guard = useLeaveGuard(dirty && !save.isSuccess);

  function runTest() {
    setBlocked(null);
    const b = buildTest(form, saved?.id);
    if (!b.ok) {
      setShowErrors(true);
      setTestFailure(t('fixErrors'));
      return;
    }
    if (usesFunction && !codeRan) {
      setBlocked(tt('runCodeFirst'));
      return;
    }
    setTestFailure(null);
    run.mutate({ input: b.input, sig });
  }

  function submit() {
    setShowErrors(true);
    if (!built.ok) {
      toast(t('fixErrors'), 'danger');
      return;
    }
    // The old console's rule: an API is saved only after a test run passed. Someone who may not run tests is not stopped by it.
    if (canTest && !tested) {
      toast(t('testFirst'), 'danger');
      return;
    }
    save.mutate();
  }

  const onAdd = (path: string, use: PathUse) =>
    update({
      responseVariables:
        use !== 'contact' && !form.responseVariables.includes(path)
          ? [...form.responseVariables, path]
          : form.responseVariables,
      mapping:
        use !== 'flow' && !form.mapping.some((m) => m.path === path)
          ? [...form.mapping, { id: newRowId(), path, contactProperty: '', defaultValue: '' }]
          : form.mapping,
    });
  const onRemove = (path: string) =>
    update({
      responseVariables: form.responseVariables.filter((p) => p !== path),
      mapping: form.mapping.filter((m) => m.path !== path),
    });

  const lastJson = result?.response?.bodyJson ?? null;
  const generalErrors = [...new Set(errors.general)];

  return (
    <VariableSourcesContext.Provider value={sources}>
      <div className="max-w-none space-y-4">
        <PageHeader
          icon={<ApiIcon className="size-5" />}
          title={editing ? t('editTitle', { name: saved.name }) : t('newTitle')}
          back={{ href: '/api-library', label: t('backToList') }}
          status={
            <span className="flex flex-wrap items-center gap-2" role="status">
              {dirty && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                  {t('unsaved')}
                </span>
              )}
              {tested && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                  {t('tested')}
                </span>
              )}
            </span>
          }
          actions={
            <>
              <LinkButton href="/api-library">{t('cancel')}</LinkButton>
              <Button
                variant="secondary"
                className="h-10"
                onClick={runTest}
                disabled={!canTest || run.isPending}
              >
                {run.isPending ? <Spinner /> : <PlayIcon />}
                {tt('run')}
              </Button>
              {canWrite && (
                <Button
                  variant="brand"
                  className="h-10 px-5"
                  onClick={submit}
                  disabled={save.isPending}
                  title={canTest && !tested ? t('testHint') : undefined}
                >
                  {save.isPending && <Spinner />}
                  {editing ? t('update') : t('save')}
                </Button>
              )}
            </>
          }
        />

        {!canWrite && <Alert>{t('readOnly')}</Alert>}
        {conflict && (
          <Alert tone="danger">
            <p className="font-medium">{te('conflictTitle')}</p>
            <p className="mt-1">{te('conflict')}</p>
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onClick={() => {
                // The form is keyed by the loaded version: once the fresh copy arrives it replaces the stale form.
                void qc.invalidateQueries({ queryKey: KEYS.detail(saved?.id ?? '') });
              }}
            >
              {te('reload')}
            </Button>
          </Alert>
        )}
        {generalErrors.length > 0 && (
          <Alert tone="danger">
            <ul className="list-disc ps-5">
              {generalErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <form
            className="min-w-0 space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <SectionCard id="alib-s-request" title={t('sections.request')} hint={t('requestHint')}>
              <Field
                label={t('name')}
                htmlFor="alib-name"
                hint={editing ? t('nameLocked') : t('nameHint')}
                error={errors.fields.name}
              >
                <Input
                  id="alib-name"
                  value={form.name}
                  maxLength={API_LIBRARY_NAME_MAX}
                  disabled={disabled || editing}
                  invalid={errors.fields.name !== undefined}
                  placeholder={t('namePlaceholder')}
                  autoComplete="off"
                  onChange={(e) => {
                    // Letters, digits and underscores only; anything else is simply not typed (the old console's rule).
                    if (e.target.value === '' || API_LIBRARY_NAME_RE.test(e.target.value))
                      update({ name: e.target.value });
                  }}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <Field label={t('method')} htmlFor="alib-method">
                  <Select
                    id="alib-method"
                    value={form.method}
                    disabled={disabled}
                    className="font-mono font-semibold"
                    onChange={(e) => update({ method: e.target.value as ApiLibraryMethod })}
                  >
                    {API_LIBRARY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('url')}
                  htmlFor="alib-url"
                  hint={t('urlHint')}
                  error={errors.fields.url}
                >
                  <VariableField
                    id="alib-url"
                    label={t('url')}
                    value={form.url}
                    placeholder="https://api.example.com/orders/{{order_id}}"
                    invalid={errors.fields.url !== undefined}
                    disabled={disabled}
                    onChange={(v) => update({ url: v })}
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              id="alib-s-variables"
              title={t('sections.variables')}
              hint={t('variablesHint')}
            >
              <VariablesPanel
                variables={form.variables}
                errors={errors}
                disabled={disabled}
                onChange={(v) => update({ variables: v })}
              />
            </SectionCard>

            <SectionCard id="alib-s-headers" title={t('sections.headers')} hint={t('headersHint')}>
              {addressAtRisk && <SecretAddressWarning />}
              <HeadersEditor
                rows={form.headers}
                errors={errors}
                disabled={disabled}
                onChange={(rows) => update({ headers: rows })}
              />
            </SectionCard>

            {hasBody && (
              <SectionCard
                id="alib-s-payload"
                title={t('sections.payload')}
                hint={t('payloadHint')}
              >
                <Field
                  label={t('payloadType')}
                  htmlFor="alib-ptype"
                  error={errors.fields.payloadType}
                  className="max-w-xs"
                >
                  <Select
                    id="alib-ptype"
                    value={form.payloadType}
                    disabled={disabled}
                    onChange={(e) =>
                      update({ payloadType: e.target.value as ApiFormState['payloadType'] })
                    }
                  >
                    <option value="application/json">{t('payloadJson')}</option>
                    <option value="multipart/form-data">{t('payloadForm')}</option>
                  </Select>
                </Field>
                {isJson ? (
                  <Field
                    label={t('payload')}
                    htmlFor="alib-body"
                    error={errors.fields.body}
                    hint={
                      body === 'valid'
                        ? t('json.valid')
                        : body === 'empty'
                          ? t('json.empty')
                          : undefined
                    }
                  >
                    <VariableField
                      id="alib-body"
                      label={t('payload')}
                      value={form.bodyText}
                      multiline
                      rows={10}
                      mono
                      placeholder={'{\n  "name": "{{name}}"\n}'}
                      invalid={
                        errors.fields.body !== undefined || body === 'invalid' || body === 'shape'
                      }
                      disabled={disabled}
                      onChange={(v) => update({ bodyText: v })}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                      {body === 'invalid' && (
                        <span role="alert" className="text-danger">
                          {t('json.invalid')}
                        </span>
                      )}
                      {body === 'shape' && (
                        <span role="alert" className="text-danger">
                          {t('json.shape')}
                        </span>
                      )}
                      {body === 'valid' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() =>
                            update({ bodyText: JSON.stringify(JSON.parse(form.bodyText), null, 2) })
                          }
                        >
                          {t('json.format')}
                        </Button>
                      )}
                    </div>
                  </Field>
                ) : (
                  <>
                    <FieldRowsEditor
                      rows={form.fieldRows}
                      disabled={disabled}
                      onChange={(rows) => update({ fieldRows: rows })}
                    />
                    {errors.fields.body && (
                      <p role="alert" className="text-xs text-danger">
                        {errors.fields.body}
                      </p>
                    )}
                  </>
                )}
              </SectionCard>
            )}

            {hasBody && isJson && (
              <SectionCard
                id="alib-s-function"
                title={t('sections.function')}
                hint={t('functionHint')}
                aside={
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <Switch
                      label={t('function.enable')}
                      checked={form.useFunction}
                      disabled={disabled}
                      onCheckedChange={(on) => update({ useFunction: on })}
                    />
                    {t('function.enable')}
                  </label>
                }
              >
                {form.useFunction ? (
                  <FunctionEditor
                    code={form.functionCode}
                    onChange={(c) => update({ functionCode: c })}
                    bodyText={form.bodyText}
                    variables={form.variables}
                    canRun={canTest}
                    ranOk={codeRan}
                    onRan={(ok, code) => setRanCode(ok ? code : null)}
                    disabled={disabled}
                    error={errors.fields.functionCode}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t('function.off')}</p>
                )}
              </SectionCard>
            )}

            <SectionCard id="alib-s-mapping" title={t('sections.mapping')} hint={t('mappingHint')}>
              <MappingEditor
                rows={form.mapping}
                properties={props.data?.data ?? []}
                propertiesState={props.isPending ? 'loading' : props.isError ? 'error' : 'ready'}
                lastJson={lastJson}
                errors={errors}
                disabled={disabled}
                onChange={(rows) => update({ mapping: rows })}
              />
            </SectionCard>

            <SectionCard
              id="alib-s-responsevars"
              title={t('sections.responseVars')}
              hint={t('responseVarsHint')}
            >
              <ResponseVariablesEditor
                paths={form.responseVariables}
                apiName={form.name}
                lastJson={lastJson}
                disabled={disabled}
                onChange={(p) => update({ responseVariables: p })}
              />
            </SectionCard>
          </form>

          <aside
            aria-label={tt('title')}
            className="min-w-0 lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto"
          >
            <div className={cn(CARD, 'p-4')}>
              <TestPanel
                result={result}
                pending={run.isPending}
                canTest={canTest}
                blocked={blocked ?? testFailure}
                onRun={runTest}
                flowPaths={form.responseVariables}
                mappingPaths={form.mapping.map((m) => m.path)}
                onAdd={onAdd}
                onRemove={onRemove}
                disabled={disabled}
              />
            </div>
          </aside>
        </div>

        <ConfirmDialog
          open={guard.target !== null}
          tone="danger"
          title={t('leave.title')}
          message={t('leave.message')}
          confirmLabel={t('leave.confirm')}
          cancelLabel={t('leave.stay')}
          onConfirm={guard.leave}
          onClose={guard.stay}
        />
      </div>
    </VariableSourcesContext.Provider>
  );
}
