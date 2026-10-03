/**
 * Browser-side widgets of the providers that need one (Paddle overlay, Cashfree checkout), run from the parameters the API
 * returned (WD-PAYGW-017, 022). Each provider's own script loads only while one of its orders is being paid. The paid result is
 * never trusted here: both widgets end by sending the buyer to our return URL, where the server asks the provider.
 */
const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';
const CASHFREE_SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function loadScript<T>(src: string, global: string): Promise<T> {
  const w = window as unknown as Record<string, T | undefined>;
  const have = w[global];
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => {
      const g = w[global];
      return g ? resolve(g) : reject(new Error(`${global}_missing`));
    };
    el.onerror = () => reject(new Error(`${global}_script_blocked`));
    document.head.appendChild(el);
  });
}

interface PaddleGlobal {
  Environment: { set: (env: string) => void };
  Initialize: (o: { token: string }) => void;
  Checkout: { open: (o: Record<string, unknown>) => void };
}

export async function openPaddle(p: Record<string, string | number | boolean>): Promise<void> {
  const Paddle = await loadScript<PaddleGlobal>(PADDLE_SCRIPT, 'Paddle');
  if (p.environment === 'sandbox') Paddle.Environment.set('sandbox');
  Paddle.Initialize({ token: String(p.clientToken) });
  Paddle.Checkout.open({
    transactionId: String(p.transactionId),
    settings: { displayMode: 'overlay', successUrl: String(p.returnUrl) },
  });
}

type CashfreeFactory = (o: { mode: string }) => {
  checkout: (o: { paymentSessionId: string; redirectTarget: string }) => Promise<unknown>;
};

export async function openCashfree(p: Record<string, string | number | boolean>): Promise<void> {
  const Cashfree = await loadScript<CashfreeFactory>(CASHFREE_SCRIPT, 'Cashfree');
  // Cashfree redirects to the return_url it was created with (our return URL plus the order id) when the buyer is done.
  await Cashfree({ mode: String(p.mode) }).checkout({
    paymentSessionId: String(p.sessionId),
    redirectTarget: '_self',
  });
}

/** PayU and friends: the browser POSTs plain fields to the provider's own page, built from data, never from server HTML. */
export function postForm(url: string, fields: Record<string, string>): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
