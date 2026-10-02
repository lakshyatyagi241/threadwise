/**
 * Razorpay Standard Checkout, run in the browser from the parameters the API returned (TW-PAYGW-015). The script is Razorpay's own
 * and loads only when a Razorpay order is being paid. The signed result is POSTed to the API's return URL (which verifies it);
 * dismissing the modal is a decline, reported as `cancelled=1`, not a fault.
 */
const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
  open: () => void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

function loadScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('razorpay_missing')));
    el.onerror = () => reject(new Error('razorpay_script_blocked'));
    document.head.appendChild(el);
  });
}

function postForm(url: string, fields: Record<string, string>): void {
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

export const cancelledUrl = (returnUrl: string): string =>
  `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}cancelled=1`;

export async function openRazorpay(options: Record<string, unknown>, returnUrl: string): Promise<void> {
  const Razorpay = await loadScript();
  new Razorpay({
    ...options,
    handler: (r: Record<string, string>) =>
      postForm(returnUrl, {
        razorpay_payment_id: r.razorpay_payment_id ?? '',
        razorpay_order_id: r.razorpay_order_id ?? '',
        razorpay_signature: r.razorpay_signature ?? '',
      }),
    modal: { ondismiss: () => window.location.assign(cancelledUrl(returnUrl)) },
  }).open();
}
