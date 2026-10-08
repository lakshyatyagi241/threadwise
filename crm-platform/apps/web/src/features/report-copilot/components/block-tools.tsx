'use client';

// CopilotKit 1.77 (v2 API). `useFrontendTool` is the primitive `useComponent` is built on; it adds the handler and the call status
// that `useComponent` leaves out, which the report needs to collect each block into the Report panel.
import { ToolCallStatus, useFrontendTool } from '@copilotkit/react-core/v2';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import { Alert, Spinner } from '@crm/ui';
import {
  SHOW_CHART,
  SHOW_KPIS,
  SHOW_SUMMARY,
  SHOW_TABLE,
  blockResult,
  chartBlockSchema,
  kpisBlockSchema,
  parseBlock,
  summaryBlockSchema,
  tableBlockSchema,
  type Block,
  type BlockTool,
} from '../lib/blocks';
import { turnOf } from '../lib/turn';
import { BlockView, ReportColors } from './report-blocks';

/**
 * The chat's view of a block. While the model is still writing it, a placeholder; once it is whole it is checked and drawn right in
 * the message, the same component the Report panel shows. A block that fails the check says so instead of drawing a broken chart.
 */
export function BlockToolCard(props: {
  name: string;
  toolCallId: string;
  args: unknown;
  status: ToolCallStatus;
}) {
  const t = useTranslations('report-copilot.tool');
  if (props.status !== ToolCallStatus.Complete) {
    return (
      <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner /> {t('drawing')}
      </p>
    );
  }
  const outcome = parseBlock(props.name as BlockTool, props.toolCallId, props.args);
  if (!outcome.ok) {
    return (
      <Alert tone="warning" className="my-1">
        {t('blockFailed')}
      </Alert>
    );
  }
  return (
    <div className="my-2 rounded-md border border-border p-3">
      <ReportColors />
      <BlockView block={outcome.block} />
    </div>
  );
}

export interface BlockContext {
  turn: string;
  prompt: string | null;
}

const DESCRIPTIONS: Record<BlockTool, string> = {
  [SHOW_SUMMARY]:
    'Show a heading and a short written summary or section of the report. Call it first with the report title and the main conclusion, and again for any section that needs explaining in words.',
  [SHOW_KPIS]:
    'Show a row of key figures (up to 8). Every number must come from the documents or the dashboard figures you read; put where it came from in `sources`. If a figure is one of the dashboard metrics, set `live` so it stays current.',
  [SHOW_CHART]:
    'Show a chart: bar, line, area, pie or donut, with one or more series. Every value must come from the documents or the dashboard figures you read; put where they came from in `sources`. A pie or donut takes one series, one point per slice.',
  [SHOW_TABLE]:
    'Show a table of rows and columns. Every value must come from the documents or the dashboard figures you read; put where they came from in `sources`.',
};

function useBlockTool(
  tool: BlockTool,
  schema: z.ZodType<Record<string, unknown>>,
  onBlock: (block: Block, ctx: BlockContext) => void,
) {
  useFrontendTool(
    {
      name: tool,
      description: DESCRIPTIONS[tool],
      parameters: schema,
      // The model shows all the blocks of a report in one answer; it does not need to be asked again after each.
      followUp: false,
      handler: async (args, context) => {
        const outcome = parseBlock(tool, context.toolCall.id, args);
        if (outcome.ok)
          onBlock(
            outcome.block,
            turnOf((context.agent as { messages?: never[] } | undefined)?.messages),
          );
        return blockResult(outcome);
      },
      render: BlockToolCard,
    },
    [],
  );
}

/**
 * Registers the four report blocks as tools the assistant can call: `show_summary`, `show_kpis`, `show_chart` and `show_table`.
 * Each one draws in the chat and is added, in order, to the report on the right. `onBlock` is read through a ref by the caller, so
 * the registration (made once) never holds a stale closure.
 */
export function useBlockTools(onBlock: (block: Block, ctx: BlockContext) => void) {
  useBlockTool(SHOW_SUMMARY, summaryBlockSchema, onBlock);
  useBlockTool(SHOW_KPIS, kpisBlockSchema, onBlock);
  useBlockTool(SHOW_CHART, chartBlockSchema, onBlock);
  useBlockTool(SHOW_TABLE, tableBlockSchema, onBlock);
}
