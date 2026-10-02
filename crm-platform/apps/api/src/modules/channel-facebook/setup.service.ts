import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type MessengerSetup,
  type SaveGetStartedInput,
  type SaveGreetingInput,
  type SaveIceBreakersInput,
  type SaveMenuInput,
  type SetupResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphResult,
} from '../../infra/providers/channel-facebook/facebook.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { FACEBOOK_PLAN_GATE, type FacebookPlanGate } from './_shims/tokens';
import { TOKEN_INVALID_MESSAGE, clipError, isTokenError } from './page-rules';
import { MODULE_KEY } from './pages.service';
import { PagesRepository, type PageRow } from './pages.repository';
import {
  DEFAULT_GET_STARTED,
  GREETING_UNSUPPORTED_MESSAGE,
  buildIceBreakers,
  buildMenu,
  greetingText,
  greetingUnsupported,
  readProfile,
  rejectedMessage,
} from './setup-rules';

/** What a write to Meta came to. `unsupported` means the Graph version no longer has the field, not that this change was refused. */
interface Outcome extends GraphResult {
  unsupported?: boolean;
}

const unavailable = () =>
  new AppError(
    ERROR_CODES.FB_PAGE_UNAVAILABLE,
    'Pick a connected Facebook Page.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/**
 * The Messenger profile of a Page (WD-FB-015): read live from Meta, and written straight to it, one piece at a time. Nothing is
 * stored here, so what the screen shows is always what Meta has.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(FACEBOOK_PLAN_GATE) private readonly plan: FacebookPlanGate,
  ) {}

  private api(page: PageRow): FacebookPageApi {
    return this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);
  }

  /** The connected Pages and, for the one picked (the first when none is), its live profile. */
  async view(pageUuid: string | undefined): Promise<MessengerSetup> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const connected = (await this.db.tx((tx) => this.pages.list(tx, orgId))).filter(
      (p) => p.status === 'connected',
    );
    const brief = (p: PageRow) => ({ id: p.uuid, pageId: p.pageId, name: p.name });
    const page = connected.find((p) => p.uuid === pageUuid) ?? connected[0];
    if (!page) {
      return {
        pages: [],
        page: null,
        getStarted: '',
        greeting: '',
        menu: { items: [], composerInputDisabled: false },
        iceBreakers: [],
      };
    }
    const view = readProfile(await this.api(page).getMessengerProfile());
    return {
      pages: connected.map(brief),
      page: brief(page),
      getStarted: view.getStarted,
      greeting: view.greeting,
      menu: { items: view.menuItems, composerInputDisabled: view.composerDisabled },
      iceBreakers: view.iceBreakers,
    };
  }

  /** A connected Page of this workspace, or the "Pick a connected Facebook Page." refusal. */
  private async connected(pageUuid: string): Promise<{ orgId: number; page: PageRow }> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const page = await this.db.tx((tx) => this.pages.findByUuid(tx, orgId, pageUuid));
    if (!page || page.status !== 'connected') throw unavailable();
    return { orgId, page };
  }

  /** A refusal becomes an error carrying Meta's reason; a revoked token also flags the Page; success is audited. */
  private async settle(
    orgId: number,
    page: PageRow,
    section: string,
    res: Outcome,
    done: string,
  ): Promise<SetupResult> {
    if (res.ok) {
      await this.db.tx((tx) =>
        this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: page.id,
          action: 'update',
          delta: { messenger_profile: { old: null, new: section } },
        }),
      );
      return { message: done };
    }
    if (isTokenError(res.code)) {
      await this.db.tx((tx) =>
        this.pages.markExpired(tx, orgId, page.id, clipError(res.error) ?? TOKEN_INVALID_MESSAGE),
      );
    }
    // The message for a field Meta has dropped already says what to do instead; it is not buried under "rejected".
    if (res.unsupported) {
      throw new AppError(
        ERROR_CODES.FB_SETUP_UNSUPPORTED,
        GREETING_UNSUPPORTED_MESSAGE,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw new AppError(
      ERROR_CODES.FB_SETUP_REJECTED,
      rejectedMessage(res.error),
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  async saveGetStarted(pageUuid: string, input: SaveGetStartedInput): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    const payload = input.payload.trim();
    const api = this.api(page);
    return payload === ''
      ? this.settle(
          orgId,
          page,
          'get_started',
          await api.deleteMessengerProfile(['get_started']),
          'Get Started button removed.',
        )
      : this.settle(
          orgId,
          page,
          'get_started',
          await api.setMessengerProfile({ get_started: { payload } }),
          'Get Started button saved.',
        );
  }

  async deleteGetStarted(pageUuid: string): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    return this.settle(
      orgId,
      page,
      'get_started',
      await this.api(page).deleteMessengerProfile(['get_started']),
      'Get Started button removed.',
    );
  }

  /**
   * Meta dropped `greeting` from recent Graph versions: a POST that carries only it fails with a list of accepted params that does not
   * include it. Older versions still take it, so it is retried once on the fallback version before being reported as unsupported.
   */
  async saveGreeting(pageUuid: string, input: SaveGreetingInput): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    const text = greetingText(input.greeting);
    if (text === '') return this.deleteGreeting(pageUuid);

    const api = this.api(page);
    const body = { greeting: [{ locale: 'default', text }] };
    let res: Outcome = await api.setMessengerProfile(body);
    if (!res.ok && greetingUnsupported(res.error ?? '')) {
      const fallback = this.graph.settings.greetingFallbackVersion;
      if (fallback !== '' && fallback !== this.graph.settings.graphVersion) {
        const retry = await api.setMessengerProfile(body, fallback);
        res = retry.ok ? retry : { ...retry, unsupported: greetingUnsupported(retry.error ?? '') };
      } else {
        res = { ...res, unsupported: true };
      }
    }
    return this.settle(orgId, page, 'greeting', res, 'Greeting saved.');
  }

  /**
   * Removing a greeting Facebook no longer stores is a no-op, so a version that has dropped the field is treated as success rather
   * than an error the operator cannot act on.
   */
  async deleteGreeting(pageUuid: string): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    const api = this.api(page);
    let res: Outcome = await api.deleteMessengerProfile(['greeting']);
    if (!res.ok && greetingUnsupported(res.error ?? '')) {
      const fallback = this.graph.settings.greetingFallbackVersion;
      const retry =
        fallback !== '' && fallback !== this.graph.settings.graphVersion
          ? await api.deleteMessengerProfile(['greeting'], fallback)
          : null;
      res = retry?.ok ? retry : { ok: true };
    }
    return this.settle(orgId, page, 'greeting', res, 'Greeting removed.');
  }

  async saveMenu(pageUuid: string, input: SaveMenuInput): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    const items = buildMenu(input.items);
    const api = this.api(page);
    if (items.length === 0) return this.deleteMenu(pageUuid);

    // A persistent menu needs the Get Started button to exist first (its result is not what the operator asked for, so it is not reported).
    if (!(await api.getMessengerProfile()).get_started) {
      await api.setMessengerProfile({ get_started: { payload: DEFAULT_GET_STARTED } });
    }
    return this.settle(
      orgId,
      page,
      'persistent_menu',
      await api.setMessengerProfile({
        persistent_menu: [
          {
            locale: 'default',
            composer_input_disabled: input.composerInputDisabled,
            call_to_actions: items,
          },
        ],
      }),
      'Persistent menu saved.',
    );
  }

  async deleteMenu(pageUuid: string): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    return this.settle(
      orgId,
      page,
      'persistent_menu',
      await this.api(page).deleteMessengerProfile(['persistent_menu']),
      'Persistent menu removed.',
    );
  }

  async saveIceBreakers(pageUuid: string, input: SaveIceBreakersInput): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    const items = buildIceBreakers(input.items);
    if (items.length === 0) return this.deleteIceBreakers(pageUuid);
    return this.settle(
      orgId,
      page,
      'ice_breakers',
      await this.api(page).setMessengerProfile({
        ice_breakers: [{ call_to_actions: items, locale: 'default' }],
      }),
      'Ice breakers saved.',
    );
  }

  async deleteIceBreakers(pageUuid: string): Promise<SetupResult> {
    const { orgId, page } = await this.connected(pageUuid);
    return this.settle(
      orgId,
      page,
      'ice_breakers',
      await this.api(page).deleteMessengerProfile(['ice_breakers']),
      'Ice breakers removed.',
    );
  }
}
