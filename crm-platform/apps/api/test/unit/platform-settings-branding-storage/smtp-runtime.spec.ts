import { createServer, type Server } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MailError } from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  SmtpMailAdapter,
  type MailRuntime,
} from '../../../src/infra/providers/auth-registration-security/smtp-mail.adapter';

/** A tiny SMTP server that records the envelope and the AUTH line of every message it accepts. */
async function fakeSmtp(requireAuth = false) {
  const received: Array<{ from: string; to: string; auth: string | null; data: string }> = [];
  const server: Server = createServer((sock) => {
    let cur = { from: '', to: '', auth: null as string | null, data: '' };
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(cur);
            cur = { from: '', to: '', auth: null, data: '' };
            sock.write('250 queued\r\n');
          } else cur.data += line + '\n';
          continue;
        }
        if (/^EHLO/i.test(line)) sock.write(`250-fake\r\n250 AUTH PLAIN LOGIN\r\n`);
        else if (/^AUTH PLAIN/i.test(line)) {
          cur.auth = Buffer.from(line.slice(11), 'base64').toString().replace(/\0/g, '|');
          sock.write('235 ok\r\n');
        } else if (/^MAIL FROM/i.test(line)) {
          if (requireAuth && !cur.auth) sock.write('530 auth required\r\n');
          else {
            cur.from = /<([^>]*)>/.exec(line)![1]!;
            sock.write('250 ok\r\n');
          }
        } else if (/^RCPT TO/i.test(line)) {
          cur.to = /<([^>]*)>/.exec(line)![1]!;
          sock.write('250 ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          sock.write('354 go\r\n');
        } else if (/^QUIT/i.test(line)) sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, received, close: () => new Promise((r) => server.close(r)) };
}

const config = (env: Record<string, unknown>) =>
  new ConfigService(env as never) as unknown as ConstructorParameters<typeof SmtpMailAdapter>[0];
const message = { to: 'rcpt@x.test', subject: 'hi', text: 'hello' };

let closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

describe('SMTP adapter with saved settings (WD-SET-024)', () => {
  it('sends through the saved host, port, sender and credentials instead of .env', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    // .env points nowhere useful: only the saved settings can make this succeed.
    const adapter = new SmtpMailAdapter(
      config({ SMTP_HOST: '', SMTP_PORT: 1, SMTP_FROM: 'env@x.test', SMTP_SECURE: false }),
    );
    const runtime: MailRuntime = {
      mode: 'smtp',
      host: '127.0.0.1',
      port: smtp.port,
      ignoreTls: true,
      user: 'mailer',
      pass: 'pw',
      fromName: 'Acme "Chat"',
      fromAddress: 'noreply@acme.test',
    };
    adapter.setRuntimeResolver(async () => runtime);
    await adapter.send(message);
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0]).toMatchObject({
      from: 'noreply@acme.test',
      to: 'rcpt@x.test',
      auth: '|mailer|pw',
    });
    expect(smtp.received[0]!.data).toMatch(/^From: "?Acme Chat"? <noreply@acme\.test>/m);
  });

  it('a blank saved value leaves the .env value in charge', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    const adapter = new SmtpMailAdapter(
      config({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: smtp.port,
        SMTP_FROM: 'env@x.test',
        SMTP_SECURE: false,
      }),
    );
    adapter.setRuntimeResolver(async () => ({ mode: 'smtp', ignoreTls: true }));
    await adapter.send(message);
    expect(smtp.received[0]!.from).toBe('env@x.test');
  });

  it('picks up a change on the next message with no restart', async () => {
    const a = await fakeSmtp();
    const b = await fakeSmtp();
    closers.push(a.close, b.close);
    const adapter = new SmtpMailAdapter(
      config({ SMTP_HOST: '', SMTP_PORT: 1, SMTP_FROM: 'f@x.test' }),
    );
    let port = a.port;
    adapter.setRuntimeResolver(async () => ({
      mode: 'smtp',
      host: '127.0.0.1',
      port,
      ignoreTls: true,
    }));
    await adapter.send(message);
    port = b.port;
    await adapter.send(message);
    expect([a.received.length, b.received.length]).toEqual([1, 1]);
  });

  it('the log mailer does not send; an unsupported mailer fails loudly; no resolver result means .env', async () => {
    const adapter = new SmtpMailAdapter(
      config({ SMTP_HOST: '', SMTP_PORT: 1, SMTP_FROM: 'f@x.test' }),
    );
    adapter.setRuntimeResolver(async () => ({ mode: 'log' }));
    await expect(adapter.send(message)).resolves.toBeUndefined();
    adapter.setRuntimeResolver(async () => ({ mode: 'unsupported' }));
    await expect(adapter.send(message)).rejects.toMatchObject({ reason: 'not_configured' });
    adapter.setRuntimeResolver(async () => null);
    await expect(adapter.send(message)).rejects.toBeInstanceOf(MailError);
  });

  it('a resolver that throws falls back to .env rather than losing the message path', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    const adapter = new SmtpMailAdapter(
      config({ SMTP_HOST: '127.0.0.1', SMTP_PORT: smtp.port, SMTP_FROM: 'env@x.test' }),
    );
    adapter.setRuntimeResolver(async () => {
      throw new Error('store down');
    });
    await adapter.send(message);
    expect(smtp.received).toHaveLength(1);
  });

  it('a wrong host is reported as a closed reason, never the server text', async () => {
    const adapter = new SmtpMailAdapter(
      config({ SMTP_HOST: '', SMTP_PORT: 1, SMTP_FROM: 'f@x.test' }),
    );
    adapter.setRuntimeResolver(async () => ({ mode: 'smtp', host: '127.0.0.1', port: 1 }));
    const err = await adapter.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(['connection_refused', 'timeout', 'transport_error']).toContain(
      (err as MailError).reason,
    );
    expect((err as Error).message).toMatch(/^mail send failed: [a-z_]+$/);
  });
});

describe('privileged database access in the settings module', () => {
  const dirs = [
    resolve(__dirname, '../../../src/modules/platform-settings-branding-storage'),
    resolve(__dirname, '../../../src/infra/providers/platform-settings-branding-storage'),
  ];
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('never calls .privileged( or builds SQL from raw text: the only door is PlatformSettingsService', () => {
    for (const f of dirs.flatMap(files)) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\.privileged\(/);
      expect(src, f).not.toMatch(/sql\.raw\(/);
    }
  });
});
