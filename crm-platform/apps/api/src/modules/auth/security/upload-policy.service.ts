import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

const BLOCKED_EXTENSIONS = new Set([
  'php',
  'phtml',
  'php3',
  'php4',
  'php5',
  'php6',
  'php7',
  'phps',
  'pht',
  'phtm',
  'phar',
  'htaccess',
  'htm',
  'html',
  'svg',
  'xml',
  'xhtml',
  'js',
  'mjs',
  'cgi',
  'pl',
  'py',
  'sh',
  'exe',
  'bat',
  'com',
  'jsp',
  'asp',
  'aspx',
]);

export type UploadKind = 'image' | 'media' | 'document';

/** Extension -> signature check. Content, not the client's Content-Type, decides. */
const EXTENSIONS: Record<
  string,
  { kind: UploadKind; mime: string; sniff: (b: Buffer) => boolean }
> = {
  jpg: {
    kind: 'image',
    mime: 'image/jpeg',
    sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  jpeg: {
    kind: 'image',
    mime: 'image/jpeg',
    sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  png: {
    kind: 'image',
    mime: 'image/png',
    sniff: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  gif: {
    kind: 'image',
    mime: 'image/gif',
    sniff: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  },
  webp: {
    kind: 'image',
    mime: 'image/webp',
    sniff: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  bmp: { kind: 'image', mime: 'image/bmp', sniff: (b) => b[0] === 0x42 && b[1] === 0x4d },
  tiff: {
    kind: 'image',
    mime: 'image/tiff',
    sniff: (b) =>
      (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a),
  },
  mp4: {
    kind: 'media',
    mime: 'video/mp4',
    sniff: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  mov: {
    kind: 'media',
    mime: 'video/quicktime',
    // A QuickTime file starts with whichever top-level atom the encoder wrote
    // first: `ftyp` or `moov`, but just as often `wide`, `mdat`, `free`, `skip` or `pnot`.
    sniff: (b) => MOV_FIRST_ATOMS.has(b.subarray(4, 8).toString('ascii')),
  },
  '3gp': {
    kind: 'media',
    mime: 'video/3gpp',
    sniff: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  webm: {
    kind: 'media',
    mime: 'video/webm',
    sniff: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  mkv: {
    kind: 'media',
    mime: 'video/x-matroska',
    sniff: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  mp3: {
    kind: 'media',
    mime: 'audio/mpeg',
    sniff: (b) =>
      b.subarray(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
  },
  ogg: {
    kind: 'media',
    mime: 'audio/ogg',
    sniff: (b) => b.subarray(0, 4).toString('ascii') === 'OggS',
  },
  opus: {
    kind: 'media',
    mime: 'audio/ogg',
    sniff: (b) => b.subarray(0, 4).toString('ascii') === 'OggS',
  },
  m4a: {
    kind: 'media',
    mime: 'audio/mp4',
    sniff: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  aac: { kind: 'media', mime: 'audio/aac', sniff: (b) => b[0] === 0xff && (b[1]! & 0xf0) === 0xf0 },
  wav: {
    kind: 'media',
    mime: 'audio/wav',
    sniff: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
  amr: {
    kind: 'media',
    mime: 'audio/amr',
    sniff: (b) => b.subarray(0, 5).toString('ascii') === '#!AMR',
  },
  pdf: {
    kind: 'document',
    mime: 'application/pdf',
    sniff: (b) => b.subarray(0, 4).toString('ascii') === '%PDF',
  },
  doc: {
    kind: 'document',
    mime: 'application/msword',
    sniff: (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  },
  xls: {
    kind: 'document',
    mime: 'application/vnd.ms-excel',
    sniff: (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  },
  ppt: {
    kind: 'document',
    mime: 'application/vnd.ms-powerpoint',
    sniff: (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  },
  docx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sniff: (b) => b[0] === 0x50 && b[1] === 0x4b,
  },
  xlsx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sniff: (b) => b[0] === 0x50 && b[1] === 0x4b,
  },
  pptx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sniff: (b) => b[0] === 0x50 && b[1] === 0x4b,
  },
  zip: { kind: 'document', mime: 'application/zip', sniff: (b) => b[0] === 0x50 && b[1] === 0x4b },
  rtf: {
    kind: 'document',
    mime: 'application/rtf',
    sniff: (b) => b.subarray(0, 5).toString('ascii') === '{\\rtf',
  },
  txt: { kind: 'document', mime: 'text/plain', sniff: (b) => looksLikeText(b) },
  csv: { kind: 'document', mime: 'text/csv', sniff: (b) => looksLikeText(b) },
};

const MOV_FIRST_ATOMS = new Set(['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip', 'pnot']);

/** Text that is really markup or script is refused even under a .txt name. */
function looksLikeText(b: Buffer): boolean {
  const head = b.subarray(0, 1024).toString('utf8').toLowerCase();
  if (/<\s*(html|script|svg|\?php|iframe|object|embed)/.test(head)) return false;
  return !b.subarray(0, 1024).includes(0); // NUL bytes: binary
}

export interface UploadCheck {
  filename: string;
  buffer: Buffer;
  /** Allowed kinds for this endpoint, e.g. ['image'] for avatars. */
  allow: UploadKind[];
  maxBytes: number;
}

export interface ValidatedUpload {
  ext: string;
  mime: string;
  /** `<unix time>_<random>.<ext>`: never the client's name. */
  storedName: string;
}

/** Why a file was refused: stable, for a client that words its own message. */
export type UploadRejection = 'type_not_allowed' | 'empty' | 'too_large' | 'content_not_allowed';

/**
 * The shared upload guard (TW-AUTH-043). Extension allow-list plus a content
 * signature check, and a random stored name. Every endpoint that accepts a
 * file calls this; avatars are the first caller.
 *
 * A refusal is `AUTH_UPLOAD_REJECTED` (422) whose `errors` carry the reason
 * (and, for `too_large`, `limitBytes`) next to the English message.
 */
@Injectable()
export class UploadPolicyService {
  validate(input: UploadCheck): ValidatedUpload {
    const reject = (
      message: string,
      reason: UploadRejection,
      extra: AppErrorDetail[] = [],
    ): never => {
      throw new AppError(
        ERROR_CODES.AUTH_UPLOAD_REJECTED,
        message,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'file', message: reason }, ...extra],
      );
    };

    // The extension is what follows the LAST dot, trimmed: "photo.png " and "a.png." are not png,
    // and a name with no extension at all is just as unacceptable as a forbidden one.
    const dot = input.filename.lastIndexOf('.');
    const ext =
      dot === -1
        ? ''
        : input.filename
            .slice(dot + 1)
            .trim()
            .toLowerCase();
    if (!ext || BLOCKED_EXTENSIONS.has(ext))
      return reject('This file type is not allowed.', 'type_not_allowed');
    const rule = EXTENSIONS[ext];
    if (!rule || !input.allow.includes(rule.kind)) {
      return reject('This file type is not allowed.', 'type_not_allowed');
    }
    if (input.buffer.length === 0) return reject('The uploaded file is empty.', 'empty');
    if (input.buffer.length > input.maxBytes) {
      return reject(
        `The file is too large (limit ${Math.round(input.maxBytes / 1024)} KB).`,
        'too_large',
        [{ path: 'limitBytes', message: String(input.maxBytes) }],
      );
    }
    if (!rule.sniff(input.buffer)) {
      return reject('This file content is not allowed.', 'content_not_allowed');
    }

    return {
      ext,
      mime: rule.mime,
      storedName: `${Math.floor(Date.now() / 1000)}_${randomBytes(12).toString('hex')}.${ext}`,
    };
  }
}

type AppErrorDetail = { path: string; message: string };
