import { describe, expect, it } from 'vitest';
import { dayLabel } from '../../../src/modules/storefront-builder/overview/store-overview.service';
import {
  sanitizeProductBody,
  sanitizeShopCopy,
} from '../../../src/modules/storefront-builder/rules/html';
import {
  buildRecoveryMessage,
  recoveryDelayMinutes,
  recoveryShopUrl,
} from '../../../src/modules/storefront-builder/rules/recovery-message';
import {
  buildSettings,
  readSettings,
} from '../../../src/modules/storefront-builder/rules/settings';

describe('cart recovery message (WD-STORE-015)', () => {
  const base = {
    customText: null as string | null,
    customerName: 'Asha',
    shopName: 'Acme',
    shopUrl: 'https://app.example.com/s/acme',
    subtotalMinor: 129900,
    currencyCode: 'INR',
  };

  it('the default text greets by first name and links back to the shop', () => {
    expect(buildRecoveryMessage(base)).toBe(
      'Hi Asha! You left some items in your cart at Acme. Complete your order here: https://app.example.com/s/acme',
    );
  });

  it('no name reads "there"', () => {
    expect(buildRecoveryMessage({ ...base, customerName: '  ' })).toContain('Hi there!');
    expect(buildRecoveryMessage({ ...base, customerName: null })).toContain('Hi there!');
  });

  it('a custom message has {name} {shop} {url} {total} replaced', () => {
    expect(
      buildRecoveryMessage({ ...base, customText: 'Hi {name}, {total} waits at {shop}: {url}' }),
    ).toBe('Hi Asha, ₹ 1,299 waits at Acme: https://app.example.com/s/acme');
  });

  it('a value that looks like a token is not replaced a second time', () => {
    expect(
      buildRecoveryMessage({ ...base, customerName: '{shop}', customText: 'Hi {name} at {shop}' }),
    ).toBe('Hi {shop} at Acme');
  });

  it('the delay is at least 5 minutes and 30 when never set', () => {
    expect(recoveryDelayMinutes(3)).toBe(5);
    expect(recoveryDelayMinutes(0)).toBe(5);
    expect(recoveryDelayMinutes(15)).toBe(15);
    expect(recoveryDelayMinutes(undefined)).toBe(30);
    expect(recoveryDelayMinutes(null)).toBe(30);
  });

  it('the nudge links a verified custom domain, else the web app path (subdomain mode is ignored, as in WaDesk)', () => {
    const shop = { slug: 'acme', customDomain: 'shop.acme.com', customDomainVerified: true };
    expect(recoveryShopUrl(shop, 'https://app.example.com')).toBe('https://shop.acme.com');
    expect(
      recoveryShopUrl({ ...shop, customDomainVerified: false }, 'https://app.example.com'),
    ).toBe('https://app.example.com/s/acme');
  });
});

describe('storefront settings (WD-STORE-006)', () => {
  const input = {
    logoUrl: '',
    brandColor: '#12ab9F',
    heroText: 'Welcome',
    footerText: null,
    cartRecoveryEnabled: true,
    cartRecoveryDelayMin: 15,
    cartRecoveryMessage: '  Hi {name}  ',
  };

  it('blank text keys are removed, the recovery keys always written', () => {
    const out = buildSettings({ logo_url: 'https://x/logo.png', footer_text: 'old' }, input);
    expect(out).toEqual({
      brand_color: '#12ab9F',
      hero_text: 'Welcome',
      cart_recovery_enabled: true,
      cart_recovery_delay_min: 15,
      cart_recovery_message: 'Hi {name}',
    });
  });

  it('defaults: recovery off, 30 minutes, no message', () => {
    expect(buildSettings({}, { cartRecoveryEnabled: false })).toEqual({
      cart_recovery_enabled: false,
      cart_recovery_delay_min: 30,
      cart_recovery_message: null,
    });
  });

  it('keys the form does not own survive a save (top_strip and hero_sub were erased by WaDesk)', () => {
    const out = buildSettings({ top_strip: 'Free chats', hero_sub: 'Hand-picked' }, input);
    expect(out.top_strip).toBe('Free chats');
    expect(out.hero_sub).toBe('Hand-picked');
  });

  it('reads back to the wire shape; recovery counts only when exactly true', () => {
    expect(readSettings({ cart_recovery_enabled: 'yes', brand_color: '#fff000' })).toMatchObject({
      cartRecoveryEnabled: false,
      brandColor: '#fff000',
      cartRecoveryDelayMin: 30,
      logoUrl: null,
    });
    expect(
      readSettings({ cart_recovery_enabled: true, cart_recovery_delay_min: 45 })
        .cartRecoveryDelayMin,
    ).toBe(45);
  });
});

describe('hero and footer text (decision D-05)', () => {
  it('keeps b, i, em, strong, br, span and a[href]', () => {
    expect(sanitizeShopCopy('Hello <em>world</em><br><b>now</b> <span>x</span>')).toBe(
      'Hello <em>world</em><br /><b>now</b> <span>x</span>',
    );
    expect(sanitizeShopCopy('<a href="https://x.test/a">go</a>')).toContain(
      'href="https://x.test/a"',
    );
  });

  it('drops scripts, handlers, styles, other tags and javascript: links', () => {
    const out = sanitizeShopCopy(
      '<script>alert(1)</script><img src=x onerror=alert(1)><p style="color:red" onclick="x()">Hi</p><a href="javascript:alert(1)">bad</a>',
    );
    expect(out).not.toMatch(/script|onerror|onclick|style|javascript|<img|<p/i);
    expect(out).toContain('Hi');
  });

  it('empty and null are an empty string', () => {
    expect(sanitizeShopCopy(null)).toBe('');
    expect(sanitizeShopCopy('')).toBe('');
  });

  it('a product body loses a script tag (WD-STORE-010) and an empty one is null', () => {
    const out = sanitizeProductBody(
      '<p>Nice</p><script>alert(1)</script><iframe src="https://evil"></iframe>',
    )!;
    expect(out).toBe('<p>Nice</p>');
    expect(sanitizeProductBody('   ')).toBeNull();
    expect(sanitizeProductBody(null)).toBeNull();
  });
});

describe('dashboard labels (WD-STORE-001)', () => {
  it('a bucket is labelled "M d"', () => {
    expect(dayLabel('2026-10-02')).toBe('Oct 02');
    expect(dayLabel('2026-01-15')).toBe('Jan 15');
  });
});
