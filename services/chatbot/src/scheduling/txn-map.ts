/**
 * Maps our chatbot transaction string-ids to the scheduling service's
 * integer transaction-type ids.
 *
 * The scheduling service (vendored in scheduling-service/) is WIP and knows
 * only a small set of transaction types, keyed by its own TEXT txn_type_id
 * (road_test, id_card, license_original, ...). This ALIAS table is the single
 * place that bridges our id vocabulary to theirs. Transactions with no entry
 * here — or whose alias isn't present in the running service — are reported
 * as `unmapped` so the chatbot can say scheduling isn't available for them.
 *
 * We deliberately do NOT add scheduling coverage for transactions the service
 * doesn't model; that's their schema to extend, not ours.
 */

export interface SchedulingTxnType {
  id: number;
  txn_type_id: string;
  name: string;
}

// chatbot string id  →  scheduling service txn_type_id (text)
// Only the transactions their service actually models are listed. Extend this
// ONLY when the devs add the corresponding type to their seed.
const ALIAS: Record<string, string> = {
  "id-card": "id_card",
  "road-test": "road_test",
  // 'license_original' is first-time issuance; our chatbot models renewals/
  // transfers separately. Add aliases here as their service grows to cover them.
};

export interface MappedTransactions {
  ids: number[]; // their integer ids, for the slots/booking API
  unmapped: string[]; // our chatbot ids with no scheduling equivalent
}

export function mapTransactions(
  chatbotTxnIds: string[],
  theirTypes: SchedulingTxnType[],
): MappedTransactions {
  const byText = new Map(theirTypes.map((t) => [t.txn_type_id, t.id]));
  const ids: number[] = [];
  const unmapped: string[] = [];
  for (const cid of chatbotTxnIds) {
    const theirText = ALIAS[cid];
    const theirId = theirText ? byText.get(theirText) : undefined;
    if (theirId != null) ids.push(theirId);
    else unmapped.push(cid);
  }
  return { ids, unmapped };
}
