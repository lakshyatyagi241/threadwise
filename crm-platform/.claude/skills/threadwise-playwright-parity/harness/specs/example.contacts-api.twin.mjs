// Worked example of an API-level twin spec (no browser pages): "create a contact" on Reference (Laravel XHR endpoint,
// multipart + CSRF) against our POST /v2/contacts. Use this shape for features that have no web screen yet.
//
// Rules of the road shown here:
//   - scenarios are `api: true`, the same `run` is used for both sides and branches on c.side only to translate
//     the LOGICAL values ({name, phone, email}) into each app's request and its response back into logical terms
//   - every observation is side-neutral: accepted, which logical fields were flagged, the class of the HTTP status,
//     what was stored (trimmed), the shape of the error body and of the id
//   - differences that are architecture rules (uuid ids, problem+json errors) are matched automatically by the
//     harness as `intended`; everything else is a defect until someone writes it down in `intended` with a reason
//   - every created row is deleted again through c.onCleanup, and ONLY rows that carry this run's tag (c.deleteOwned):
//     an API that de-duplicates may answer a create with an EXISTING row, which must never be deleted
import { statusClass } from '../lib/util.mjs';

export default (h) => {
  const digits = (s) => String(s ?? '').replace(/\D/g, '');
  const logicalOf = { first_name: 'name', mobile: 'phone', email: 'email' }; // Reference field -> logical
  const WD_MAX_NAME = 191; // read off Reference's own validation message, not from its source

  // Our API contract is E.164; the UI strips separators and adds the country code before sending. Do the same here so
  // the test exercises the API, not the formatting a form would have done. Anything that is not a number stays as typed.
  const asE164 = (p) => {
    const d = String(p).replace(/[\s().-]/g, '');
    if (/^\d{10}$/.test(d)) return `+91${d}`;
    if (/^\+?\d+$/.test(d)) return d.startsWith('+') ? d : `+${d}`;
    return p;
  };

  // --- translate one logical contact into each side's request, and each response back -----------------------------
  async function createThreadwise(c, v) {
    const r = await c.http('POST', '/contacts', {
      multipart: {
        title: 'Mr',
        first_name: v.name ?? '',
        mobile: v.phone ?? '',
        country_code: '+91',
        email: v.email ?? '',
      },
    });
    const b = typeof r.body === 'object' && r.body ? r.body : {};
    const ok = r.status >= 200 && r.status < 300 && b.ok === true;
    const id = b.contact?.id;
    if (ok && id != null) c.onCleanup(() => c.deleteOwned(`/contacts/${id}`, b.contact));
    return {
      status: r.status,
      accepted: ok,
      flagged: Object.keys(b.errors || {}).map((k) => logicalOf[k] || k),
      errorFormat: b.errors ? 'field-map' : null,
      idStyle: id == null ? null : typeof id === 'number' ? 'numeric' : 'other',
      stored: ok
        ? { name: b.contact.first_name, email: b.contact.email, phone: digits(b.contact.mobile) }
        : null,
    };
  }

  async function createOurs(c, v) {
    const body = {};
    if (v.name !== undefined) body.name = v.name;
    if (v.email) body.email = v.email;
    if (v.phone) body.phone = asE164(v.phone);
    const r = await c.http('POST', '/v2/contacts', { data: body });
    const b = typeof r.body === 'object' && r.body ? r.body : {};
    const ok = r.status === 201;
    if (ok && b.id) c.onCleanup(() => c.deleteOwned(`/v2/contacts/${b.id}`, b));
    return {
      status: r.status,
      accepted: ok,
      flagged: (b.errors || []).map((e) => e.path),
      errorFormat: b.type && b.code ? 'problem-json' : null,
      idStyle: !b.id ? null : /^[0-9a-f-]{36}$/.test(b.id) ? 'uuid' : 'other',
      stored: ok ? { name: b.name, email: b.email, phone: digits(b.phone) } : null,
    };
  }

  const create = (c, v) => (c.side === 'threadwise' ? createThreadwise(c, v) : createOurs(c, v));

  function record(c, r) {
    const o = c.obs;
    o.flag('accepted', r.accepted);
    o.enum('outcome', r.accepted ? 'saved' : r.status >= 500 ? 'crash' : 'rejected');
    o.set('status.create', statusClass(r.status));
    o.list('flaggedFields', r.flagged);
    if (r.idStyle) o.enum('idStyle', r.idStyle);
    if (r.errorFormat) o.enum('errorFormat', r.errorFormat);
    if (r.stored)
      o.set(
        'map.stored',
        Object.fromEntries(Object.entries(r.stored).map(([k, v]) => [k, String(v ?? '').trim()])),
      );
  }

  const valid = (c) => ({
    name: c.tag('api'),
    phone: '9' + c.digits(9),
    email: `${c.tag('m').toLowerCase()}@example.com`,
  });
  const mk = (id, title, mut, tags = []) => ({
    id: `contact-api.create.${id}`,
    title: `Create contact (API): ${title}`,
    api: true,
    needsUi: false,
    tags: ['api', 'edge', 'validation', ...tags],
    run: async (c) =>
      record(c, await create(c, { ...valid(c), ...(typeof mut === 'function' ? mut(c) : mut) })),
  });

  const cases = [
    mk('valid', 'valid input', {}, ['happy']),
    mk('name-empty', 'name empty', { name: '' }, ['required']),
    mk('name-spaces', 'name only spaces', { name: '    ' }, ['required']),
    mk('name-191', "name at Reference's limit (191)", () => ({ name: 'a'.repeat(WD_MAX_NAME) })),
    mk('name-192', "name one over Reference's limit", () => ({
      name: 'a'.repeat(WD_MAX_NAME + 1),
    })),
    mk('name-padded', 'name with surrounding spaces', { name: '  Pat Padded  ' }),
    mk('name-unicode', 'unicode name', { name: 'Zoë Müller 李雷 Ñandú' }),
    mk('name-emoji', '4-byte characters', { name: 'Party 🎉🚀' }),
    mk('name-html', 'markup in name', { name: '<b>bold</b> & <i>it</i>' }),
    mk('name-sql', 'quote and SQL in name', { name: "Robert'); DROP TABLE contacts;--" }),
    mk('name-newline', 'newline in name', { name: 'line one\nline two' }),
    mk('email-invalid', 'email without @', { email: 'not-an-email' }),
    mk('email-empty', 'email left out (phone present)', { email: '' }),
    mk('email-uppercase', 'uppercase email', (c) => ({
      email: `${c.tag('u').toUpperCase()}@EXAMPLE.COM`,
    })),
    mk('email-plus', 'plus-addressed email', (c) => ({
      email: `${c.tag('p').toLowerCase()}+x@example.com`,
    })),
    mk('email-spaces', 'email with a space', { email: 'pat example@example.com' }),
    mk('phone-empty', 'phone left out (email present)', { phone: '' }),
    mk('phone-letters', 'phone with letters', { phone: 'abcdefghij' }),
    mk('phone-short', 'phone too short', { phone: '12' }),
    mk('phone-long', 'phone too long', { phone: '9'.repeat(20) }),
    mk('phone-spaced', 'phone with a space', (c) => {
      const d = '9' + c.digits(9);
      return { phone: `${d.slice(0, 5)} ${d.slice(5)}` };
    }), // never a hard-coded number: it could be a seed row's
    mk('no-contact-info', 'name only, no email and no phone', { phone: '', email: '' }, [
      'required',
    ]),
    mk('everything-empty', 'nothing at all', { name: '', phone: '', email: '' }, ['required']),
  ];

  return {
    feature: 'adhoc:example-contacts-api',
    title: 'Create contact: API example',
    scenarios: [
      ...cases,
      {
        id: 'contact-api.create.duplicate-phone',
        title: 'Create contact (API): the same phone twice',
        api: true,
        needsUi: false,
        tags: ['api', 'edge', 'unique'],
        run: async (c) => {
          const v = valid(c);
          const first = await create(c, v);
          c.obs.flag('firstAccepted', first.accepted);
          record(
            c,
            await create(c, {
              ...v,
              name: c.tag('dup2'),
              email: `${c.tag('d').toLowerCase()}@example.com`,
            }),
          );
        },
      },
      {
        id: 'contact-api.create.unauthenticated',
        title: 'Create contact (API): no session / no token',
        api: true,
        needsUi: false,
        tags: ['api', 'auth', 'security'],
        run: async (c) => {
          const v = valid(c);
          const r =
            c.side === 'threadwise'
              ? await c.http('POST', '/contacts', {
                  anonymous: true,
                  multipart: {
                    title: 'Mr',
                    first_name: v.name,
                    mobile: v.phone,
                    country_code: '+91',
                  },
                })
              : await c.http('POST', '/v2/contacts', {
                  anonymous: true,
                  data: { name: v.name, email: v.email },
                });
          const denied =
            [401, 403, 419].includes(r.status) ||
            (r.status >= 300 && r.status < 400 && /login/i.test(r.location || ''));
          c.obs.enum('unauthenticated', denied ? 'denied' : 'accepted');
          c.obs.set('sec.unauthContentVisible', !denied);
        },
      },
      {
        id: 'contact-api.create.double-submit',
        title: 'Create contact (API): two identical requests at once',
        api: true,
        needsUi: false,
        tags: ['api', 'edge', 'idempotency'],
        run: async (c) => {
          const v = valid(c);
          const [a, b] = await Promise.all([create(c, v), create(c, v)]);
          c.obs.num('submitRequests', 2);
          c.obs.num('rowsCreated', [a, b].filter((x) => x.accepted).length);
        },
      },
    ],
  };
};
