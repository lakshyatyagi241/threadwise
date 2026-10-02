import { buildLauncherScript, type WidgetLauncher } from '@crm/contracts';

export interface PreviewDocInput {
  /** The business name in the panel header. */
  name: string;
  launcher: WidgetLauncher;
  whatsappUrl: string | null;
  device: 'desktop' | 'mobile';
  /** See `PreviewSource.inertStart`. */
  inertStart?: boolean;
  /** Keeps the panel open across a repaint of the preview. */
  startOpen: boolean;
}

/**
 * The page the builder's live preview frame shows: a stand-in website with the REAL embed script on it, so the preview is
 * the launcher a visitor gets and not a second drawing of it. The frame pins the device (the script would otherwise follow
 * the frame's own width) and reports opens and closes to the builder through `postMessage`.
 */
export function previewDocument(i: PreviewDocInput): string {
  const script = buildLauncherScript({
    id: 'preview',
    name: i.name,
    launcher: i.launcher,
    whatsappUrl: i.whatsappUrl,
    preview: true,
    device: i.device,
    startOpen: i.startOpen,
    inertStart: i.inertStart,
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:linear-gradient(180deg,#f7f7f8,#ececef);font-family:system-ui,sans-serif;overflow:hidden}
  .bar{display:flex;align-items:center;gap:6px;padding:9px 14px;background:rgba(255,255,255,.7);border-bottom:1px solid #e2e2e6}
  .dot{width:8px;height:8px;border-radius:50%;background:#d4d4d8}
  .url{flex:1;height:12px;margin-left:10px;border-radius:6px;background:#e4e4e8}
</style></head>
<body>
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url"></span></div>
  <script>${script}</script>
</body></html>`;
}
