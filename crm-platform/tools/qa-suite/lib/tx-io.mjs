// Finds network calls inside the body of a database-transaction callback (QA task 46, `tx-no-io`).
//
// A call that is handed the transaction as its first argument runs its queries ON that transaction: `this.senders.sendingLabels(tx, ...)`
// reads devices, it does not call out. The pattern alone cannot tell the two apart (`send\w*` matches "sendingLabels"), so a match
// whose first argument is a transaction handle is skipped. Pure and exported so it has its own tests.

export const IO =
  /\b(?:fetch\(|axios\b|got\(|\.sendMail\(|this\.(?:provider|client|http|sender|mailer|bsp|gateway|senders|gateways)\w*\.(?:send|post|request|call|dispatch|charge|capture|create)\w*\()/g;

/** Names the repo uses for a transaction (or savepoint) handle. */
const TX_HANDLE = /^(?:[\w$.]*\.)?(?:tx|rowTx|sp|trx|txn|client|conn)$/;

/**
 * @param {string} body the masked source of one transaction callback
 * @returns {Array<{ index: number, text: string }>} the network calls in it, with their offset in `body`
 */
export function ioCalls(body) {
  const found = [];
  for (const m of body.matchAll(IO)) {
    const afterCall = body.slice(m.index + m[0].length);
    const firstArg = afterCall.match(/^\s*([A-Za-z_$][\w$.]*)\s*[,)]/)?.[1];
    if (firstArg && TX_HANDLE.test(firstArg)) continue;
    found.push({ index: m.index, text: m[0] });
  }
  return found;
}
