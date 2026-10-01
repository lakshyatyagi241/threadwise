// Planted defects for the harness self-test (PARITY_AA=1 PARITY_MUTATE=<name>). In that mode "ours" is a second
// copy of WaDesk with one deliberate flaw installed in the browser context. The self-test passes only when the
// comparator reports that flaw (expect) while the unmutated A/A run reports nothing. This is how we know the
// engine can actually find a missing field, a broken validation, a console error... and not just print "same".
export const MUTANTS = {
  'accept-invalid': {
    describe: 'server accepts input WaDesk rejects (create returns 200 for everything)',
    only: 'contact-create\\.first_name\\.(max\\+1|spaces)$',
    expect: [/^(flag\.accepted|enum\.outcome)$/],
    install: async (context) => {
      await context.route('**/contacts', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const resp = await route.fetch();
        if (resp.status() >= 400)
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, message: 'ok' }),
          });
        return route.fulfill({ response: resp });
      });
    },
  },
  'drop-field': {
    describe: 'the Email field is missing from the form',
    only: 'contact-create\\.structure',
    expect: [/^flag\.field\.email\.present$/],
    install: async (context) => {
      await context.addInitScript(() => {
        const kill = () =>
          document
            .querySelectorAll('#addContactForm [name=email]')
            .forEach((e) => e.closest('div')?.remove());
        new MutationObserver(kill).observe(document, { childList: true, subtree: true });
      });
    },
  },
  'console-error': {
    describe: 'a console error on every page load',
    only: 'contacts-page\\.load',
    expect: [/^low\.consoleErrors$/],
    install: async (context) => {
      await context.addInitScript(() =>
        setTimeout(() => console.error('planted console error'), 150),
      );
    },
  },
  'page-error': {
    describe: 'an uncaught exception on every page load',
    only: 'contacts-page\\.load',
    expect: [/^low\.pageErrors$/],
    install: async (context) => {
      await context.addInitScript(() =>
        setTimeout(() => {
          throw new Error('planted uncaught error');
        }, 150),
      );
    },
  },
  'overflow-mobile': {
    describe: 'horizontal overflow at every viewport',
    only: 'contacts-page\\.responsive',
    expect: [/^low\.overflowX\./],
    install: async (context) => {
      await context.addInitScript(() =>
        document.addEventListener('DOMContentLoaded', () => {
          const d = document.createElement('div');
          d.style.cssText = 'width:6000px;height:1px;position:absolute;left:0;top:0';
          document.body.appendChild(d);
        }),
      );
    },
  },
  'slow-pages': {
    describe: 'every page request takes 3.5 s longer',
    only: 'contacts-page\\.perf',
    expect: [/^perf\./],
    install: async (context) => {
      await context.route('**/contacts*', async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        await new Promise((r) => setTimeout(r, 3500));
        return route.fallback();
      });
    },
  },
  'lose-values': {
    describe: 'the form wipes what the user typed after a rejected submit',
    only: 'contact-create\\.first_name\\.(max\\+1|spaces)$',
    expect: [/^flag\.valueKept$/],
    install: async (context) => {
      await context.addInitScript(() => {
        document.addEventListener(
          'submit',
          () =>
            setTimeout(
              () =>
                document
                  .querySelectorAll('#addContactForm input, #addContactForm textarea')
                  .forEach((i) => {
                    if (i.type !== 'hidden') i.value = '';
                  }),
              400,
            ),
          true,
        );
        window.addEventListener('load', () => {
          const orig = window.fetch;
          window.fetch = async (...a) => {
            const r = await orig(...a);
            if (r.status >= 400)
              setTimeout(
                () =>
                  document
                    .querySelectorAll('#addContactForm input, #addContactForm textarea')
                    .forEach((i) => {
                      if (i.type !== 'hidden') i.value = '';
                    }),
                200,
              );
            return r;
          };
        });
      });
    },
  },
};

export function mutationsFromEnv(env = process.env) {
  const names = (env.PARITY_MUTATE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((n) => {
    if (!MUTANTS[n])
      throw new Error(`unknown mutant "${n}" (known: ${Object.keys(MUTANTS).join(', ')})`);
    return MUTANTS[n];
  });
}
