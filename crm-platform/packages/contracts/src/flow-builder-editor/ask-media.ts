/**
 * The "Ask for file / image" (`ask_file`) and "Ask for location" (`ask_location`) nodes (WD-FLB-094, 095). NOT WaDesk features: an
 * addition the project owner asked for, modelled on how the Ask node parks a run and resumes it. This file holds what the editor
 * (the Allow Extensions panel, the node card) and the runtime (the reply check) must agree on, as pure data and functions.
 */

export type FlbAskFileGroupId = 'images' | 'audio' | 'video' | 'documents';

export interface FlbAskFileExtension {
  ext: string;
  /** The MIME types WhatsApp reports for this extension; a file with no usable name is matched on these. */
  mimes: readonly string[];
}

export interface FlbAskFileGroup {
  id: FlbAskFileGroupId;
  label: string;
  /** The `media` kind a WhatsApp message of this group arrives as. */
  mediaKind: 'image' | 'audio' | 'video' | 'document';
  extensions: readonly FlbAskFileExtension[];
}

const OOXML = 'application/vnd.openxmlformats-officedocument';

/** The groups the Allow Extensions panel lists, each extension in its correct group. */
export const FLB_ASK_FILE_GROUPS: readonly FlbAskFileGroup[] = [
  {
    id: 'images',
    label: 'Images',
    mediaKind: 'image',
    extensions: [
      { ext: 'jpg', mimes: ['image/jpeg'] },
      { ext: 'jpeg', mimes: ['image/jpeg'] },
      { ext: 'png', mimes: ['image/png'] },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    mediaKind: 'audio',
    extensions: [
      { ext: 'mp3', mimes: ['audio/mpeg', 'audio/mp3'] },
      { ext: 'wav', mimes: ['audio/wav', 'audio/x-wav', 'audio/wave'] },
      // Not in the other product's list: a WhatsApp voice note is audio/ogg, so without it "all Audio" would refuse voice notes.
      { ext: 'ogg', mimes: ['audio/ogg', 'audio/opus'] },
    ],
  },
  {
    id: 'video',
    label: 'Video',
    mediaKind: 'video',
    extensions: [
      { ext: 'mp4', mimes: ['video/mp4'] },
      { ext: 'webm', mimes: ['video/webm'] },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    mediaKind: 'document',
    extensions: [
      { ext: 'pdf', mimes: ['application/pdf'] },
      { ext: 'docx', mimes: [`${OOXML}.wordprocessingml.document`] },
      { ext: 'xlsx', mimes: [`${OOXML}.spreadsheetml.sheet`] },
      { ext: 'csv', mimes: ['text/csv', 'application/csv'] },
      { ext: 'doc', mimes: ['application/msword'] },
      { ext: 'xls', mimes: ['application/vnd.ms-excel'] },
      { ext: 'ppt', mimes: ['application/vnd.ms-powerpoint'] },
      { ext: 'pptx', mimes: [`${OOXML}.presentationml.presentation`] },
      { ext: 'txt', mimes: ['text/plain'] },
    ],
  },
];

export const FLB_ASK_FILE_EXTENSIONS: readonly string[] = FLB_ASK_FILE_GROUPS.flatMap((g) =>
  g.extensions.map((e) => e.ext),
);

const MIME_BY_EXT = new Map(
  FLB_ASK_FILE_GROUPS.flatMap((g) => g.extensions.map((e) => [e.ext, e.mimes] as const)),
);

/** The allow-list as saved: lower-case extensions without a dot, only known ones, once each, in panel order. */
export function flbCleanAskFileExtensions(raw: unknown): string[] {
  const asked = new Set(
    (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : [])
      .map((v) =>
        String(v ?? '')
          .trim()
          .toLowerCase()
          .replace(/^\./, ''),
      )
      .filter((v) => v !== ''),
  );
  return FLB_ASK_FILE_EXTENSIONS.filter((e) => asked.has(e));
}

/** The extension of a file name, lower case, without the dot; '' when it has none. */
export function flbFileExtensionOf(name: unknown): string {
  const n = String(name ?? '')
    .trim()
    .split(/[?#]/)[0]!;
  const dot = n.lastIndexOf('.');
  return dot > 0 && dot < n.length - 1 ? n.slice(dot + 1).toLowerCase() : '';
}

/**
 * Does a received file pass the node's allow-list? An empty list accepts any file. Otherwise the file passes when the extension of
 * its name is listed, or when its MIME type is one a listed extension stands for (a WhatsApp photo has no file name).
 */
export function flbAskFileAccepts(
  extensions: readonly string[],
  file: { name?: string | null; mime?: string | null },
): boolean {
  const allowed = flbCleanAskFileExtensions(extensions);
  if (allowed.length === 0) return true;
  const ext = flbFileExtensionOf(file.name);
  if (ext !== '' && allowed.includes(ext)) return true;
  const mime = String(file.mime ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (mime === '') return false;
  return allowed.some((e) => (MIME_BY_EXT.get(e) ?? []).includes(mime));
}

/** "jpg, png, pdf" for the node card; "Any file" for an empty list. */
export function flbAskFileSummary(extensions: unknown): string {
  const list = flbCleanAskFileExtensions(extensions);
  return list.length === 0 ? 'Any file' : list.join(', ');
}

/** The variables the Ask-for-file node saves besides `{{<var>}}` (the file link), as `{{<var>_kind}}`... */
export const FLB_ASK_FILE_VAR_SUFFIXES = ['kind', 'name', 'mime', 'caption'] as const;
/** The variables the Ask-for-location node saves besides `{{<var>}}` (the maps link). */
export const FLB_ASK_LOCATION_VAR_SUFFIXES = [
  'latitude',
  'longitude',
  'name',
  'address',
  'link',
] as const;

/** Where a node leaves when the customer never sends what it asked for. */
export const FLB_ASK_GIVE_UP_MODES = ['continue', 'end'] as const;
export type FlbAskGiveUp = (typeof FLB_ASK_GIVE_UP_MODES)[number];

export const FLB_ASK_MAX_RETRIES = 10;
