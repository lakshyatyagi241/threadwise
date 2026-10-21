import {
  ATTACHMENT_MAX_BYTES,
  attachmentFrom,
  attachmentKindOf,
  attachmentProblem,
  fallbackName,
  guessMime,
} from './attachment';

const MIB = 1024 * 1024;

describe('attachmentKindOf', () => {
  it('sorts a type into the kinds the API knows', () => {
    expect(attachmentKindOf('image/jpeg')).toBe('image');
    expect(attachmentKindOf('VIDEO/MP4')).toBe('video');
    expect(attachmentKindOf('audio/mpeg')).toBe('audio');
    expect(attachmentKindOf('application/pdf')).toBe('document');
    expect(attachmentKindOf('application/octet-stream')).toBe('document');
  });
});

describe('guessMime', () => {
  it('reads the type from the ending of a name or address, ignoring a query', () => {
    expect(guessMime('IMG_1.JPG')).toBe('image/jpeg');
    expect(guessMime('file:///cache/clip.mov?x=1')).toBe('video/quicktime');
    expect(guessMime('report.pdf')).toBe('application/pdf');
  });
  it('falls back to a plain binary type', () => {
    expect(guessMime('notes')).toBe('application/octet-stream');
    expect(guessMime('archive.xyz')).toBe('application/octet-stream');
  });
});

describe('attachmentFrom', () => {
  it('keeps what the phone said', () => {
    expect(
      attachmentFrom({ uri: 'file:///a', name: 'a.pdf', mime: 'application/pdf', sizeBytes: 10 }),
    ).toEqual({
      uri: 'file:///a',
      name: 'a.pdf',
      mime: 'application/pdf',
      sizeBytes: 10,
      kind: 'document',
    });
  });

  it('names and types a camera photo the phone left unnamed', () => {
    expect(attachmentFrom({ uri: 'file:///cache/ph.jpeg', name: null, mime: null })).toEqual({
      uri: 'file:///cache/ph.jpeg',
      name: 'photo.jpg',
      mime: 'image/jpeg',
      sizeBytes: null,
      kind: 'image',
    });
  });

  it('names a video from its type', () => {
    expect(fallbackName('video', 'video/mp4')).toBe('video.mp4');
    expect(fallbackName('video', 'video/quicktime')).toBe('video.mov');
    expect(fallbackName('document', 'application/pdf')).toBe('file.pdf');
  });
});

describe('attachmentProblem', () => {
  const file = (kind: 'image' | 'video' | 'document', sizeBytes: number | null) =>
    attachmentFrom({
      uri: 'file:///x',
      name: 'x',
      mime: { image: 'image/png', video: 'video/mp4', document: 'application/pdf' }[kind],
      sizeBytes,
    });

  it('accepts a file within the limit of its kind, and one of unknown size', () => {
    expect(attachmentProblem(file('image', ATTACHMENT_MAX_BYTES.image))).toBeNull();
    expect(attachmentProblem(file('document', 50 * MIB))).toBeNull();
    expect(attachmentProblem(file('video', null))).toBeNull();
  });

  it('refuses a file over the limit of its kind: 5 MB picture, 16 MB video, 100 MB document', () => {
    expect(attachmentProblem(file('image', 5 * MIB + 1))).toBe('tooLarge');
    expect(attachmentProblem(file('video', 16 * MIB + 1))).toBe('tooLarge');
    expect(attachmentProblem(file('document', 100 * MIB + 1))).toBe('tooLarge');
  });

  it('refuses an empty file', () => {
    expect(attachmentProblem(file('document', 0))).toBe('empty');
  });
});

describe('names that read well', () => {
  it('gives no ending to a type that has no short ordinary one', () => {
    expect(fallbackName('document', 'application/octet-stream')).toBe('file');
    expect(
      fallbackName(
        'document',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('file');
    expect(fallbackName('audio', 'audio/mpeg')).toBe('audio.mp3');
  });

  it('gives a transcoded picture the ending of what it now is', () => {
    expect(
      attachmentFrom({ uri: 'file:///c/x', name: 'IMG_0042.HEIC', mime: 'image/jpeg' }).name,
    ).toBe('IMG_0042.jpg');
  });

  it('leaves a name alone when its ending already agrees, or says nothing known', () => {
    expect(attachmentFrom({ uri: 'file:///c/x', name: 'a.jpeg', mime: 'image/jpeg' }).name).toBe(
      'a.jpeg',
    );
    expect(attachmentFrom({ uri: 'file:///c/x', name: 'notes.txt', mime: 'text/plain' }).name).toBe(
      'notes.txt',
    );
  });
});
