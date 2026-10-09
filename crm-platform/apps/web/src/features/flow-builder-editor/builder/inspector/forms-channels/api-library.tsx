'use client';

import type { ApiLibraryOption } from '@crm/contracts';
import { useApiLibraryOptions } from '@/features/api-library';
import { Field, Notice, SelectInput, TextInput } from '../kit';
import type { FormComponent, FormProps } from '../types';
import { withSavedOption } from './helpers';
import { Mono } from './shared';

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
        l: options.isPending
          ? 'Loading APIs…'
          : list.length
            ? '— pick an API —'
            : 'No saved APIs yet',
      },
      ...list.map((a) => ({ v: a.id, l: `${a.name} (${a.method})` })),
    ],
    apiId,
    () =>
      options.isPending
        ? String(d.apiName || 'Loading…')
        : `${String(d.apiName || 'Saved API')} (not found)`,
  );

  return (
    <>
      <Notice>
        Runs an API you saved in the <b>API Library</b> for the contact of this run. It leaves by{' '}
        <Mono>success</Mono> when the API answers 2xx, and by <Mono>error</Mono> for anything else.
      </Notice>
      <Field
        label="API"
        hint={
          <>
            {options.isError ? 'Your saved APIs could not be loaded. ' : null}
            <a
              href="/api-library"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
            >
              Manage APIs
            </a>
            {' · '}
            <button
              type="button"
              onClick={() => void options.refetch()}
              className="text-brand underline"
            >
              Refresh list
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
        <Field
          label="Variables"
          hint="Leave a value empty to use the run's variable of that name, then the contact's property, then the default. Values can use {{variables}}."
        >
          {selected.variables.map((v) => (
            <div key={v.name} className="mb-2">
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">{v.name}</div>
              <TextInput
                value={inputs.find((i) => i.name === v.name)?.value ?? ''}
                placeholder={`Default: ${v.defaultValue}`}
                onChange={(value) =>
                  set('inputs', inputsAfterEdit(selected, inputs, v.name, value))
                }
              />
            </div>
          ))}
        </Field>
      )}

      <Field
        label="Save response to"
        hint={
          <>
            Later nodes read the answer as <Mono>{`{{${save}}}`}</Mono>, a field as{' '}
            <Mono>{`{{${save}.FIELD}}`}</Mono> and the status as <Mono>{`{{${save}.status}}`}</Mono>
            .
            {selected && selected.responseVariables.length > 0 && (
              <>
                {' '}
                This API also exposes{' '}
                {selected.responseVariables.map((r, i) => (
                  <span key={r}>
                    {i > 0 ? ', ' : ''}
                    <Mono>{`{{${selected.name}.${r}}}`}</Mono>
                  </span>
                ))}
                .
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
