'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { faqHref, type FaqView } from '../lib/links';

interface FaqFlowValue {
  /** The flow whose FAQs the screens show. Every request is scoped by it. */
  flowId: string;
  flowName: string;
  /** Tells the host (the builder) whether an FAQ screen holds unsaved edits, so leaving the tab can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The address of one screen of this flow's FAQs. */
  href: (target?: FaqView | { faqId: string }) => string;
}

const Ctx = createContext<FaqFlowValue | null>(null);

/** The flow the FAQ screens belong to: an FAQ never exists outside one. */
export function FaqFlowProvider({
  flowId,
  flowName,
  onDirtyChange,
  builder = 'simple',
  children,
}: {
  flowId: string;
  flowName: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** The builder hosting the tab, so a link between the FAQ screens stays in it. */
  builder?: 'simple' | 'advanced';
  children: ReactNode;
}) {
  const value = useMemo<FaqFlowValue>(
    () => ({
      flowId,
      flowName,
      onDirtyChange,
      href: (target) => faqHref(flowId, target, builder),
    }),
    [flowId, flowName, onDirtyChange, builder],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFaqFlow(): FaqFlowValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('The FAQ screens need a flow: render them inside <FaqFlowProvider>.');
  return v;
}

/** For hooks that only report to the host when there is one (the guard is also used outside a flow in tests). */
export const useOptionalFaqFlow = (): FaqFlowValue | null => useContext(Ctx);
