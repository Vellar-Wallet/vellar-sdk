/**
 * Mock policy source for testing
 */

import { PolicySource, PolicyConfig } from './policy-comparison-tool';

const mockPolicies: Record<string, PolicyConfig> = {
  account1: {
    spendingLimit: {
      daily: 1000,
      monthly: 25000,
      currency: 'USD',
    },
    allowedRecipients: ['GALICE...', 'GBOB...'],
    requiresApproval: false,
    multiSig: {
      enabled: false,
      threshold: 1,
    },
  },
  account2: {
    spendingLimit: {
      daily: 500,
      monthly: 25000,
      currency: 'USD',
    },
    allowedRecipients: ['GALICE...', 'GCHARLIE...'],
    requiresApproval: true,
    multiSig: {
      enabled: true,
      threshold: 2,
    },
  },
};

export const mockPolicySource: PolicySource = {
  async getPolicy(accountId: string): Promise<PolicyConfig> {
    const policy = mockPolicies[accountId];
    if (!policy) {
      throw new Error(`Policy not found for account: ${accountId}`);
    }
    return policy;
  },
};
