'use client';

import type { ApiLibraryOption } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useApiLibraryOptions } from '@/features/api-library';
import { Field, Notice, SelectInput, TextInput } from '../kit';
import type { FormComponent, FormProps } from '../types';
import { withSavedOption } from './helpers';
import { Mono } from './shared';

const NS = 'flb.builder.formsChannels.apiLibrary';

export interface NodeInput {
  name: string;
  value: string;
}

/** The overrides the author typed, as the node stores them: only the non-blank ones, in the API's variable order. */
export function inputsAfterEdit(
  api: Pick<ApiLibraryOption, 'variables'> | undefined,
  current: NodeInput[],
  name: string,
  value: string,
): NodeInput[] {
  const next = new Map(current.map((i) => [i.name, i.value]));
  next.set(name, value);
  const order = api ? api.variables.map((v) => v.name) : [...next.keys()];
  return order
    .filter((n) => (next.get(n) ?? '').trim() !== '')
    .map((n) => ({ name: n, value: next.get(n)! }));
}

export const readInputs = (v: unknown): NodeInput[] =>
  Array.isArray(v)
    ? v
        .filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object')
        .map((i) => ({ name: String(i.name ?? ''), value: String(i.value ?? '') }))
        .filter((i) => i.name !== '')
    : [];

/**
 * "API (from library)": pick one of the workspace's saved APIs, optionally override its variables for this step, and name the flow
 * variable the answer is saved under. Leaves by `success` on a 2xx answer, by `error` otherwise (docs/api/api-library.md, section 6).
 */
function Body(p: FormProps) {
  const t = useTranslations(NS);
  const { data: d, set, setMany } = p;
  const options = useApiLibraryOptions();
  const list = options.data?.data ?? [];
  const apiId = String(d.apiId ?? '');
  const selected = list.find((a) => a.id === apiId);
  const inputs = readInputs(d.inputs);
  const save = String(d.save ?? '') || 'api_response';

  const choices = withSavedOption(
    [
      {
        v: '',
        l: options.isPending ? t('loading') : list.length ? t('pickApi') : t('noApis'),
      },
      ...list.map((a) => ({ v: a.id, l: `${a.name} (${a.method})` })),
    ],
    apiId,
    () =>
      options.isPending
        ? String(d.apiName || t('loadingName'))
        : t('notFound', { name: String(d.apiName || t('savedApiName')) }),
  );

  return (
    <>
      <Notice>
        {t.rich('introNotice', {
          b: (chunks) => <b>{chunks}</b>,
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Notice>
      <Field
        label={t('apiLabel')}
        hint={
          <>
            {options.isError ? `${t('loadFailed')} ` : null}
            <a
              href="/api-library"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
            >
              {t('manageApis')}
            </a>
            {' · '}
            <button
              type="button"
              onClick={() => void options.refetch()}
              className="text-brand underline"
            >
              {t('refreshList')}
            </button>
          </>
        }
      >
        <SelectInput
          value={apiId}
          options={choices}
          onChange={(v) => {
            const api = list.find((a) => a.id === v);
            // A new API has its own variables: the old overrides do not apply to it.
            setMany({ apiId: v, apiName: api?.name ?? '', inputs: [] });
          }}
        />
      </Field>

      {selected && selected.variables.length > 0 && (
        <Field label={t('variablesLabel')} hint={t('variablesHint', { example: '{{variables}}' })}>
          {selected.variables.map((v) => (
            <div key={v.name} className="mb-2">
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">{v.name}</div>
              <TextInput
                value={inputs.find((i) => i.name === v.name)?.value ?? ''}
                placeholder={t('defaultPlaceholder', { value: v.defaultValue })}
                onChange={(value) =>
                  set('inputs', inputsAfterEdit(selected, inputs, v.name, value))
                }
              />
            </div>
          ))}
        </Field>
      )}

      <Field
        label={t('saveLabel')}
        hint={
          <>
            {t.rich('saveHint', {
              mono: (chunks) => <Mono>{chunks}</Mono>,
              variable: `{{${save}}}`,
              field: `{{${save}.FIELD}}`,
              status: `{{${save}.status}}`,
            })}
            {selected && selected.responseVariables.length > 0 && (
              <>
                {' '}
                {t.rich('exposes', {
                  mono: (chunks) => <Mono>{chunks}</Mono>,
                  list: selected.responseVariables
                    .map((r) => `{{${selected.name}.${r}}}`)
                    .join(', '),
                })}
              </>
            )}
          </>
        }
      >
        <TextInput value={d.save} placeholder="api_response" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

export const ApiLibraryForm: FormComponent = (p) => <Body {...p} />;
