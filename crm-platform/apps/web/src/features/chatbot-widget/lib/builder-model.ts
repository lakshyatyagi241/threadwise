import {
  buildWhatsappLink,
  DEFAULT_LAUNCHER,
  isLauncherAvatar,
  LAUNCHER_LIMITS,
  resolveLauncherColour,
  WIDGET_BUILDER_DEFAULTS,
  WIDGET_HEX_COLOUR,
  type CreateWidgetInput,
  type LauncherButtonType,
  type LauncherSide,
  type Widget,
  type WidgetBodyBgKind,
  type WidgetLauncher,
  type WidgetMode,
  type WidgetPosition,
} from '@crm/contracts';

/** One placement of the launcher as the form holds it: spacing stays text until it is validated. */
export interface PlacementDraft {
  side: LauncherSide;
  sideSpacing: string;
  bottomSpacing: string;
}

/** The WhatsApp widget's look and placement as the form holds it (TW-WGT-028, Interakt reference). */
export interface LauncherDraft {
  buttonType: LauncherButtonType;
  /** A colour preset key or a hex colour. */
  colour: string;
  /** `preset:<key>` or an image address. */
  avatar: string;
  greeting: string;
  introMessage: string;
  desktop: PlacementDraft;
  mobile: PlacementDraft;
}

const placementDraft = (p: WidgetLauncher['desktop']): PlacementDraft => ({
  side: p.side,
  sideSpacing: String(p.sideSpacing),
  bottomSpacing: String(p.bottomSpacing),
});

export const launcherDraft = (l: WidgetLauncher): LauncherDraft => ({
  buttonType: l.buttonType,
  colour: l.colour,
  avatar: l.avatar,
  greeting: l.greeting,
  introMessage: l.introMessage,
  desktop: placementDraft(l.desktop),
  mobile: placementDraft(l.mobile),
});

const spacingOf = (v: string): number =>
  /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;

/** The draft as the API takes it. A spacing that is not a whole number is NaN here; `validateWhatsapp` refuses it first. */
export const launcherPayload = (d: LauncherDraft): WidgetLauncher => ({
  buttonType: d.buttonType,
  colour: d.colour,
  avatar: d.avatar,
  greeting: d.greeting.trim(),
  introMessage: d.introMessage.trim(),
  desktop: {
    side: d.desktop.side,
    sideSpacing: spacingOf(d.desktop.sideSpacing),
    bottomSpacing: spacingOf(d.desktop.bottomSpacing),
  },
  mobile: {
    side: d.mobile.side,
    sideSpacing: spacingOf(d.mobile.sideSpacing),
    bottomSpacing: spacingOf(d.mobile.bottomSpacing),
  },
});

/**
 * What the four-step builder edits (TW-WGT-002 to 005): one flat object, text fields as plain strings ('' = none), the way
 * the form holds them. `toPayload` turns it into the API body; `fromWidget` is the way back.
 */
export interface BuilderState {
  /** Set once the widget exists (loaded for edit, or after the first save). */
  id: string | null;
  rowVersion: number | null;
  name: string;
  mode: WidgetMode;
  assistantId: string;
  targetWhatsappCc: string;
  targetWhatsappNumber: string;
  prefilledMessage: string;
  position: WidgetPosition;
  buttonColor: string;
  buttonImageUrl: string;
  headerTitle: string;
  headerBg: string;
  headerTextColor: string;
  welcomeMessage: string;
  messageBubbleColor: string;
  messageTextColor: string;
  bodyBgKind: WidgetBodyBgKind;
  bodyBgColor: string;
  bodyBgImageUrl: string;
  autoOpen: boolean;
  buttonLabel: string;
  actionButtonBg: string;
  actionButtonTextColor: string;
  collectName: boolean;
  collectEmail: boolean;
  collectPhone: boolean;
  /** The WhatsApp widget's look and placement; the AI and Both builders carry it along untouched. */
  launcher: LauncherDraft;
}

export const TOTAL_STEPS = 4;
export type StepNumber = 1 | 2 | 3 | 4;

