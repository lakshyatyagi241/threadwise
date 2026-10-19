'use client';

import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { KEYS } from '../api/hooks';
import { parseFaqLocation, type FaqLocation } from '../lib/links';
import { FaqFlowProvider } from './faq-flow';
import { FaqShell } from './faq-shell';
import { FaqEditorScreen } from './editor-screen';
import { InsightsScreen } from './insights-screen';
import { FaqListScreen } from './list-screen';
import { PlaygroundScreen } from './playground-screen';
import { UnansweredScreen } from './unanswered-screen';

/**
 * The FAQs tab of a flow in the Simple builder. Which screen shows is `?view=` in the address (see `lib/links.ts`), so a reload and
 * the back button come back to the same screen, and moving between screens never leaves the builder or touches the flow being edited.
 * Everything below is scoped to this flow: its FAQs, tests, unanswered messages and insights.
 */
export function FaqPanel({
  flowId,
  flowName,
  onDirtyChange,
  builder,
}: {
  flowId: string;
  flowName: string;
  /** Called with true while a screen holds unsaved edits (an FAQ being edited). */
  onDirtyChange?: (dirty: boolean) => void;
  /** The builder hosting the tab; the screens link within it. */
  builder?: 'simple' | 'advanced';
}) {
  const params = useSearchParams();
  const location = parseFaqLocation(params.get('view'));
  const qc = useQueryClient();
  // The flow may have been saved since the steps were last read: the "Go to" picker starts from the saved flow.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: KEYS.flowNodes(flowId) });
  }, [qc, flowId]);
  return (
    <FaqFlowProvider
      flowId={flowId}
      flowName={flowName}
      onDirtyChange={onDirtyChange}
      builder={builder}
    >
      <FaqShell location={location}>
        <FaqScreen location={location} />
      </FaqShell>
    </FaqFlowProvider>
  );
}

function FaqScreen({ location }: { location: FaqLocation }) {
  switch (location.view) {
    case 'new':
      return <FaqEditorScreen />;
    case 'edit':
      return <FaqEditorScreen key={location.id} id={location.id} />;
    case 'test':
      return <PlaygroundScreen />;
    case 'unanswered':
      return <UnansweredScreen />;
    case 'insights':
      return <InsightsScreen />;
    default:
      return <FaqListScreen />;
  }
}
