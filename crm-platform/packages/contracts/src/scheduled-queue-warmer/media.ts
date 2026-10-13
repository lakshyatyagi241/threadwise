/**
 * Files for a scheduled message (TW-SCHED-006): what the picker may upload and what each channel accepts. Shared by the API (which
 * refuses) and the screen (which tells the person before the upload starts), so the two never disagree.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** The biggest file the upload takes (the shared marketing-upload policy); a channel may take less. */
export const SCHEDULE_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export const SCHEDULE_MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
export type ScheduleMediaKind = (typeof SCHEDULE_MEDIA_KINDS)[number];

const MB = 1024 * 1024;

/**
 * Per channel and kind, the biggest file the provider takes. WhatsApp Cloud API: image 5 MB, video and audio 16 MB, document 100 MB
 * (capped here by the upload limit). Twilio WhatsApp: 16 MB for any media. The unofficial engine: what the WhatsApp client takes,
 * 16 MB for media.
 */
export const SCHEDULE_MEDIA_LIMITS: Record<string, Record<ScheduleMediaKind, number>> = {
  waba: { image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: SCHEDULE_MEDIA_MAX_BYTES },
  twilio: { image: 16 * MB, video: 16 * MB, audio: 16 * MB, document: 16 * MB },
  baileys: { image: 16 * MB, video: 16 * MB, audio: 16 * MB, document: SCHEDULE_MEDIA_MAX_BYTES },
};

/** The formats the Cloud API takes per kind; the other engines send whatever WhatsApp itself opens. */
const WABA_MIME: Partial<Record<ScheduleMediaKind, readonly string[]>> = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
};

export type ScheduleMediaProblem =
  | { code: 'too_large'; engine: string; kind: ScheduleMediaKind; limitBytes: number }
  | { code: 'type_not_supported'; engine: string; kind: ScheduleMediaKind; mime: string };

/** Why a file cannot go through this channel, or null when it can. */
export function scheduleMediaProblem(
  engine: string,
  file: { kind: ScheduleMediaKind; mime: string; size: number },
): ScheduleMediaProblem | null {
  const limit = SCHEDULE_MEDIA_LIMITS[engine]?.[file.kind] ?? SCHEDULE_MEDIA_MAX_BYTES;
  if (file.size > limit) {
    return { code: 'too_large', engine, kind: file.kind, limitBytes: limit };
  }
  if (engine === 'waba') {
    const ok = WABA_MIME[file.kind];
    if (ok && !ok.includes(file.mime.toLowerCase())) {
      return { code: 'type_not_supported', engine, kind: file.kind, mime: file.mime };
    }
  }
  return null;
}

/** English text for a problem; the screen words its own from `code`. */
export function scheduleMediaProblemText(p: ScheduleMediaProblem): string {
  const channel = p.engine === 'waba' ? 'WhatsApp Cloud API' : p.engine === 'twilio' ? 'Twilio' : 'this number';
  return p.code === 'too_large'
    ? `This ${p.kind} is bigger than ${channel} accepts (${Math.round(p.limitBytes / MB)} MB). Choose a smaller file.`
    : `${channel} does not accept ${p.mime} as ${p.kind === 'document' ? 'a document' : `a ${p.kind}`}. Use ${(WABA_MIME[p.kind] ?? []).join(', ')}.`;
}

/** One uploaded file, as the composer holds it until the schedule is saved. */
export const scheduleMediaSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  mime: z.string(),
  kind: z.enum(SCHEDULE_MEDIA_KINDS),
  size: z.number().int().nonnegative(),
  /** A link to look at the file (signed on a private bucket). Not the address the provider is given. */
  url: z.string(),
});
export type ScheduleMedia = z.infer<typeof scheduleMediaSchema>;
