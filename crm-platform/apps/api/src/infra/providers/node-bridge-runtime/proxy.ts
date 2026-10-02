import { request } from 'node:https';
import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ProxySettings } from './socket.port';

/** WaDesk's probe. A self-hosted echo endpoint can replace it (inventory port note): the response must be `{"ip": "..."}`. */
export const DEFAULT_ECHO_URL = 'https://api.ipify.org?format=json';
const PROBE_TIMEOUT_MS = 15_000;

export function proxyUrl(p: ProxySettings): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type === 'socks5' ? 'socks5' : 'http'}://${auth}${p.host}:${p.port}`;
}

/** The agent that sends a device's WhatsApp traffic through its proxy (WD-NODE-013 rule 2). */
export function buildProxyAgent(p: ProxySettings): Agent {
  return (p.type === 'socks5'
    ? new SocksProxyAgent(proxyUrl(p))
    : new HttpsProxyAgent(proxyUrl(p))) as unknown as Agent;
}

export interface ProxyProbe {
  ok: boolean;
  /** The address the world sees for this proxy, when it answered. */
  egressIp?: string;
  error?: string;
}

/**
 * Proves the proxy works and learns where traffic will leave from, by asking an echo endpoint THROUGH the proxy. A proxy that
 * cannot be reached must stop the connection (fail-closed): linking a number through the server's own address would
 * defeat the point of isolating it.
 */
export function probeProxy(
  agent: Agent,
  echoUrl: string = DEFAULT_ECHO_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProxyProbe> {
  return new Promise((resolve) => {
    const req = request(echoUrl, { agent, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString('utf8')));
      res.on('end', () => {
        try {
          const ip = String((JSON.parse(body) as { ip?: unknown }).ip ?? '');
          resolve(
            ip
              ? { ok: true, egressIp: ip }
              : { ok: false, error: 'The echo endpoint did not return an address.' },
          );
        } catch {
          resolve({ ok: false, error: 'The echo endpoint returned something unreadable.' });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Proxy probe timed out.')));
    req.on('error', (e) => resolve({ ok: false, error: e.message.slice(0, 255) }));
    req.end();
  });
}
