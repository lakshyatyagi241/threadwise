import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import {
  MAIL_PORT,
  MailError,
  type MailFailureReason,
  type MailPort,
} from '../../../infra/providers/auth-registration-security/mail.port';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Why a sign-in was worth an alert (TW-AUTH-018). */
export type LoginAlertReason = 'new-device' | 'new-country';

export interface LoginAlertInfo {
  when: Date;
  ip: string | null;
  browser: string;
  reasons: LoginAlertReason[];
  signedIn: boolean;
}

/** What happened to one outgoing mail; `reason` is a closed, secret-free vocabulary. */
export type DeliveryResult =
  { sent: true } | { sent: false; reason: MailFailureReason | 'unknown' };

const REASON_PROSE: Record<LoginAlertReason, string> = {
  'new-device': 'a new device',
  'new-country': 'a different location',
};

/**
 * The transactional mails of the auth domain. Wording is original; the layout
 * is deliberately plain so it renders in every client and survives being
 * forwarded to a support inbox.
 *
 * `send*` methods return whether the mail went out and never throw, because
 * every caller (forgot-password, resend, sign-up) must respond neutrally
 * whether or not delivery worked. Failures are logged with the reason.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly brand: string;
  private readonly webUrl: string;

  constructor(
    @Inject(MAIL_PORT) private readonly port: MailPort,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Link into the web app; the slug travels in the URL so the page needs no lookup. */
  link(path: string, params: Record<string, string>): string {
    return `${this.webUrl}${path}?${new URLSearchParams(params).toString()}`;
  }

  private layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
    const button = cta
      ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">${esc(cta.label)}</a></p>
         <p style="color:#64748b;font-size:13px">If the button does not work, paste this address into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>`
      : '';
    return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:32px;color:#0f172a">
        <div style="font-weight:700;color:#0f766e;margin-bottom:20px">${esc(this.brand)}</div>
        <h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
        ${bodyHtml}${button}
      </div></body></html>`;
  }

  private async deliverDetailed(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<DeliveryResult> {
    try {
      await this.port.send({ to, subject, text, html });
      return { sent: true };
    } catch (err) {
      const reason = err instanceof MailError ? err.reason : 'unknown';
      this.logger.warn({ reason, subject }, 'auth mail not delivered');
      return { sent: false, reason };
    }
  }

  private async deliver(to: string, subject: string, text: string, html: string): Promise<boolean> {
    return (await this.deliverDetailed(to, subject, text, html)).sent;
  }

  sendVerifyEmail(to: string, name: string, url: string): Promise<boolean> {
    return this.sendVerifyEmailDetailed(to, name, url).then((r) => r.sent);
  }

  /** Same mail, with the coarse failure reason, for the resend button (TW-AUTH-015). */
  sendVerifyEmailDetailed(to: string, name: string, url: string): Promise<DeliveryResult> {
    return this.deliverDetailed(
      to,
      `Verify your email for ${this.brand}`,
      `Hi ${name},\n\nConfirm this address to finish setting up your account:\n${url}\n\nThe link works once and expires in 60 minutes.`,
      this.layout(
        'Confirm your email address',
        `<p>Hi ${esc(name)}, confirm this address to finish setting up your account. The link works once and expires in 60 minutes.</p>`,
        { label: 'Confirm email', url },
      ),
    );
  }

  sendPasswordReset(to: string, name: string, url: string): Promise<boolean> {
    return this.deliver(
      to,
      `Reset your ${this.brand} password`,
      `Hi ${name},\n\nUse this link to choose a new password:\n${url}\n\nIt works once and expires in 60 minutes. If you did not ask for it, you can ignore this message.`,
      this.layout(
        'Choose a new password',
        `<p>Hi ${esc(name)}, use the button below to choose a new password. The link works once and expires in 60 minutes. If you did not ask for it, ignore this message; your password stays as it is.</p>`,
        { label: 'Reset password', url },
      ),
    );
  }

  /** A workspace member invitation (WSP): the link sets the first password; there is no temporary password to read out. */
  sendWorkspaceInvite(
    to: string,
    name: string,
    info: { inviter: string | null; workspace: string; role: string; url: string; days: number },
  ): Promise<boolean> {
    const who = info.inviter ?? 'An administrator';
    return this.deliver(
      to,
      `${who} invited you to ${info.workspace} on ${this.brand}`,
      `Hi ${name},\n\n${who} invited you to join ${info.workspace} as ${info.role}. Open this link to choose your password and sign in:\n${info.url}\n\nThe link works once and expires in ${info.days} days.`,
      this.layout(
        `Join ${info.workspace}`,
        `<p>Hi ${esc(name)}, ${esc(who)} invited you to join <strong>${esc(info.workspace)}</strong> as <strong>${esc(info.role)}</strong>. Choose a password to accept. The link works once and expires in ${info.days} days.</p>`,
        { label: 'Accept invitation', url: info.url },
      ),
    );
  }

  sendPasswordChanged(to: string, name: string, resetUrl: string): Promise<boolean> {
    return this.deliver(
      to,
      `Your ${this.brand} password was changed`,
      `Hi ${name},\n\nYour password was just changed and your other devices were signed out. If this was not you, reset it now:\n${resetUrl}`,
      this.layout(
        'Your password was changed',
        `<p>Hi ${esc(name)}, your password was just changed and your other devices were signed out. If this was not you, reset it right away.</p>`,
        { label: 'Reset password', url: resetUrl },
      ),
    );
  }

  /** Sent to the OLD address after a change, so a hijack is visible to the real owner. */
  sendEmailChangedNotice(
    to: string,
    name: string,
    newEmail: string,
    recoverUrl: string,
  ): Promise<boolean> {
    return this.deliver(
      to,
      `Your ${this.brand} sign-in email was changed`,
      `Hi ${name},\n\nThe sign-in email for your account was changed to ${newEmail}. If you did not do this, reset your password straight away:\n${recoverUrl}`,
      this.layout(
        'Your sign-in email was changed',
        `<p>Hi ${esc(name)}, the sign-in email for your account was changed to <strong>${esc(newEmail)}</strong>. If you did not do this, reset your password straight away.</p>`,
        { label: 'Secure my account', url: recoverUrl },
      ),
    );
  }

  sendEmailChange(to: string, name: string, url: string): Promise<boolean> {
    return this.deliver(
      to,
      `Confirm your new email for ${this.brand}`,
      `Hi ${name},\n\nConfirm this address to make it your sign-in email:\n${url}\n\nThe link works once and expires in 60 minutes.`,
      this.layout(
        'Confirm your new email address',
        `<p>Hi ${esc(name)}, confirm this address to make it your sign-in email. The link works once and expires in 60 minutes.</p>`,
        { label: 'Confirm new email', url },
      ),
    );
  }

  sendWorkspaceList(
    to: string,
    workspaces: Array<{ name: string; url: string }>,
  ): Promise<boolean> {
    const lines = workspaces.map((w) => `${w.name}: ${w.url}`).join('\n');
    const items = workspaces
      .map((w) => `<li><a href="${esc(w.url)}">${esc(w.name)}</a></li>`)
      .join('');
    return this.deliver(
      to,
      `Your ${this.brand} workspaces`,
      `These workspaces use this email address:\n\n${lines}`,
      this.layout(
        'Your workspaces',
        `<p>These workspaces use this email address:</p><ul>${items}</ul>`,
      ),
    );
  }

  /**
   * `actionUrl` is where the recipient goes if the sign-in was not theirs. The
   * subject depends on why we are writing: a lone new device is named as such,
   * anything involving the location is "from a new location" (Reference's split).
   */
  sendLoginAlert(
    to: string,
    name: string,
    info: LoginAlertInfo,
    actionUrl: string,
  ): Promise<boolean> {
    const reasons = info.reasons.map((r) => REASON_PROSE[r]).join(' and ');
    const onlyDevice = info.reasons.length === 1 && info.reasons[0] === 'new-device';
    const subject = onlyDevice
      ? `New sign-in on a new device for your ${this.brand} account`
      : `New sign-in from a new location on your ${this.brand} account`;
    const lines = [
      `Time (UTC): ${info.when.toISOString()}`,
      `IP address: ${info.ip ?? 'unknown'}`,
      `Browser: ${info.browser}`,
    ].join('\n');
    return this.deliver(
      to,
      subject,
      `Hi ${name},\n\nWe saw a sign-in from ${reasons}.\n\n${lines}\n\nIf this was you, nothing to do. If not, secure your account now: ${actionUrl}`,
      this.layout(
        'New sign-in to your account',
        `<p>Hi ${esc(name)}, we saw a sign-in from ${esc(reasons)}.</p>
         <pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:13px">${esc(lines)}</pre>
         <p>If this was you, there is nothing to do. If it was not, secure your account now.</p>`,
        { label: 'Secure my account', url: actionUrl },
      ),
    );
  }
}
