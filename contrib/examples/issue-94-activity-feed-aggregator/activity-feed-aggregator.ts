/**
 * Wallet activity feed aggregator (issue #94)
 *
 * Merges payment history and policy change history into a single
 * chronologically ordered feed where every item has a consistent shape.
 */

export type ActivityKind = 'payment' | 'policy_change';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  timestamp: Date;
  summary: string;
  meta: Record<string, unknown>;
}

export interface PaymentRecord {
  id: string;
  amount: string;
  currency: string;
  to: string;
  at: Date;
}

export interface PolicyChangeRecord {
  id: string;
  policyId: string;
  changeType: string;
  at: Date;
}

function fromPayment(p: PaymentRecord): ActivityItem {
  return {
    id: p.id,
    kind: 'payment',
    timestamp: p.at,
    summary: `Sent ${p.amount} ${p.currency} to ${p.to}`,
    meta: { amount: p.amount, currency: p.currency, to: p.to },
  };
}

function fromPolicyChange(c: PolicyChangeRecord): ActivityItem {
  return {
    id: c.id,
    kind: 'policy_change',
    timestamp: c.at,
    summary: `Policy ${c.policyId}: ${c.changeType}`,
    meta: { policyId: c.policyId, changeType: c.changeType },
  };
}

/**
 * Merge payment records and policy change records into a single feed sorted
 * newest-first.
 */
export function aggregateFeed(
  payments: PaymentRecord[],
  policyChanges: PolicyChangeRecord[],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...payments.map(fromPayment),
    ...policyChanges.map(fromPolicyChange),
  ];

  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return items;
}
