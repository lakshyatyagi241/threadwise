import { expect, test } from '@playwright/test';
import { checkLayout, severityOf } from './layout-checks';

/**
 * Proves the layout checker (QA task 20) before it is trusted: pages built here with a known defect must be reported, and pages built
 * with a lookalike that is not a defect (a marquee, a scrolling table, a cookie banner) must not. Needs no server.
 */
const page = (body: string, css = '') =>
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{margin:0;font:16px sans-serif}${css}</style><main><h1>Fixture</h1>${body}</main>`;

async function kinds(pw: import('@playwright/test').Page, html: string, width = 360) {
  await pw.setViewportSize({ width, height: 700 });
  await pw.setContent(html);
  return (await checkLayout(pw, width)).map((d) => d.kind);
}

test.describe('defects it must find', () => {
  test('a wide block makes the page scroll sideways', async ({ page: pw }) => {
    expect(
      await kinds(pw, page('<div style="width:700px;height:20px;background:#ccc">wide</div>')),
    ).toContain('page-overflow-x');
  });
  test('a button placed beyond the screen edge, with scrolling switched off, is unreachable', async ({
    page: pw,
  }) => {
    const html = page(
      '<button style="position:absolute;left:500px;top:40px">Pay</button>',
      'html,body{overflow-x:hidden}',
    );
    expect(await kinds(pw, html)).toContain('control-unreachable');
  });
  test('a button cut by the right edge is reported', async ({ page: pw }) => {
    const html = page(
      '<button style="position:absolute;left:300px;top:40px;width:120px">Save</button>',
      'html,body{overflow-x:hidden}',
    );
    expect(await kinds(pw, html)).toContain('control-cut-by-edge');
  });
  test('a button under another block in the normal flow is covered', async ({ page: pw }) => {
    const html = page(
      '<button id="b" style="position:absolute;left:10px;top:60px;width:100px;height:40px">Go</button><div style="position:absolute;left:0;top:50px;width:200px;height:80px;background:red;z-index:5"></div>',
    );
    expect(await kinds(pw, html)).toContain('control-covered');
  });
  test('a broken image is reported', async ({ page: pw }) => {
    expect(
      await kinds(pw, page('<img src="/does-not-exist.png" width="40" height="40" alt="x">')),
    ).toContain('broken-image');
  });
  test('an empty page is an error screen', async ({ page: pw }) => {
    await pw.setViewportSize({ width: 360, height: 700 });
    await pw.setContent(
      '<!doctype html><meta name="viewport" content="width=device-width"><title>t</title>',
    );
    expect((await checkLayout(pw, 360)).map((d) => d.kind)).toContain('error-screen');
  });
  test("the app's own error screen is reported", async ({ page: pw }) => {
    await pw.setViewportSize({ width: 360, height: 700 });
    await pw.setContent(
      '<!doctype html><meta name="viewport" content="width=device-width"><title>t</title><main><h1>Something went wrong</h1><p>The page failed to load. It has been reported. Try again.</p></main>',
    );
    expect((await checkLayout(pw, 360)).map((d) => d.kind)).toContain('error-screen');
  });
  test('a phone page without a viewport meta tag is reported', async ({ page: pw }) => {
    await pw.setViewportSize({ width: 360, height: 700 });
    await pw.setContent('<!doctype html><title>t</title><main><h1>Hello world</h1></main>');
    expect((await checkLayout(pw, 360)).map((d) => d.kind)).toContain('no-viewport-meta');
  });
});

test.describe('lookalikes it must not report', () => {
  test('a marquee inside a clipping box', async ({ page: pw }) => {
    const html = page(
      '<div style="overflow:hidden;width:300px"><div style="white-space:nowrap;width:1200px">Welcome · Take a look around · Start free and invite your team</div></div>',
    );
    const found = await kinds(pw, html);
    expect(found).not.toContain('content-cut-off');
    expect(found).not.toContain('page-overflow-x');
  });
  test('a wide table inside its own horizontal scroller', async ({ page: pw }) => {
    const html = page(
      '<div style="overflow-x:auto;width:340px"><table style="width:900px"><tr><td><a href="#x">One</a></td><td>Two</td></tr></table></div>',
    );
    const found = await kinds(pw, html);
    expect(found).not.toContain('control-cut-by-edge');
    expect(found).not.toContain('control-unreachable');
    expect(found).not.toContain('page-overflow-x');
  });
  test('the contents of a closed details box are not on screen', async ({ page: pw }) => {
    const html = page(
      '<details style="margin-top:10px"><summary>New collection</summary><input aria-label="name" style="width:200px;height:40px"><button>Save</button></details><div style="margin-top:-10px;height:100px;background:#eee">No collections yet.</div>',
    );
    const found = await kinds(pw, html);
    expect(found).not.toContain('control-covered');
  });
  test('a closed drawer parked off screen', async ({ page: pw }) => {
    const html = page(
      '<nav style="position:fixed;left:-300px;top:0;width:280px;height:100%"><a href="#a">Menu</a><button>Close</button></nav><p>Body text here.</p>',
    );
    const found = await kinds(pw, html);
    expect(found).not.toContain('control-unreachable');
  });
  test('a cookie banner over the page is an overlay, not a layout bug', async ({ page: pw }) => {
    const html = page(
      '<button id="b" style="position:absolute;left:10px;top:600px;width:100px;height:40px">Buy</button><div style="position:fixed;left:0;bottom:0;width:100%;height:120px;background:#eee">Cookies <button>Accept</button></div>',
    );
    expect(await kinds(pw, html)).not.toContain('control-covered');
  });
  test('a row scrolled out of its own table box is not covered by the footer below it', async ({
    page: pw,
  }) => {
    const html = page(
      '<div style="height:120px;overflow:auto"><div style="height:60px">row</div><div style="height:60px">row</div><label><input type="checkbox" aria-label="pick"></label></div><div style="height:40px">Showing 1-3 of 3</div>',
    );
    expect(await kinds(pw, html)).not.toContain('control-covered');
  });
  test('a tidy page has no P0 or P1 defect at any of the six widths', async ({ page: pw }) => {
    for (const w of [360, 390, 768, 1024, 1440, 1920]) {
      await pw.setViewportSize({ width: w, height: 800 });
      await pw.setContent(
        page(
          '<p>Some text that wraps nicely on any width.</p><button>Save</button><a href="#a">Link</a><input aria-label="Name">',
        ),
      );
      const bad = (await checkLayout(pw, w)).filter((d) => ['P0', 'P1'].includes(severityOf(d)));
      expect(bad, `width ${w}`).toEqual([]);
    }
  });
});

test('severity: a control that cannot be reached is P0, sideways scroll is P1, small targets are P2', () => {
  expect(severityOf({ kind: 'control-unreachable' })).toBe('P0');
  expect(severityOf({ kind: 'error-screen' })).toBe('P0');
  expect(severityOf({ kind: 'page-overflow-x' })).toBe('P1');
  expect(severityOf({ kind: 'content-cut-off' })).toBe('P1');
  expect(severityOf({ kind: 'tiny-targets' })).toBe('P2');
});
