import { flbNormalizeGraph } from '@crm/contracts';
import { msg, type Msg } from './msg';
import { toSimple, type SimpleDoc } from './simple-model';
import { isWaboExport, waboToGraph } from './wabo-import';

/** What the Simple builder's Import button reads: a file of this workspace's own flow export, or a wabo console export. */
export type SimpleImport =
  | { ok: true; doc: SimpleDoc; name: string | null; notes: Msg[]; source: 'crm' | 'wabo' }
  | { ok: false; reasons: Msg[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function importToSimple(raw: unknown): SimpleImport {
  if (isWaboExport(raw)) {
    const w = waboToGraph(raw, { exact: true });
    const res = toSimple(w.graph);
    if (!res.ok) return { ok: false, reasons: res.reasons };
    return { ok: true, doc: res.doc, name: null, notes: w.notes, source: 'wabo' };
  }
  const file = isRecord(raw) ? raw : {};
  const graphRaw = isRecord(file.flow_data) ? file.flow_data : file;
  if (!Array.isArray(graphRaw.flowNodes))
    return {
      ok: false,
      reasons: [msg('waboImport.reasons.notExport')],
    };
  if (file.flow_type && file.flow_type !== 'chat' && file.flow_type !== 'web')
    return {
      ok: false,
      reasons: [msg('waboImport.reasons.otherFlowType', { type: String(file.flow_type) })],
    };
  const res = toSimple(flbNormalizeGraph(graphRaw));
  if (!res.ok) return { ok: false, reasons: res.reasons };
  const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : null;
  return { ok: true, doc: res.doc, name, notes: [], source: 'crm' };
}

/**
 * Put an imported flow in place of the one being edited. The number the flow runs on stays what it was (a file never knows
 * this workspace's numbers); the trigger words stay unless there were none.
 */
export function applyImport(current: SimpleDoc, imported: SimpleDoc): SimpleDoc {
  const keep = String(current.trigger.data.keywords ?? '').trim();
  return {
    trigger: {
      ...imported.trigger,
      id: current.trigger.id,
      data: {
        ...imported.trigger.data,
        deviceId: current.trigger.data.deviceId ?? '',
        ...(keep ? { keywords: keep } : {}),
      },
    },
    journeys: imported.journeys,
    vars: imported.vars,
  };
}
