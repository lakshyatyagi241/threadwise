/** Loader for Meta's JavaScript SDK (`connect.facebook.net`, hard-coded as in Reference); shared by every feature that opens a Meta login popup. */

export interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

export interface FbLoginOptions {
  config_id: string;
  response_type: 'code';
  override_default_response_type: true;
  extras?: Record<string, unknown>;
}

export interface FbSdk {
  init(opts: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  /** Must be called synchronously inside the click, or mobile browsers block the popup. */
  login(cb: (res: FbLoginResponse) => void, opts: FbLoginOptions): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
let loading: Promise<FbSdk> | null = null;
let initedWith: string | null = null;

/** Loads the SDK once and runs `FB.init` for this app and version (idempotent), so `FB.login` can run in the click. */
export function loadFacebookSdk(appId: string, version: string): Promise<FbSdk> {
  const key = `${appId}@${version}`;
  loading ??= new Promise<FbSdk>((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    const done = () => (window.FB ? resolve(window.FB) : reject(new Error('Facebook SDK missing')));
    if (window.FB) return done();
    window.fbAsyncInit = done;
    const el = document.createElement('script');
    el.src = SDK_URL;
    el.async = true;
    el.defer = true;
    el.crossOrigin = 'anonymous';
    el.onerror = () => {
      loading = null;
      reject(new Error('Facebook SDK failed to load'));
    };
    document.body.appendChild(el);
  });
  return loading.then((fb) => {
    if (initedWith !== key) {
      fb.init({ appId, cookie: true, xfbml: true, version });
      initedWith = key;
    }
    return fb;
  });
}
