// #46 Transaction audit: audit + outbox writes join the caller's transaction; no network I/O while a transaction holds a connection.
import { apiSrc, expectNone, read, rel } from '../lib/core.mjs';
import { lineAt, maskCode, matchClose } from '../lib/code.mjs';

const TX_OPEN = /\b(?:this\.)?db\.(?:tx|txAs|privileged|txReplica)\s*\(/g;
const IO =
  /\b(?:fetch\(|axios\b|got\(|\.sendMail\(|this\.(?:provider|client|http|sender|mailer|bsp|gateway|senders|gateways)\w*\.(?:send|post|request|call|dispatch|charge|capture|create)\w*\()/;

export default {
  id: 46,
  priority: 'P1',
  name: 'Transaction audit',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const orphanWrites = [],
      ioInTx = [];
    let txCount = 0,
      auditCalls = 0;
    for (const f of apiSrc()) {
      const raw = read(f);
      const m = maskCode(raw);
      // 1. audit.record / outbox.emit must receive the transaction handle as first argument
      for (const mt of m.matchAll(
        /\b(?:audit\.record|outbox\.(?:emit|publish|enqueue))\s*\(\s*([A-Za-z_$][\w$.]*)?/g,
      )) {
        auditCalls++;
        const arg = mt[1] ?? '';
        if (!/^(?:[\w.]*\.)?(tx|rowTx|sp|trx|txn|client|t|conn|e)$/.test(arg))
          orphanWrites.push(
            `${rel(f)}:${lineAt(raw, mt.index)}  ${mt[0].replace(/\s+/g, ' ')}  <- first argument is '${arg || 'none'}', not a transaction`,
          );
      }
      // 2. network I/O while a transaction is open
      for (const mt of m.matchAll(TX_OPEN)) {
        txCount++;
        const open = mt.index + mt[0].length - 1,
          close = matchClose(m, open);
        if (close < 0) continue;
        const body = m.slice(open, close),
          io = body.match(IO);
        if (io)
          ioInTx.push(`${rel(f)}:${lineAt(raw, open + io.index)}  ${io[0]} inside ${mt[0].trim()}`);
      }
    }
    const checks = [
      expectNone(
        'tx-audit-outbox',
        "audit.record / outbox.emit always run on the caller's transaction (same commit or same rollback)",
        orphanWrites,
        { severity: 'high' },
      ),
      expectNone(
        'tx-no-io',
        'No network call while a database transaction holds a pooled connection',
        ioInTx,
        { level: 'warn' },
      ),
    ];
    return {
      checks,
      metrics: {
        'transactions scanned': txCount,
        'audit/outbox calls': auditCalls,
        'audit/outbox off-transaction': orphanWrites.length,
        'I/O in transaction': ioInTx.length,
      },
      target: {
        met: orphanWrites.length === 0 ? true : false,
        text: 'Audit and outbox rows must commit atomically with the change they describe.',
      },
    };
  },
};
