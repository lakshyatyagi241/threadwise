import { buildLauncherScript, type WidgetLauncher } from '@crm/contracts';

export interface PreviewDocInput {
  /** The business name in the panel header. */
  name: string;
  launcher: WidgetLauncher;
  whatsappUrl: string | null;
  device: 'desktop' | 'mobile';
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
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#fafafa;font-family:system-ui,sans-serif;overflow:hidden}
  .bar{display:flex;align-items:center;gap:6px;padding:10px 14px;background:#f1f1f3;border-bottom:1px solid #e4e4e7}
  .dot{width:9px;height:9px;border-radius:50%;background:#d4d4d8}
  .url{flex:1;height:14px;margin-left:10px;border-radius:7px;background:#e4e4e7}
  .page{padding:22px 22px}
  .hero{height:${i.device === 'mobile' ? 90 : 120}px;border-radius:10px;background:#e8e8ec;margin-bottom:16px}
  .line{height:10px;border-radius:5px;background:#e4e4e7;margin-bottom:10px}
  .w60{width:60%}.w80{width:80%}.w45{width:45%}
</style></head>
<body>
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url"></span></div>
  <div class="page">
    <div class="hero"></div>
    <div class="line w80"></div><div class="line"></div><div class="line w60"></div><div class="line w45"></div>
  </div>
  <script>${script}</script>
</body></html>`;
}