const D = WIDGET_BUILDER_DEFAULTS;

/** A new widget, with the values the builder opens on. */
export function newState(): BuilderState {
  return {
    id: null,
    rowVersion: null,
    name: D.name,
    // The Install & Customize page is the primary builder, so a new widget opens on it.
    mode: 'whatsapp',
    assistantId: '',
    targetWhatsappCc: D.targetWhatsappCc,
    targetWhatsappNumber: D.targetWhatsappNumber,
    prefilledMessage: D.prefilledMessage,
    position: D.position,
    buttonColor: D.buttonColor,
    buttonImageUrl: D.buttonImageUrl,
    headerTitle: D.headerTitle,
    headerBg: D.headerBg,
    headerTextColor: D.headerTextColor,
    welcomeMessage: D.welcomeMessage,
    messageBubbleColor: D.messageBubbleColor,
    messageTextColor: D.messageTextColor,
    bodyBgKind: D.bodyBgKind,
    bodyBgColor: D.bodyBgColor,
    bodyBgImageUrl: D.bodyBgImageUrl,
    autoOpen: D.autoOpen,
    buttonLabel: D.buttonLabel,
    actionButtonBg: D.actionButtonBg,
    actionButtonTextColor: D.actionButtonTextColor,
    collectName: D.collectName,
    collectEmail: D.collectEmail,
    collectPhone: D.collectPhone,
    launcher: launcherDraft(DEFAULT_LAUNCHER),
  };
}

/** An existing widget, as the edit page opens it. A saved empty string stays empty (Reference's `?? default` only filled nulls). */
export function fromWidget(w: Widget): BuilderState {
  return {
    id: w.id,
    rowVersion: w.rowVersion,
    name: w.name,
    mode: w.mode,
    assistantId: w.assistantId ?? '',
    targetWhatsappCc: w.targetWhatsappCc ?? '',
    targetWhatsappNumber: w.targetWhatsappNumber ?? '',
    prefilledMessage: w.prefilledMessage ?? D.prefilledMessage,
    position: w.position,
    buttonColor: w.buttonColor,
    buttonImageUrl: w.buttonImageUrl ?? '',
    headerTitle: w.headerTitle,
    headerBg: w.headerBg,
    headerTextColor: w.headerTextColor,
    welcomeMessage: w.welcomeMessage ?? D.welcomeMessage,
    messageBubbleColor: w.messageBubbleColor,
    messageTextColor: w.messageTextColor,
    bodyBgKind: w.bodyBgKind,
    bodyBgColor: w.bodyBgColor,
    bodyBgImageUrl: w.bodyBgImageUrl ?? '',
    autoOpen: w.autoOpen,
    buttonLabel: w.buttonLabel,
    actionButtonBg: w.actionButtonBg,
    actionButtonTextColor: w.actionButtonTextColor,
    collectName: w.collectName,
    collectEmail: w.collectEmail,
    collectPhone: w.collectPhone,
    launcher: launcherDraft(w.launcher),
  };
}

/** The save body. `allowedDomains` is left out on purpose: the builder has no control for it and a save must not clear it. */
export function toPayload(s: BuilderState): CreateWidgetInput {
  const orNull = (v: string) => (v.trim() === '' ? null : v);
  const wa = s.mode === 'whatsapp';
  return {
    name: s.name,
    mode: s.mode,
    assistantId: s.assistantId === '' ? null : s.assistantId,
    targetWhatsappCc: orNull(s.targetWhatsappCc),
    targetWhatsappNumber: orNull(s.targetWhatsappNumber),
    prefilledMessage: orNull(s.prefilledMessage),
    // A WhatsApp widget is placed by its launcher config; the legacy side and fill follow it so the list shows the same.
    position: wa
      ? s.launcher.desktop.side === 'left'
        ? 'bottom_left'
        : 'bottom_right'
      : s.position,
    buttonColor: wa ? resolveLauncherColour(s.launcher.colour).from : s.buttonColor,
    buttonImageUrl: orNull(s.buttonImageUrl),
    headerTitle: s.headerTitle,
    headerBg: s.headerBg,
    headerTextColor: s.headerTextColor,
    welcomeMessage: orNull(s.welcomeMessage),
    messageBubbleColor: s.messageBubbleColor,
    messageTextColor: s.messageTextColor,
    bodyBgKind: s.bodyBgKind,
    bodyBgColor: s.bodyBgColor,
    bodyBgImageUrl: orNull(s.bodyBgImageUrl),
    autoOpen: s.autoOpen,
    buttonLabel: s.buttonLabel,
    actionButtonBg: s.actionButtonBg,
    actionButtonTextColor: s.actionButtonTextColor,
    collectName: s.collectName,
    collectEmail: s.collectEmail,
    collectPhone: s.collectPhone,
    launcher: launcherPayload(s.launcher),
  };
}

