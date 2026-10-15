#!/usr/bin/env node
// A stand-in for the API, for browser runs of the pages that need no sign-in (QA task 19).
//
// The public pages of the web app call the API for very little: a visitor sees the language list in the switcher, and anything else is
// refused because nobody is signed in. This server answers exactly that, so the public route matrix and the cross-browser specs can run
// on a build server, or beside the web app alone, with no database, Redis or seed. It is NOT the API: every other path answers 401
// problem+json, the way the real one answers a visitor with no token, and the list below is the whole of what it knows.
//
//   node apps/web/e2e/_matrix/stub-api.mjs            listens on :3000 (STUB_API_PORT to change)
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_API_PORT ?? 3000);

const LANGUAGES = {
  data: [
    { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
    { code: 'he', name: 'Hebrew', nativeName: 'עברית', direction: 'rtl' },
    { code: 'ur', name: 'Urdu', nativeName: 'اردو', direction: 'rtl' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', direction: 'ltr' },
  ],
  defaultLocale: 'en',
};

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && (path === '/v2/i18n/languages' || path === '/v1/i18n/languages')) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(LANGUAGES));
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok","stub":true}');
    return;
  }
  req.resume();
  // A sign-in attempt with a password nobody has: the real answer, so the form shows its "wrong email or password" state.
  if (req.method === 'POST' && path === '/v2/auth/login') {
    res.writeHead(401, { 'content-type': 'application/problem+json' }).end(
      JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
      }),
    );
    return;
  }
  res.writeHead(401, { 'content-type': 'application/problem+json' }).end(
    JSON.stringify({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHENTICATED',
    }),
  );
});

server.listen(PORT, () =>
  console.log(`stub API on :${PORT} (public pages only; not the real API)`),
);
