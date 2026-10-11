/**
 * The stylesheet of a rendered form. It is a fixed string with no value from a form in it: every colour, radius and size
 * arrives as a CSS custom property set on the wrapper (`tokensToCssVars`), so theming cannot carry a rule (spec section 8).
 * It is self-contained (no Tailwind, no app stylesheet) because the same markup renders in the public page, in an embedding
 * frame and inside the builder's preview document.
 */

/** The dark neutrals a `dark` form uses (and an `auto` form uses under `prefers-color-scheme: dark`); the primary colour stays. */
export const DARK_NEUTRALS = {
  background: '#0B0F14',
  surface: '#141A22',
  text: '#F3F4F6',
  mutedText: '#9CA3AF',
  border: '#2A323D',
} as const;

const darkVars = `--f-bg:${DARK_NEUTRALS.background};--f-surface:${DARK_NEUTRALS.surface};--f-text:${DARK_NEUTRALS.text};--f-muted:${DARK_NEUTRALS.mutedText};--f-border:${DARK_NEUTRALS.border};color-scheme:dark;`;

export const FORM_CSS = `
.wf-root{--f-bg:var(--f-l-bg);--f-surface:var(--f-l-surface);--f-text:var(--f-l-text);--f-muted:var(--f-l-muted);--f-border:var(--f-l-border);box-sizing:border-box;font-family:var(--f-font);font-size:calc(16px * var(--f-scale));line-height:1.45;color:var(--f-text);background:var(--f-bg);background-image:var(--f-bg-image,none);background-size:cover;background-position:center;min-height:100%;padding:24px 16px;}
.wf-root[data-mode="dark"]{${darkVars}}
@media (prefers-color-scheme: dark){.wf-root[data-mode="auto"]{${darkVars}}}
.wf-root *,.wf-root *::before,.wf-root *::after{box-sizing:inherit}
.wf-root[data-embed="1"]{padding:0;background:transparent;background-image:none}
.wf-shell{max-width:var(--f-max);margin:0 auto}
.wf-card{background:var(--f-surface);border:1px solid var(--f-border);border-radius:var(--f-card-radius);box-shadow:var(--f-shadow);padding:clamp(18px,4vw,32px);}
.wf-root[data-layout="full_width"] .wf-shell{max-width:none}
.wf-root[data-layout="full_width"] .wf-card{border-radius:0;border-inline:0;box-shadow:none}
.wf-root[data-layout="minimal"] .wf-card{border:0;box-shadow:none;background:transparent;padding:0}
.wf-root[data-layout="split"] .wf-shell{max-width:min(var(--f-max) + 320px,1100px);display:grid;grid-template-columns:1fr;gap:0}
.wf-cover{display:none;border-radius:var(--f-card-radius) 0 0 var(--f-card-radius);background-size:cover;background-position:center;min-height:240px}
@media (min-width:760px){.wf-root[data-layout="split"] .wf-shell{grid-template-columns:minmax(0,320px) minmax(0,1fr)}.wf-root[data-layout="split"] .wf-cover{display:block}.wf-root[data-layout="split"] .wf-card{border-radius:0 var(--f-card-radius) var(--f-card-radius) 0}}
.wf-logo{display:block;max-height:48px;max-width:60%;margin:0 0 16px;object-fit:contain}
.wf-title{margin:0 0 6px;font-size:1.5em;line-height:1.2;font-weight:600}
.wf-desc{margin:0 0 20px;color:var(--f-muted)}
.wf-steps{display:flex;gap:6px;margin:0 0 18px;padding:0;list-style:none}
.wf-steps li{flex:1;height:4px;border-radius:99px;background:var(--f-border)}
.wf-steps li[data-done="1"]{background:var(--f-primary)}
.wf-step-title{margin:0 0 12px;font-size:1.1em;font-weight:600}
.wf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--f-gap)}
.wf-block{grid-column:1 / -1;min-width:0}
.wf-block[data-width="half"]{grid-column:span 1}
@media (max-width:639px){.wf-block[data-width="half"]{grid-column:1 / -1}}
.wf-heading{margin:8px 0 0;font-size:1.15em;font-weight:600}
.wf-para{margin:0;color:var(--f-muted);white-space:pre-wrap}
.wf-divider{border:0;border-top:1px solid var(--f-border);margin:4px 0}
.wf-field{display:flex;flex-direction:column;gap:6px}
.wf-root[data-labels="left"] .wf-field[data-simple="1"][data-width="full"]{flex-direction:row;align-items:flex-start;gap:14px}
.wf-root[data-labels="left"] .wf-field[data-simple="1"][data-width="full"] .wf-label{flex:0 0 32%;padding-top:var(--f-pad)}
.wf-root[data-labels="left"] .wf-field[data-simple="1"][data-width="full"] .wf-control{flex:1;min-width:0}
@media (max-width:639px){.wf-root[data-labels="left"] .wf-field[data-simple="1"][data-width="full"]{flex-direction:column}.wf-root[data-labels="left"] .wf-field[data-simple="1"][data-width="full"] .wf-label{flex:none;padding-top:0}}
.wf-label{font-weight:500;font-size:.95em}
.wf-req{color:var(--f-error);margin-inline-start:2px}
.wf-help{font-size:.85em;color:var(--f-muted)}
.wf-input,.wf-select,.wf-textarea{width:100%;font:inherit;font-size:max(16px,1em);color:var(--f-text);background:var(--f-bg);border:1px solid var(--f-border);border-radius:var(--f-radius);padding:var(--f-pad) 14px;min-height:44px;outline:none;transition:border-color .12s,box-shadow .12s}
.wf-root[data-mode="dark"] .wf-input,.wf-root[data-mode="dark"] .wf-select,.wf-root[data-mode="dark"] .wf-textarea{background:#0F141B}
.wf-textarea{min-height:110px;resize:vertical}
.wf-root[data-radius="pill"] .wf-textarea{border-radius:18px}
.wf-input::placeholder,.wf-textarea::placeholder{color:var(--f-muted);opacity:.8}
.wf-input:focus-visible,.wf-select:focus-visible,.wf-textarea:focus-visible{border-color:var(--f-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--f-primary) 25%,transparent)}
.wf-field[data-invalid="1"] .wf-input,.wf-field[data-invalid="1"] .wf-select,.wf-field[data-invalid="1"] .wf-textarea{border-color:var(--f-error)}
.wf-error{color:var(--f-error);font-size:.88em}
.wf-choices{display:flex;flex-direction:column;gap:8px;border:0;margin:0;padding:0;min-width:0}
.wf-choices legend{padding:0;margin-bottom:6px;font-weight:500;font-size:.95em}
.wf-choice{display:flex;align-items:flex-start;gap:10px;min-height:28px;cursor:pointer}
.wf-choice input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--f-primary);flex:none}
.wf-choice a{color:var(--f-primary)}
.wf-rating{display:flex;gap:6px;flex-wrap:wrap}
.wf-rating label{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--f-border);border-radius:var(--f-radius);cursor:pointer;font-weight:600;background:var(--f-bg)}
.wf-rating input{position:absolute;opacity:0;pointer-events:none}
.wf-rating input:checked+span{color:#fff}
.wf-rating label:has(input:checked){background:var(--f-primary);border-color:var(--f-primary);color:#fff}
.wf-rating label:has(input:focus-visible){box-shadow:0 0 0 3px color-mix(in srgb,var(--f-primary) 35%,transparent)}
.wf-consent{margin-top:var(--f-gap)}
.wf-pay{display:flex;flex-direction:column;gap:2px;margin-top:var(--f-gap);padding:12px 14px;border:1px solid var(--f-border);border-radius:var(--f-radius);background:var(--f-bg)}
.wf-pay-label{font-size:.8em;color:var(--f-muted)}
.wf-pay-amount{font-size:1.25em}
.wf-pay-note{font-size:.8em;color:var(--f-muted)}
.wf-actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}
.wf-btn{font:inherit;font-weight:600;min-height:46px;padding:0 22px;border-radius:var(--f-radius);cursor:pointer;border:1px solid var(--f-primary);background:var(--f-primary);color:#fff}
.wf-root[data-button="outline"] .wf-btn[data-kind="primary"]{background:transparent;color:var(--f-primary)}
.wf-btn[data-kind="secondary"]{background:transparent;color:var(--f-text);border-color:var(--f-border)}
.wf-root[data-button-width="full"] .wf-btn[data-kind="primary"]{flex:1 1 100%}
.wf-btn:focus-visible{outline:3px solid color-mix(in srgb,var(--f-primary) 40%,transparent);outline-offset:2px}
.wf-btn[disabled]{opacity:.6;cursor:not-allowed}
.wf-summary{border:1px solid var(--f-error);border-radius:var(--f-card-radius);padding:12px 14px;margin:0 0 16px;color:var(--f-error);background:color-mix(in srgb,var(--f-error) 8%,transparent)}
.wf-summary ul{margin:6px 0 0;padding-inline-start:18px}
.wf-summary a{color:inherit;text-decoration:underline}
.wf-banner{border:1px solid var(--f-border);border-radius:var(--f-card-radius);padding:12px 14px;margin:0 0 16px;background:var(--f-bg);color:var(--f-text)}
.wf-hp{position:absolute!important;inset-inline-start:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.wf-success{text-align:center;padding:24px 8px}
.wf-success h2{margin:12px 0 6px;font-size:1.3em}
.wf-success .wf-tick{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--f-primary);color:#fff;font-size:26px}
.wf-success p{margin:0;color:var(--f-muted)}
.wf-rich{white-space:pre-wrap}
.wf-brand{margin:14px 0 0;text-align:center;font-size:.8em;color:var(--f-muted)}
.wf-captcha{margin-top:14px}
.wf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion: reduce){.wf-input,.wf-select,.wf-textarea{transition:none}}
`;