export type StepProblem =
  | { ok: true }
  | {
      ok: false;
      /** Message key under `chatbotWidget.builder.problem`. */
      key:
        | 'name'
        | 'assistant'
        | 'whatsapp'
        | 'launcherColour'
        | 'headerTitle'
        | 'welcome'
        | 'bgImage';
      /** The control to flash and focus. */
      field: keyof BuilderState | 'phone';
    };

const digitsOf = (v: string) => v.replace(/\D+/g, '');

/**
 * The rule of one step: the first failing rule wins (TW-WGT-002). The browser checks these and the server checks its own;
 * a draft can never be saved while a step is incomplete because `firstProblem` walks all four.
 */
export function validateStep(n: number, s: BuilderState): StepProblem {
  if (n === 1) {
    if (s.name.trim() === '') return { ok: false, key: 'name', field: 'name' };
    if ((s.mode === 'ai' || s.mode === 'both') && s.assistantId === '') {
      return { ok: false, key: 'assistant', field: 'assistantId' };
    }
    if (s.mode === 'whatsapp' || s.mode === 'both') {
      if (digitsOf(`${s.targetWhatsappCc}${s.targetWhatsappNumber}`).length < 8) {
        return { ok: false, key: 'whatsapp', field: 'phone' };
      }
    }
  }
  if (n === 2) {
    if (!WIDGET_HEX_COLOUR.test(s.buttonColor)) {
      return { ok: false, key: 'launcherColour', field: 'buttonColor' };
    }
    if (s.headerTitle.trim() === '') return { ok: false, key: 'headerTitle', field: 'headerTitle' };
  }
  if (n === 3) {
    if (s.welcomeMessage.trim() === '') {
      return { ok: false, key: 'welcome', field: 'welcomeMessage' };
    }
    if (s.bodyBgKind === 'image' && s.bodyBgImageUrl.trim() === '') {
      return { ok: false, key: 'bgImage', field: 'bodyBgImageUrl' };
    }
  }
  return { ok: true };
}

/** Every step in order; save and launch jump to the step this returns. */
export function firstProblem(
  s: BuilderState,
): { step: StepNumber; problem: StepProblem & { ok: false } } | null {
  for (const step of [1, 2, 3, 4] as const) {
    const p = validateStep(step, s);
    if (!p.ok) return { step, problem: p };
  }
  return null;
}

/** May the stepper node `target` be opened from `current`? Back and already-reached steps are free; forward is gated. */
export function canJump(target: number, current: number, furthest: number): 'free' | 'gate' {
  return target <= current || target <= furthest ? 'free' : 'gate';
}

export const intakeSummary = (
  s: Pick<BuilderState, 'collectName' | 'collectEmail' | 'collectPhone'>,
): string[] =>
  [s.collectName && 'name', s.collectEmail && 'email', s.collectPhone && 'phone'].filter(
    (x): x is string => typeof x === 'string',
  );

/** The pasted tag, with the extension-less address the API hands out. */
export const snippetFor = (embedUrl: string): string => `<script defer src="${embedUrl}"></script>`;

