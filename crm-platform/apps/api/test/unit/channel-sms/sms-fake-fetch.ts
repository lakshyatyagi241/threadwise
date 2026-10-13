/** A scripted `fetch`: records every request and answers from a queue (or a default). Nothing leaves the machine. */
export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Answer = { status?: number; json?: unknown; text?: string } | Error;

export function fakeFetch(answers: Answer[] = [{ status: 200, json: {} }]) {
  const calls: Recorded[] = [];
  let i = 0;
  const fn = ((url: string | URL, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]).forEach(
      (v, k) => (h[k] = v),
    );
    const body =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : ((init?.body as string) ?? null);
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: h, body });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) return Promise.reject(a);
    const text = a.text ?? JSON.stringify(a.json ?? {});
    return Promise.resolve(new Response(text, { status: a.status ?? 200 }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

export const ENV = {
  SMS_TWILIO_API_BASE: 'https://api.twilio.test',
  SMS_TWILIO_LOOKUP_BASE: 'https://lookups.twilio.test',
  SMS_MSG91_API_BASE: 'https://control.msg91.test',
  SMS_SEND_TIMEOUT_MS: 5000,
  SMS_VERIFY_TIMEOUT_MS: 5000,
};
