import { connect } from 'node:net';

/**
 * Antivirus hook for every upload (SEC-UPLOAD-4). Off by default.
 * UPLOAD_SCAN_MODE=off|clamd, UPLOAD_SCAN_CLAMD_HOST (127.0.0.1), UPLOAD_SCAN_CLAMD_PORT (3310), UPLOAD_SCAN_TIMEOUT_MS (5000),
 * UPLOAD_SCAN_FAIL_CLOSED=true refuses the upload when the scanner cannot answer (default: let it through and log nothing).
 */
export type ScanVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; message: string };
export interface UploadScanner {
  scan(buffer: Buffer): Promise<ScanVerdict>;
}

/** clamd INSTREAM: `zINSTREAM\0`, then length-prefixed chunks, then a zero length; the reply is `stream: OK` or `stream: <name> FOUND`. */
export class ClamdScanner implements UploadScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  scan(buffer: Buffer): Promise<ScanVerdict> {
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      const sock = connect({ host: this.host, port: this.port });
      const finish = (v: ScanVerdict) => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve(v);
      };
      sock.setTimeout(this.timeoutMs, () =>
        finish({ status: 'error', message: 'clamd timed out' }),
      );
      sock.on('error', (e) => finish({ status: 'error', message: e.message }));
      sock.on('data', (d) => (out += d.toString('latin1')));
      sock.on('close', () => {
        const r = out.replace(/\0/g, '').trim();
        const m = /^stream:\s*(.+)\s+FOUND$/.exec(r);
        if (m) finish({ status: 'infected', signature: m[1]! });
        else if (/^stream:\s*OK$/.test(r)) finish({ status: 'clean' });
        else finish({ status: 'error', message: `unexpected clamd reply: ${r.slice(0, 80)}` });
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < buffer.length; i += 65536) {
          const c = buffer.subarray(i, i + 65536);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(c.length);
          sock.write(len);
          sock.write(c);
        }
        sock.write(Buffer.alloc(4));
      });
    });
  }
}

export function scannerFromEnv(env: NodeJS.ProcessEnv = process.env): {
  scanner: UploadScanner | null;
  failClosed: boolean;
} {
  const failClosed = /^(1|true|yes)$/i.test(env.UPLOAD_SCAN_FAIL_CLOSED ?? '');
  if ((env.UPLOAD_SCAN_MODE ?? 'off').toLowerCase() !== 'clamd')
    return { scanner: null, failClosed };
  return {
    scanner: new ClamdScanner(
      env.UPLOAD_SCAN_CLAMD_HOST || '127.0.0.1',
      Number(env.UPLOAD_SCAN_CLAMD_PORT) || 3310,
      Number(env.UPLOAD_SCAN_TIMEOUT_MS) || 5000,
    ),
    failClosed,
  };
}