/** `<input type="color">` only accepts `#rrggbb`; a short or invalid value shows its nearest swatch, never an error. */
export function swatchValue(v: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m)
    return `#${m[1]!
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase();
  return '#000000';
}

/** The background-image URL the preview may use: absolute http(s) only, as the chat page does. */
export function previewImageUrl(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.href.replace(/['"()\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
      : null;
  } catch {
    return null;
  }
}

// --- the WhatsApp widget page (TW-WGT-028) ---------------------------------------------------------------------------------

export type WhatsappCard = 1 | 2 | 3 | 4 | 5;

export type WhatsappProblem =
  | { ok: true }
  | {
      ok: false;
      /** Message key under `chatbotWidget.whatsappBuilder.problem`. */
      key: 'name' | 'avatar' | 'greeting' | 'intro' | 'spacing' | 'whatsapp';
      /** The accordion card to open (0 = the name above the cards). */
      card: 0 | WhatsappCard;
      /** The control to flash and focus: its `wgt-f-<field>` id. */
      field: string;
    };

const SPACING_FIELDS = [
  ['desktop', 'sideSpacing', 'desktopSideSpacing'],
  ['desktop', 'bottomSpacing', 'desktopBottomSpacing'],
  ['mobile', 'sideSpacing', 'mobileSideSpacing'],
  ['mobile', 'bottomSpacing', 'mobileBottomSpacing'],
] as const;

/** A spacing the API will take: a whole number of pixels from 0 to the limit. */
export const validSpacing = (v: string): boolean => {
  const n = spacingOf(v);
  return Number.isInteger(n) && n >= 0 && n <= LAUNCHER_LIMITS.spacing;
};

/** The first failing rule of the WhatsApp page, in the order the page reads. */
export function validateWhatsapp(s: BuilderState): WhatsappProblem {
  if (s.name.trim() === '') return { ok: false, key: 'name', card: 0, field: 'name' };
  const l = s.launcher;
  if (!isLauncherAvatar(l.avatar)) return { ok: false, key: 'avatar', card: 2, field: 'avatar' };
  if (l.greeting.trim() === '') return { ok: false, key: 'greeting', card: 3, field: 'greeting' };
  if (l.introMessage.trim() === '') {
    return { ok: false, key: 'intro', card: 3, field: 'introMessage' };
  }
  for (const [device, key, field] of SPACING_FIELDS) {
    if (!validSpacing(l[device][key])) return { ok: false, key: 'spacing', card: 4, field };
  }
  if (digitsOf(`${s.targetWhatsappCc}${s.targetWhatsappNumber}`).length < 8) {
    return { ok: false, key: 'whatsapp', card: 5, field: 'phone' };
  }
  return { ok: true };
}

/** The link Start Conversation opens, from what the form holds right now; null while there is no number. */
export const previewWhatsappLink = (s: BuilderState): string | null =>
  buildWhatsappLink(s.targetWhatsappCc, s.targetWhatsappNumber, s.prefilledMessage);

/** A launcher config that is always drawable: unfinished spacing text falls back to the defaults so the preview never breaks. */
export function previewLauncher(d: LauncherDraft): WidgetLauncher {
  const p = launcherPayload(d);
  const fix = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(n, 500) : fallback);
  return {
    ...p,
    greeting: p.greeting || DEFAULT_LAUNCHER.greeting,
    introMessage: p.introMessage || DEFAULT_LAUNCHER.introMessage,
    avatar: isLauncherAvatar(p.avatar) ? p.avatar : DEFAULT_LAUNCHER.avatar,
    desktop: {
      ...p.desktop,
      sideSpacing: fix(p.desktop.sideSpacing, DEFAULT_LAUNCHER.desktop.sideSpacing),
      bottomSpacing: fix(p.desktop.bottomSpacing, DEFAULT_LAUNCHER.desktop.bottomSpacing),
    },
    mobile: {
      ...p.mobile,
      sideSpacing: fix(p.mobile.sideSpacing, DEFAULT_LAUNCHER.mobile.sideSpacing),
      bottomSpacing: fix(p.mobile.bottomSpacing, DEFAULT_LAUNCHER.mobile.bottomSpacing),
    },
  };
}
