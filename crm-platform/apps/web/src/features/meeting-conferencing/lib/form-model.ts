import type {
  ConferencingCapabilities,
  ContactMeetingResponse,
  MeetingConferencingInput,
  VideoProvider,
  VideoVia,
} from '@crm/contracts';

/** Where the quiet "Connect video conferencing" link goes, or null when there is nothing a person could do. */
export const MARKETPLACE_INTEGRATIONS = '/marketplace/integrations';
export const VIDEO_MEETINGS_PATH = '/settings/video-meetings';

export interface VideoOption {
  provider: VideoProvider;
  via: VideoVia;
}

/**
 * The options the form draws: what the person has right now, plus the provider a meeting being edited already holds (so the row says what
 * it has even when that integration was disconnected since, and removing it stays possible).
 */
export function optionsFor(
  caps: ConferencingCapabilities,
  current: VideoProvider | null,
): VideoOption[] {
  const out: VideoOption[] = caps.video.map((o) => ({ provider: o.provider, via: o.via }));
  if (current && !out.some((o) => o.provider === current)) {
    out.push({ provider: current, via: current === 'zoom' ? 'app' : 'calendar' });
  }
  return out;
}

/**
 * The one quiet link shown when no video option exists: to the person's own connection page when the workspace already installed an
 * integration and only their account is missing, else to the Marketplace for a person allowed to install one. Null = show nothing.
 */
export function connectLinkOf(caps: ConferencingCapabilities): string | null {
  if (caps.video.length > 0) return null;
  if (caps.connectable.length > 0) return VIDEO_MEETINGS_PATH;
  if (caps.canInstall && caps.installable) return MARKETPLACE_INTEGRATIONS;
  return null;
}

/** Choosing the chosen provider again takes the link off; choosing another replaces it. */
export function toggleProvider(
  chosen: VideoProvider | null,
  clicked: VideoProvider,
): Partial<MeetingConferencingInput> {
  return chosen === clicked ? { videoProvider: null } : { videoProvider: clicked };
}

/**
 * The form's starting value for a meeting that exists: what it already asks for, so saving an edit that touches nothing about video leaves
 * it as it is. A meeting with none starts with nothing asked.
 */
export function inputOf(m: ContactMeetingResponse): MeetingConferencingInput | undefined {
  const c = m.conferencing;
  if (!c) return undefined;
  return {
    videoProvider: c.videoProvider,
    addToCalendar: c.calendarProvider !== null || c.videoProvider === 'meet',
    sendInvitation: c.invited,
  };
}
