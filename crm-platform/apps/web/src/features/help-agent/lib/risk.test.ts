// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyClick,
  classifySelect,
  isNeutralLabel,
  isSensitiveField,
  normalizeLabel,
  riskOfLabel,
  type RiskReason,
} from './risk';

const ORIGIN = 'https://app.example.test';

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}
const first = (selector: string): Element => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element ${selector}`);
  return el;
};
const verdict = (html: string, selector = 'button, a, [role]') => {
  page(html);
  return classifyClick(first(selector), ORIGIN);
};

beforeEach(() => {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/[^\w-]/g, '\\$&'),
    };
  }
});

describe('help agent risk: what a label says', () => {
  const asks: Array<[string, RiskReason]> = [
    ['Delete contact', 'delete'],
    ['Remove', 'delete'],
    ['Disconnect WhatsApp', 'connect'],
    ['Cancel subscription', 'delete'],
    ['Reset password', 'delete'],
    ['Send message', 'send'],
    ['Send broadcast', 'send'],
    ['Publish', 'send'],
    ['Start campaign', 'send'],
    ['Schedule', 'send'],
    ['Pay now', 'pay'],
    ['Upgrade plan', 'pay'],
    ['Top up wallet', 'pay'],
    ['Buy credits', 'pay'],
    ['Invite teammate', 'invite'],
    ['Add member', 'invite'],
    ['Connect channel', 'connect'],
    ['Install', 'connect'],
    ['Change role', 'access'],
    ['Regenerate API key', 'access'],
    ['Save permissions', 'access'],
    ['Transfer ownership', 'access'],
    ['Save changes', 'submit'],
    ['Submit', 'submit'],
    ['Confirm', 'submit'],
    ['Export contacts', 'submit'],
    ['Import', 'submit'],
    ['Accept', 'submit'],
    ['Enable', 'settings'],
    ['Turn off notifications', 'settings'],
    ['Pause', 'settings'],
    ['Log out', 'signout'],
    ['Sign out', 'signout'],
  ];
  it.each(asks)('asks about "%s" (%s)', (label, reason) => {
    expect(riskOfLabel(label)).toBe(reason);
  });

  const asksArabic: Array<[string, RiskReason]> = [
    ['حذف جهة الاتصال', 'delete'],
    ['احذف', 'delete'],
    ['إزالة', 'delete'],
    ['إلغاء الاشتراك', 'delete'],
    ['إرسال', 'send'],
    ['ارسل الرسالة', 'send'],
    ['نشر', 'send'],
    ['بدء الحملة', 'send'],
    ['دفع', 'pay'],
    ['ترقية الباقة', 'pay'],
    ['شحن الرصيد', 'pay'],
    ['دعوة عضو', 'invite'],
    ['ربط القناة', 'connect'],
    ['فصل', 'connect'],
    ['تغيير الدور', 'access'],
    ['تغيير كلمة المرور', 'access'],
    ['حفظ التغييرات', 'submit'],
    ['الحفظ', 'submit'],
    ['تأكيد', 'submit'],
    ['تصدير', 'submit'],
    ['تفعيل', 'settings'],
    ['إيقاف', 'settings'],
    ['تسجيل الخروج', 'signout'],
  ];
  it.each(asksArabic)('asks about the Arabic "%s" (%s)', (label, reason) => {
    expect(riskOfLabel(label)).toBe(reason);
  });

  const benign = [
    'Contacts',
    'Next',
    'Cancel',
    'Close',
    'Back',
    'Search',
    'Filter',
    'Open settings',
    'Show more',
    'Edit',
    'View details',
    'Billing', // a menu word, not an act
    'Roles',
    'Security',
    'Postal code',
    'Template name',
    'Home',
    'الرئيسية',
    'جهات الاتصال',
    'بحث',
    'إلغاء',
    'رجوع',
    'المدفوعات', // "payments" as a tab name must not read as "pay"
    'البريد',
    'الإعدادات',
  ];
  it.each(benign)('does not ask about "%s"', (label) => {
    expect(riskOfLabel(label)).toBeNull();
  });

  it('normalizes Arabic diacritics, alef forms and spacing', () => {
    expect(normalizeLabel('  أَرْسِلْ   ')).toBe('ارسل');
    expect(normalizeLabel('إلغاء')).toBe('الغاء');
    expect(isNeutralLabel(normalizeLabel('إلغاء'))).toBe(true);
    expect(isNeutralLabel('cancel')).toBe(true);
    expect(isNeutralLabel('save')).toBe(false);
  });
});

describe('help agent risk: clicks on real elements', () => {
  it('asks before a submit button, in English and Arabic', () => {
    expect(
      verdict('<form><input name="a"><input name="b"><button type="submit">Go</button></form>'),
    ).toMatchObject({
      level: 'confirm',
      reason: 'submit',
    });
    expect(
      verdict('<form><input name="a"><input name="b"><button>تابع</button></form>'),
    ).toMatchObject({
      level: 'confirm',
      reason: 'submit',
    });
    expect(
      verdict(
        '<form><input name="a"><input name="b"><input type="submit" value="OK"></form>',
        'input[type=submit]',
      ),
    ).toMatchObject({
      level: 'confirm',
    });
  });

  it('a button with no type inside a form submits, one with type=button does not', () => {
    expect(verdict('<form><input name="a"><button>Do it</button></form>').level).toBe('confirm');
    expect(verdict('<form><input name="a"><button type="button">Do it</button></form>').level).toBe(
      'safe',
    );
  });

  it('lets a search form and a cancel button through', () => {
    expect(
      verdict('<form role="search"><input type="search"><button type="submit">Find</button></form>')
        .level,
    ).toBe('safe');
    expect(verdict('<form><input type="search"><button>Go</button></form>').level).toBe('safe');
    expect(
      verdict('<form><input name="a"><input name="b"><button type="submit">Cancel</button></form>')
        .level,
    ).toBe('safe');
  });

  it('asks about a button marked data-agent-risk, or inside a marked block', () => {
    expect(verdict('<button data-agent-risk="high">Continue</button>')).toMatchObject({
      level: 'confirm',
      reason: 'marked',
    });
    expect(
      verdict('<div data-agent-risk="high"><span><button>Anything</button></span></div>', 'button')
        .reason,
    ).toBe('marked');
  });

  it('asks about everything but a dismissal in a confirmation dialog', () => {
    const html = (label: string) => `<div role="alertdialog"><button>${label}</button></div>`;
    expect(verdict(html('Yes, do it'), 'button')).toMatchObject({ level: 'confirm' });
    expect(verdict(html('OK'), 'button').level).toBe('confirm');
    expect(verdict(html('Cancel'), 'button').level).toBe('safe');
    expect(verdict(html('إلغاء'), 'button').level).toBe('safe');
  });

  it('asks about the primary button of a modal even when the form sits outside its footer', () => {
    expect(verdict('<div role="dialog"><button>Apply</button></div>', 'button').level).toBe(
      'confirm',
    );
    expect(verdict('<div role="dialog"><button>Close</button></div>', 'button').level).toBe('safe');
    expect(verdict('<div role="dialog"><a href="/help">Help</a></div>', 'a').level).toBe('safe');
  });

  it('asks about switches, which take effect at once', () => {
    expect(
      verdict(
        '<button role="switch" aria-checked="false" aria-label="Notifications">x</button>',
        '[role=switch]',
      ),
    ).toMatchObject({
      level: 'confirm',
      reason: 'toggle',
    });
  });

  it('uses the label of the clickable ancestor when the click lands on its child', () => {
    page('<button><svg><path id="icon"/></svg><span id="t">Delete contact</span></button>');
    expect(classifyClick(first('#t'), ORIGIN)).toMatchObject({
      level: 'confirm',
      reason: 'delete',
    });
  });

  it('reads aria-label for an icon-only button', () => {
    expect(verdict('<button aria-label="Delete" type="button"></button>')).toMatchObject({
      level: 'confirm',
      reason: 'delete',
    });
  });

  it('lets a plain button and a tab through', () => {
    expect(verdict('<button type="button">Open filters</button>').level).toBe('safe');
    expect(
      verdict('<div role="tablist"><button role="tab">Billing</button></div>', '[role=tab]').level,
    ).toBe('safe');
    expect(verdict('<button type="button">اظهار المزيد</button>').level).toBe('safe');
  });
});

describe('help agent risk: links', () => {
  it('lets a link inside the app through', () => {
    expect(verdict('<a href="/settings/channels">Channels</a>', 'a')).toEqual({
      level: 'safe',
      label: 'Channels',
    });
    expect(verdict(`<a href="${ORIGIN}/contacts?x=1">Contacts</a>`, 'a').level).toBe('safe');
    expect(verdict('<a href="#top">Top</a>', 'a').level).toBe('safe');
  });

  it('does not ask about a link NAMED after a risky act: it only navigates', () => {
    expect(verdict('<a href="/billing/pay">Pay now</a>', 'a').level).toBe('safe');
    expect(verdict('<a href="/settings/team">Invite teammate</a>', 'a').level).toBe('safe');
  });

  it('still asks about signing out, which is a link', () => {
    expect(verdict('<a href="/api/auth/logout">Sign out</a>', 'a').level).not.toBe('safe');
  });

  it('refuses another website, in every spelling', () => {
    for (const href of [
      'https://evil.example/x',
      '//evil.example/x',
      'http://app.example.test.evil.com/x',
      'https://app.example.test:8443/x',
    ]) {
      expect(verdict(`<a href="${href}">Go</a>`, 'a'), href).toMatchObject({
        level: 'blocked',
        reason: 'external',
      });
    }
  });

  it('refuses the operator screens, the API and the sign-in routes', () => {
    for (const href of [
      '/admin',
      '/admin/plans',
      '/platform/x',
      '/api/v2/contacts',
      '/login',
      '/logout',
      '/impersonate/x',
    ]) {
      expect(verdict(`<a href="${href}">Go</a>`, 'a'), href).toMatchObject({
        level: 'blocked',
        reason: 'blocked_route',
      });
    }
  });

  it('refuses the screens where customer text lives', () => {
    for (const href of ['/inbox', '/inbox/123', '/team-chat', '/support/9']) {
      expect(verdict(`<a href="${href}">Go</a>`, 'a'), href).toMatchObject({
        level: 'blocked',
        reason: 'blocked_route',
      });
    }
  });

  it('refuses scripts, data urls, mail and phone links, new tabs and downloads', () => {
    expect(verdict('<a href="javascript:alert(1)">x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'bad_scheme',
    });
    expect(verdict('<a href="data:text/html,hi">x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'bad_scheme',
    });
    expect(verdict('<a href="mailto:a@b.c">x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'bad_scheme',
    });
    expect(verdict('<a href="tel:+100">x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'bad_scheme',
    });
    expect(verdict('<a href="/contacts" target="_blank">x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'new_tab',
    });
    expect(verdict('<a href="/files/x.csv" download>x</a>', 'a')).toMatchObject({
      level: 'blocked',
      reason: 'download',
    });
  });

  it('treats a link that is really a button (no href, or role=button) as a button', () => {
    expect(verdict('<a role="button" onclick="x()">Delete</a>', 'a').level).toBe('confirm');
    expect(verdict('<a href="#" role="button">Send</a>', 'a').level).toBe('confirm');
  });
});

describe('help agent risk: typing and choosing', () => {
  it('never types into a secret field', () => {
    const secret = (html: string) => {
      page(html);
      return isSensitiveField(first('input'));
    };
    expect(secret('<input type="password">')).toBe(true);
    expect(secret('<input name="card_number">')).toBe(true);
    expect(secret('<input autocomplete="cc-number">')).toBe(true);
    expect(secret('<input autocomplete="one-time-code">')).toBe(true);
    expect(secret('<input placeholder="Enter OTP">')).toBe(true);
    expect(secret('<input name="api_key">')).toBe(true);
    expect(secret('<label for="x">Webhook secret</label><input id="x">')).toBe(true);
    expect(secret('<input aria-label="كلمة المرور">')).toBe(true);
    expect(secret('<input name="phone">')).toBe(false);
    expect(secret('<input name="template_name" placeholder="Template name">')).toBe(false);
  });

  it('asks about a dropdown that changes a role, a plan or a status', () => {
    const select = (html: string) => {
      page(html);
      return classifySelect(first('select'));
    };
    expect(
      select('<label for="r">Role</label><select id="r"><option>Agent</option></select>').level,
    ).toBe('confirm');
    expect(select('<select name="plan"><option>Pro</option></select>').level).toBe('confirm');
    expect(select('<select aria-label="Status"><option>Open</option></select>').level).toBe(
      'confirm',
    );
    expect(select('<select aria-label="Language"><option>English</option></select>').level).toBe(
      'safe',
    );
    expect(select('<select aria-label="Page size"><option>25</option></select>').level).toBe(
      'safe',
    );
  });
});
