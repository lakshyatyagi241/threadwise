'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RC_PRINT_CSS } from '../lib/palette';

/**
 * What the browser's print dialog shows. The report is drawn a second time as a direct child of <body>, hidden on screen; while
 * printing, everything else on the page is hidden and only this copy is shown. That prints (or saves as PDF) the report and
 * nothing of the dashboard around it.
 */
const PRINT_CSS = `
.report-print-root {
  display: none;
  /* paper is white: the light palette, whatever theme the screen uses */
  --background: #ffffff; --foreground: #0f172a; --muted: #f1f5f9; --muted-foreground: #64748b; --border: #e2e8f0;
  --primary: #0f766e; --brand: #0b5a45; --success: #15803d; --warning: #b45309; --danger: #b91c1c;
}
@media print {
  body > *:not(.report-print-root) { display: none !important; }
  .report-print-root { display: block !important; padding: 0; background: #fff; color: var(--foreground); }
  .report-print-root * { box-shadow: none !important; }
  @page { margin: 14mm; }
}
`;

export function ReportPrint({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="report-print-root" aria-hidden="true">
      <style>{PRINT_CSS + RC_PRINT_CSS}</style>
      {children}
    </div>,
    document.body,
  );
}
