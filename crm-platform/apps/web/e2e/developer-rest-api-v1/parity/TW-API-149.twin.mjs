// Twin spec: the public developer docs page (TW-API-149) on Reference and on our app.
// Public page: nothing is created, no session is needed (Reference login is never used by these scenarios).
// Locators for the Reference side match Reference's own markup (they only run against it); ours match our markup.
export default (h) => {
  const PATH = '/developers/docs';
  const EP = { threadwise: '.endpoint', ours: 'article[data-endpoint]' };
  const EP_TOGGLE = {
    threadwise: '.endpoint .head',
    ours: 'article[data-endpoint] button[aria-expanded]',
  };
  const FILTER = { threadwise: '#api-search', ours: { role: 'searchbox' } };
  const BASE = { threadwise: '#base-url', ours: 'code:has-text("/api/v1")' };

  const open = async (c) => {
    await c.goto(PATH, { ready: EP });
    await c
      .loc(EP)
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {});
  };
  // What the filter box narrows differs by design: Reference filters its sidebar index (the endpoint list stays), ours
  // filters the endpoint cards. Both are "the list of endpoints you can reach after typing".
  const ITEMS = { threadwise: '#api-nav a', ours: 'article[data-endpoint]' };
  const visibleEndpoints = (c) =>
    c.loc(ITEMS).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);

  const pub = (id, title, tags, run) => ({
    id: `docs.${id}`,
    title: `Docs page: ${title}`,
    tags: ['docs', ...tags],
    loggedIn: false,
    needsUi: true,
    run,
  });

  return {
    feature: 'TW-API-149',
    title: 'Public developer docs page (/developers/docs)',
    pages: [
      {
        id: 'docs',
        title: 'Developer docs',
        path: PATH,
        public: true,
        ready: { threadwise: '#api-reference', ours: 'main' },
        probes: h.ALL_PAGE_PROBES,
      },
    ],
    scenarios: [
      pub(
        'endpoints-rendered',
        'endpoints are listed (from the OpenAPI document)',
        ['happy'],
        async (c) => {
          await open(c);
          const n = await c.loc(EP).count();
          c.obs.flag('anyEndpoint', n > 0);
          c.obs.set('abs.endpointCount', n);
          c.obs.flag(
            'hasVerbBadges',
            (await c
              .loc({
                threadwise: '.endpoint .verb-badge',
                ours: 'article[data-endpoint] h3 button span',
              })
              .count()) > 0,
          );
          c.obs.info('endpointCount', n);
        },
      ),

      pub('expand-collapse', 'an endpoint opens and closes on click', ['ux'], async (c) => {
        await open(c);
        const first = c.loc(EP_TOGGLE).first();
        const body = c
          .loc({ threadwise: '.endpoint .body', ours: 'article[data-endpoint] [id$="-body"]' })
          .first();
        const shown = async () => await body.isVisible().catch(() => false);
        c.obs.flag('collapsedAtStart', !(await shown()));
        await c.click(first);
        await c.afterAction();
        c.obs.flag('opensOnClick', await shown());
        c.obs.flag(
          'showsCurlExample',
          /curl\s+-X/i.test((await body.innerText().catch(() => '')) || ''),
        );
        await c.click(first);
        await c.afterAction();
        c.obs.flag('closesOnSecondClick', !(await shown()));
        await c.shot('endpoint');
      }),

      pub(
        'expand-keyboard',
        'an endpoint opens from the keyboard',
        ['keyboard', 'a11y'],
        async (c) => {
          await open(c);
          const first = c.loc(EP_TOGGLE).first();
          await first.focus().catch(() => {});
          const focusable = await first
            .evaluate((e) => document.activeElement === e)
            .catch(() => false);
          c.obs.set('abs.endpointToggleFocusable', focusable);
          if (focusable) {
            await c.press('Enter');
            await c.afterAction();
          }
          const body = c
            .loc({ threadwise: '.endpoint .body', ours: 'article[data-endpoint] [id$="-body"]' })
            .first();
          c.obs.set('abs.endpointOpensWithKeyboard', await body.isVisible().catch(() => false));
        },
      ),

      pub('filter-hit', 'filter narrows the list and matches the path', ['search'], async (c) => {
        await open(c);
        const before = await visibleEndpoints(c);
        await c.fill(FILTER, 'contacts');
        await c.afterAction({ quiet: 300 });
        const after = await visibleEndpoints(c);
        c.obs.flag('narrows', after > 0 && after < before);
        const texts = await c
          .loc(ITEMS)
          .evaluateAll((els) =>
            els
              .filter((e) => e.offsetParent !== null)
              .map((e) => e.innerText.slice(0, 400).toLowerCase()),
          );
        c.obs.flag(
          'everyShownMentionsTerm',
          texts.length > 0 && texts.every((t) => t.includes('contact')),
        );
        // clear restores everything
        await c.fill(FILTER, '');
        await c.afterAction({ quiet: 300 });
        c.obs.flag('clearRestores', (await visibleEndpoints(c)) === before);
      }),

      pub('filter-case', 'filter is case-insensitive', ['search', 'edge'], async (c) => {
        await open(c);
        await c.fill(FILTER, 'contacts');
        await c.afterAction({ quiet: 300 });
        const a = await visibleEndpoints(c);
        await c.fill(FILTER, 'CONTACTS');
        await c.afterAction({ quiet: 300 });
        c.obs.flag('sameCount', (await visibleEndpoints(c)) === a);
      }),

      pub('filter-miss', 'filter with no match', ['search', 'edge'], async (c) => {
        await open(c);
        await c.fill(FILTER, 'zzqqxx-no-such-endpoint');
        await c.afterAction({ quiet: 300 });
        c.obs.num('visibleEndpoints', await visibleEndpoints(c));
        const body = (
          (await c.page
            .locator('body')
            .innerText()
            .catch(() => '')) || ''
        ).toLowerCase();
        c.obs.set(
          'abs.emptyStateWhenNothingMatches',
          /no (matching )?(endpoints?|results?)|nothing|no match/.test(body) ? 1 : 0,
        );
        await c.shot('miss');
      }),

      ...[
        ['script', '<script>window.__docsXss=1</script>'],
        ['img', '"><img src=x onerror=window.__docsXss=1>'],
        ['percent', '%'],
        ['regex', '.*[(\\'],
        ['quote', "'; DROP TABLE x;--"],
        ['long', 'a'.repeat(400)],
        ['unicode', '联系人 ñandú 🚀'],
        ['spaces', '     '],
      ].map(([k, v]) =>
        pub(`filter-edge-${k}`, `filter with ${k}`, ['search', 'edge', 'xss'], async (c) => {
          await open(c);
          await c.fill(FILTER, v);
          await c.afterAction({ quiet: 300 });
          c.obs.set('sec.xssExecuted', await c.page.evaluate(() => window.__docsXss === 1));
          c.obs.flag(
            'pageStillUsable',
            await c
              .loc(FILTER)
              .first()
              .isVisible()
              .catch(() => false),
          );
          c.obs.num('visibleEndpoints', await visibleEndpoints(c));
          await c.fill(FILTER, '');
          await c.afterAction({ quiet: 300 });
          c.obs.flag('recoversWhenCleared', (await visibleEndpoints(c)) > 0);
        }),
      ),

      pub(
        'keyboard-full-traversal',
        'every control is reachable with Tab (no cap)',
        ['keyboard', 'a11y'],
        async (c) => {
          await open(c);
          const total = await c.page.evaluate(
            () =>
              [
                ...document.querySelectorAll(
                  'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])',
                ),
              ].filter((e) => e.offsetParent !== null && !e.disabled).length,
          );
          await c.page.evaluate(
            () =>
              document.activeElement &&
              document.activeElement.blur &&
              document.activeElement.blur(),
          );
          const seen = new Set();
          let trap = false;
          for (let i = 0; i < total + 40; i++) {
            await c.page.keyboard.press('Tab');
            const id = await c.page.evaluate(() => {
              const e = document.activeElement;
              if (!e || e === document.body) return 'body';
              if (!e.__tabId) e.__tabId = Math.random().toString(36).slice(2);
              return e.__tabId;
            });
            if (seen.has(id) && id !== 'body') {
              trap = true;
              break;
            }
            seen.add(id);
          }
          c.obs.set('abs.tabReachRatio', Math.min(1, +(seen.size / Math.max(1, total)).toFixed(2)));
          c.obs.set('low.tabCycleBeforeEnd', trap && seen.size < total * 0.9 ? 1 : 0);
          c.obs.info('tabStops', { total, reached: seen.size });
        },
      ),

      pub('base-url-copy', 'base URL is shown and copies', ['copy'], async (c) => {
        await c.context
          .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: c.sideObj.origin() })
          .catch(() => {});
        await open(c);
        const shown = (
          (await c
            .loc(BASE)
            .first()
            .innerText()
            .catch(() => '')) || ''
        ).trim();
        c.obs.flag('baseUrlEndsApiV1', /\/api\/v1$/.test(shown));
        const copy = c.loc({
          threadwise: { css: '[data-copy$="/api/v1"]' },
          ours: { role: 'button', name: /copy the base url/i },
        });
        c.obs.flag('copyButtonPresent', (await copy.count()) > 0);
        await c.click(copy);
        await c.afterAction();
        const clip = await c.page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        c.obs.flag('clipboardEqualsShown', clip != null && clip.trim() === shown);
      }),

      pub(
        'auth-section',
        'authentication section explains the key header',
        ['content'],
        async (c) => {
          await open(c);
          const t =
            (await c.page
              .locator('body')
              .innerText()
              .catch(() => '')) || '';
          c.obs.flag('mentionsBearer', /Authorization:\s*Bearer/i.test(t));
          c.obs.flag('mentionsXApiKey', /X-Api-Key/i.test(t));
          c.obs.flag('mentionsWebhookEvents', /webhook/i.test(t));
          c.obs.flag(
            'linksToKeyConsole',
            (await c.page.locator('a[href$="/developers"], a[href*="/developers?"]').count()) > 0,
          );
        },
      ),

      pub(
        'internal-ids',
        'no internal ticket ids or raw tag names in the public text',
        ['content', 'quality'],
        async (c) => {
          await open(c);
          const t =
            (await c.page
              .locator('body')
              .innerText()
              .catch(() => '')) || '';
          c.obs.set('low.internalFeatureIdsShown', (t.match(/\bWD-[A-Z]+-\d{3}\b/g) || []).length);
          const heads = await c.page
            .locator('h2')
            .allInnerTexts()
            .catch(() => []);
          c.obs.set(
            'low.rawTagHeadings',
            heads.filter((x) => /^[a-z0-9]+-v\d\b/i.test(x.trim())).length,
          );
          c.obs.info('h2', heads.slice(0, 30));
        },
      ),

      pub('nav-links', 'group navigation lists the resource groups', ['nav'], async (c) => {
        await open(c);
        const nav = c.loc({ threadwise: '#api-nav a', ours: 'nav a[href^="#"], aside a[href^="#"]' });
        c.obs.set('abs.navLinks', await nav.count());
        if (await nav.count()) {
          const y0 = await c.page.evaluate(() => window.scrollY);
          await c.click(nav.nth(2));
          await c.afterAction();
          c.obs.flag(
            'navScrollsOrMoves',
            (await c.page.evaluate(() => window.scrollY)) !== y0 || /#/.test(c.page.url()),
          );
        }
      }),

      pub('mobile', 'no horizontal overflow on a phone', ['responsive'], async (c) => {
        const h2 = await c.openAlso({ viewport: { width: 390, height: 844 }, loggedIn: false });
        await h2.page.goto(c.url(PATH), { waitUntil: 'load' });
        await h2.page.waitForTimeout(1500);
        const ov = await h2.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        c.obs.set('low.overflowX.phone', Math.max(0, ov));
        c.obs.set(
          'abs.filterVisibleOnPhone',
          (await h2.page
            .locator(c.side === 'threadwise' ? '#api-search' : 'input[type=search], [role=searchbox]')
            .first()
            .isVisible()
            .catch(() => false))
            ? 1
            : 0,
        );
      }),

      pub('rtl', 'right-to-left layout does not overflow', ['i18n'], async (c) => {
        await open(c);
        await c.page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
        await c.page.waitForTimeout(400);
        const ov = await c.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        c.obs.set('low.overflowX.rtl', Math.max(0, ov));
      }),

      pub(
        'legacy-redirects',
        '/docs and /docs/api lead to the docs page',
        ['routing'],
        async (c) => {
          for (const p of ['/docs', '/docs/api']) {
            const r = await c.page.goto(c.url(p), { waitUntil: 'load' }).catch(() => null);
            c.obs.enum(`finalPath${p.replace(/\W/g, '_')}`, new URL(c.page.url()).pathname);
            c.obs.set(
              `status.legacy${p.replace(/\W/g, '_')}`,
              r && r.status() < 400 ? 'ok' : 'not-found',
            );
          }
        },
      ),

      pub(
        'requires-no-session',
        'docs page opens without any cookie or token',
        ['auth', 'security'],
        async (c) => {
          const r = await c.page.goto(c.url(PATH), { waitUntil: 'load' });
          c.obs.set('status.public', r && r.status() < 400 ? 'ok' : 'rejected');
          c.obs.enum(
            'stayedOnDocs',
            new URL(c.page.url()).pathname === PATH ? 'yes' : 'redirected',
          );
        },
      ),

      {
        id: 'docs.openapi-document',
        title: 'Docs page: the OpenAPI document behind it',
        api: false,
        loggedIn: false,
        needsUi: false,
        tags: ['docs', 'api', 'openapi'],
        run: async (c) => {
          const base = c.side === 'threadwise' ? c.sideObj.baseUrl : c.sideObj.apiBase;
          const res = await fetch(`${base.replace(/\/$/, '')}/docs/api.json`, {
            headers: { Accept: 'application/json' },
          });
          const text = await res.text();
          let j = null;
          try {
            j = JSON.parse(text);
          } catch {
            /* not json */
          }
          c.obs.set('status.openapi', res.status < 400 ? 'ok' : 'not-found');
          c.obs.flag('isJson', j != null);
          c.obs.flag('openapi3', /^3\./.test(j?.openapi || ''));
          const paths = Object.keys(j?.paths || {});
          const norm = (p) => p.replace(/^\/api\/v1/, '');
          const set = new Set(paths.map(norm));
          c.obs.set('abs.pathCount', paths.length);
          for (const need of [
            '/me',
            '/usage',
            '/contacts',
            '/contacts/{id}',
            '/contact-groups',
            '/deals',
            '/deals/{id}',
            '/messages',
            '/templates',
          ])
            c.obs.flag(`path${need.replace(/\W/g, '_')}`, set.has(need));
          c.obs.flag(
            'securityIsHttpBearer',
            JSON.stringify(j?.components?.securitySchemes || {})
              .toLowerCase()
              .includes('bearer'),
          );
          c.obs.info('servers', j?.servers);
          c.obs.info('pathCount', paths.length);
        },
      },
    ],
    intended: [
      {
        scenario: /^docs\.(endpoints-rendered|nav-links|openapi-document)$/,
        key: /^abs\.(endpointCount|navLinks|pathCount)$/,
        reason:
          'auto-replies and webhooks endpoints (8 operations) are not built: they are blocked on the auto-reply-keywords and integrations domains (docs/api section 7); accepted by the coordinator',
      },
      {
        scenario: 'docs.keyboard',
        key: 'abs.keyboard.reachable',
        reason:
          'the generic keyboard probe stops after 65 Tab stops and our page has 114 controls (one toggle per endpoint); the scenario docs.keyboard-full-traversal tabs through all of them without a cap and reaches every control on both sides',
      },
      {
        scenario: 'docs.filter-edge-spaces',
        key: 'num.visibleEndpoints',
        quirk: 'Reference filter treats spaces as search text',
        reason:
          'Reference hides every entry when the filter holds only spaces; ours trims the text and shows the full list again, which is the deliberate, friendlier behaviour',
      },
      {
        scenario: 'docs.responsive',
        key: /^low\.clippedText\./,
        reason:
          'the one clipped element on our page is the visually hidden (sr-only) "Endpoints" heading for screen readers, which the probe counts as clipped text; it is not visible text',
      },
    ],
  };
};
