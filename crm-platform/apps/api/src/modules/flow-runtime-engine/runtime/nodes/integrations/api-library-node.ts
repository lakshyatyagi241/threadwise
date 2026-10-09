import { Injectable } from '@nestjs/common';
import {
  ApiLibraryRunService,
  applyMapping,
  responseVariableValues,
  type FlowApiResult,
} from '../../../../api-library';
import { ContactsService } from '../../../../crm';
import type { NodeContext, NodeExecutor, NodeResult } from '../../types';
import { asText, flattenInto, isSet, resolveVariable } from '../../variables';
import { dataOf, str } from './webhook-node';

const SUCCESS: NodeResult = { kind: 'advance', port: 1, branch: true };
const FAILURE: NodeResult = { kind: 'advance', port: 2, branch: true };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the node needs from outside: the run door of the API Library and the run's contact. Faked in the unit tests. */
export interface ApiLibraryNodeDeps {
  run: ApiLibraryRunService['runForFlow'];
  recordMissing: ApiLibraryRunService['recordMissing'];
  readContactField(orgId: number, contactId: number, key: string): Promise<string | null>;
  writeContactField(
    orgId: number,
    contactId: number,
    key: string,
    value: string,
  ): Promise<{ stored: string } | null>;
}

/**
 * "API (from library)" node: runs a saved API of the workspace for the run's contact.
 *
 * Each variable the API declares gets, in order: the node's own input for it (a value or `{{flow_variable}}`), the run's variable of
 * that name, the contact's property of that name, the default saved with the API. The answer is saved under the node's variable
 * (JSON text, plus every field as `<variable>.<path>`, plus `<variable>.status`), each response variable the API exposes as
 * `<ApiName>.<path>`, and the API's mapping writes response fields into the contact (and into the run's variables, so a later
 * Condition sees them). A 2xx leaves by port 1 (`success`); anything else (the API is gone, a blocked address, a function that
 * throws, a timeout, a non-2xx) by port 2 (`error`), with the reason in the run log and in `<variable>.error`. The run is also written
 * to the API's own log (source `flow`). Unlike the Webhook node this one never stops the flow on its own: both ports are wired by the author.
 */
export async function runApiLibrary(
  ctx: NodeContext,
  deps: ApiLibraryNodeDeps,
): Promise<NodeResult> {
  const d = dataOf(ctx);
  const run = ctx.run;
  const apiId = str(d.apiId).trim();
  const saveAs = str(d.variable, 'api_response') || 'api_response';
  const fail = (reason: string): NodeResult => {
    ctx.note(`api library: ${reason}`);
    run.vars[saveAs] = '';
    run.vars[`${saveAs}.status`] = 0;
    run.vars[`${saveAs}.error`] = reason;
    return FAILURE;
  };
  if (!UUID_RE.test(apiId)) return fail('no API is chosen on this step');

  const overrides: Record<string, string> = {};
  const inputs = Array.isArray(d.inputs) ? (d.inputs as Array<Record<string, unknown>>) : [];
  for (const i of inputs) {
    const name = str(i?.name).trim();
    if (name !== '') overrides[name] = ctx.render(i?.value);
  }
  const lookup = async (name: string): Promise<string | undefined> => {
    const fromRun = resolveVariable(run.vars, name);
    if (isSet(fromRun)) return asText(fromRun);
    if (run.contactId === null) return undefined;
    const prop = await deps.readContactField(run.orgId, run.contactId, name).catch(() => null);
    return prop ?? undefined;
  };
  const context = {
    contactUuid: run.contactUuid,
    flowId: run.flowId,
    flowRunUuid: run.uuid,
    flowNodeId: ctx.node.id,
  };

  let result: FlowApiResult;
  try {
    result = await deps.run({
      orgId: run.orgId,
      apiId,
      overrides,
      lookup,
      context,
      idempotencyKey: ctx.stepKey,
    });
  } catch (e) {
    return fail(`the call could not be run (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!result.found) {
    await deps.recordMissing({ orgId: run.orgId, apiId, context }).catch(() => undefined);
    return fail('the API this step calls no longer exists');
  }

  const { api, outcome } = result;
  run.vars[`${saveAs}.status`] = outcome.status ?? 0;
  if (!outcome.ok) {
    const reason = outcome.error ?? 'the call failed';
    ctx.note(`api library: "${api.name}" failed (${outcome.errorKind}): ${reason}`);
    run.vars[saveAs] = '';
    run.vars[`${saveAs}.error`] = reason;
    return FAILURE;
  }

  const json = outcome.response?.bodyJson ?? null;
  run.vars[saveAs] = json !== null ? JSON.stringify(json) : (outcome.response?.bodyText ?? '');
  if (json !== null && typeof json === 'object') flattenInto(run.vars, saveAs, json);
  run.vars[`${saveAs}.status`] = outcome.status ?? 0;
  Object.assign(run.vars, responseVariableValues(api.name, api.responseVariables, json));

  if (api.mapping.length > 0) {
    if (run.contactId === null)
      ctx.note('api library: this run has no contact, so the mapping was skipped');
    else {
      for (const m of applyMapping(api.mapping, json)) {
        try {
          const done = await deps.writeContactField(
            run.orgId,
            run.contactId,
            m.contactProperty,
            m.value,
          );
          if (!done) {
            ctx.note(
              `api library: contact property "${m.contactProperty}" could not be set (not a property of this workspace)`,
            );
            continue;
          }
          run.vars[m.contactProperty] = done.stored;
        } catch (e) {
          ctx.note(
            `api library: contact property "${m.contactProperty}" failed (${e instanceof Error ? e.message : String(e)})`,
          );
        }
      }
    }
  }
  ctx.note(`api library: "${api.name}" answered ${outcome.status} in ${outcome.durationMs} ms`);
  return SUCCESS;
}

/** The executor group for the `ApiLibrary` node type (`api_library` in the builder). */
@Injectable()
export class ApiLibraryNodes implements NodeExecutor {
  readonly types: readonly string[] = ['ApiLibrary'];

  constructor(
    private readonly runs: ApiLibraryRunService,
    private readonly contacts: ContactsService,
  ) {}

  execute(ctx: NodeContext): Promise<NodeResult> {
    return runApiLibrary(ctx, {
      run: (input) => this.runs.runForFlow(input),
      recordMissing: (input) => this.runs.recordMissing(input),
      readContactField: (orgId, contactId, key) =>
        this.contacts.readFieldForFlow(orgId, contactId, key),
      writeContactField: (orgId, contactId, key, value) =>
        this.contacts.setFieldFromFlow(orgId, contactId, key, value),
    });
  }
}
