import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, WALLET_LIMITS, type WalletTxType } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { LogActorType } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';

export interface PostEntry {
  orgId: number;
  /** The wallet's unit when it has to be created (the platform currency). An existing wallet keeps its own. */
  unit: string;
  type: WalletTxType;
  direction: 'in' | 'out';
  /** Always positive, hundredths. The direction says which way it moves. */
  amountMinor: number;
  /**
   * A caller-chosen key that makes the posting happen once: a gateway retry, a webhook delivered twice and a double click all
   * name the same key, and the second returns the first's result without moving money (UNIQUE (org_id, key)).
   */
  idempotencyKey: string;
  source?: string | null;
  description?: string | null;
  /** The reason; mandatory (5+ characters) for `admin_adjust`, enforced again by the database. */
  note?: string | null;
  subject?: { type: string; id: number } | null;
  meta?: Record<string, unknown> | null;
  userId?: number | null;
  actor?: { type: LogActorType; label?: string | null; operatorId?: number | null };
  /** A debit larger than the balance takes what is there instead of failing (settlement; an operator's deduction). */
  allowPartial?: boolean;
}

export interface PostResult {
  /** Null when nothing moved (a partial debit against an empty wallet). */
  transactionId: string | null;
  /** The ledger row's internal id, for the rows that point at it (`usage_charges.wallet_tx_id`). Never sent to a client. */
  transactionRowId: number | null;
  replayed: boolean;
  requestedMinor: number;
  appliedMinor: number;
  balanceBeforeMinor: number;
  balanceAfterMinor: number;
  walletId: number;
}

/** A credit that proves the customer put money in: it re-arms the low-balance alert (TW-WALLET-015). */
const REARMS_ALERT: ReadonlySet<WalletTxType> = new Set(['topup', 'admin_adjust', 'earn']);

/**
 * The one door through which money enters or leaves a wallet (TW-WALLET-001).
 *
 * Every posting takes the workspace's wallet row lock first, computes the new balance from the locked row (never from a caller),
 * writes the signed ledger entry and the new balance in the same transaction, and is idempotent on its key. The balance is
 * `sum(ledger)`: the reconciliation job checks it. It runs inside the caller's transaction (`tx`): a settlement, a payment
 * fulfilment and an operator adjustment each compose it with their own writes and commit or roll back as one.
 */
@Injectable()
export class WalletLedgerService {
  constructor(
    private readonly repo: WalletRepository,
    private readonly outbox: OutboxService,
  ) {}

  async post(tx: Tx, e: PostEntry): Promise<PostResult> {
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) {
      throw new AppError(
        ERROR_CODES.WALLET_AMOUNT_INVALID,
        'The amount must be a whole number of hundredths greater than 0.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (e.amountMinor > WALLET_LIMITS.maxAmountMinor) {
      throw new AppError(
        ERROR_CODES.WALLET_AMOUNT_INVALID,
        'That amount is above the limit for a single posting.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (e.type === 'admin_adjust' && (e.note ?? '').trim().length < WALLET_LIMITS.noteMin) {
      throw new AppError(
        ERROR_CODES.WALLET_NOTE_REQUIRED,
        `A manual adjustment needs a note of at least ${WALLET_LIMITS.noteMin} characters saying why.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'note', message: 'required' }],
      );
    }

    const wallet = await this.repo.lockWallet(tx, e.orgId, e.unit);

    const prior = await this.repo.findByKey(tx, e.orgId, e.idempotencyKey);
    if (prior) {
      return {
        transactionId: prior.uuid,
        transactionRowId: prior.id,
        replayed: true,
        requestedMinor: e.amountMinor,
        appliedMinor: Math.abs(prior.amountMinor),
        balanceBeforeMinor: prior.balanceAfterMinor - prior.amountMinor,
        balanceAfterMinor: prior.balanceAfterMinor,
        walletId: wallet.id,
      };
    }

    let applied = e.amountMinor;
    if (e.direction === 'out' && wallet.balanceMinor < applied) {
      if (!e.allowPartial) {
        throw new AppError(
          ERROR_CODES.WALLET_INSUFFICIENT_BALANCE,
          'The wallet balance is lower than this amount.',
          HttpStatus.CONFLICT,
        );
      }
      applied = wallet.balanceMinor;
      if (applied <= 0) {
        return {
          transactionId: null,
          transactionRowId: null,
          replayed: false,
          requestedMinor: e.amountMinor,
          appliedMinor: 0,
          balanceBeforeMinor: wallet.balanceMinor,
          balanceAfterMinor: wallet.balanceMinor,
          walletId: wallet.id,
        };
      }
    }

    const after =
      e.direction === 'in' ? wallet.balanceMinor + applied : wallet.balanceMinor - applied;
    const ctx = RequestContextStore.peek();
    const actor = e.actor ?? { type: 'system' as const };
    const row = await this.repo.insertTransaction(tx, {
      orgId: e.orgId,
      userId: e.userId ?? null,
      type: e.type,
      direction: e.direction,
      amountMinor: applied,
      balanceAfterMinor: after,
      source: e.source ?? null,
      subjectType: e.subject?.type ?? null,
      subjectId: e.subject?.id ?? null,
      description: e.description ?? null,
      note: e.note?.trim() || null,
      meta: e.meta ?? null,
      idempotencyKey: e.idempotencyKey,
      actorType: actor.type,
      actorLabel: actor.label ?? null,
      operatorId: actor.operatorId ?? null,
      requestId: ctx?.requestId ?? null,
    });
    if (!row) {
      // Unreachable while the wallet row is locked; fail closed rather than move the balance without an entry.
      throw new Error(`wallet ledger conflict for ${e.idempotencyKey}`);
    }

    await this.repo.setBalance(
      tx,
      e.orgId,
      wallet.id,
      after,
      e.direction === 'in' && REARMS_ALERT.has(e.type) ? 'clear' : 'keep',
    );

    if (
      e.direction === 'in' &&
      (e.type === 'topup' || e.type === 'admin_adjust' || e.type === 'earn')
    ) {
      await this.outbox.emit(tx, {
        orgId: e.orgId,
        aggregateModule: 'wallets',
        aggregateId: wallet.id,
        eventType: 'wallet.topped_up',
        payload: {
          type: e.type,
          amountMinor: applied,
          balanceAfterMinor: after,
          source: e.source ?? null,
        },
      });
    }

    return {
      transactionId: row.uuid,
      transactionRowId: row.id,
      replayed: false,
      requestedMinor: e.amountMinor,
      appliedMinor: applied,
      balanceBeforeMinor: wallet.balanceMinor,
      balanceAfterMinor: after,
      walletId: wallet.id,
    };
  }
}
