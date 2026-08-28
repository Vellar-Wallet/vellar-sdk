/**
 * Policy Comparison Tool
 * Compares policy configurations between two accounts
 */

export interface PolicyConfig {
  [key: string]: any;
}

export interface PolicySource {
  getPolicy(accountId: string): Promise<PolicyConfig>;
}

export interface PolicyDifference {
  field: string;
  account1Value: any;
  account2Value: any;
}

export interface ComparisonResult {
  account1: string;
  account2: string;
  hasDifferences: boolean;
  differences: PolicyDifference[];
}

export class PolicyComparisonTool {
  constructor(private policySource: PolicySource) {}

  /**
   * Compare policies between two accounts
   */
  async compare(account1Id: string, account2Id: string): Promise<ComparisonResult> {
    const policy1 = await this.policySource.getPolicy(account1Id);
    const policy2 = await this.policySource.getPolicy(account2Id);

    const differences = this.findDifferences(policy1, policy2);

    return {
      account1: account1Id,
      account2: account2Id,
      hasDifferences: differences.length > 0,
      differences,
    };
  }

  /**
   * Recursively find differences between two policy objects
   */
  private findDifferences(
    obj1: any,
    obj2: any,
    prefix = ''
  ): PolicyDifference[] {
    const differences: PolicyDifference[] = [];

    // Get all unique keys from both objects
    const allKeys = new Set([
      ...Object.keys(obj1 || {}),
      ...Object.keys(obj2 || {}),
    ]);

    for (const key of allKeys) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const val1 = obj1?.[key];
      const val2 = obj2?.[key];

      // If both are objects, recurse
      if (
        typeof val1 === 'object' &&
        val1 !== null &&
        !Array.isArray(val1) &&
        typeof val2 === 'object' &&
        val2 !== null &&
        !Array.isArray(val2)
      ) {
        differences.push(...this.findDifferences(val1, val2, fieldPath));
      } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        // Values differ
        differences.push({
          field: fieldPath,
          account1Value: val1,
          account2Value: val2,
        });
      }
    }

    return differences;
  }

  /**
   * Format comparison result as readable text
   */
  formatComparison(result: ComparisonResult): string {
    if (!result.hasDifferences) {
      return `No differences found between ${result.account1} and ${result.account2}`;
    }

    const lines = [
      `Policy Comparison: ${result.account1} vs ${result.account2}`,
      '='.repeat(60),
      '',
    ];

    for (const diff of result.differences) {
      lines.push(`Field: ${diff.field}`);
      lines.push(`  ${result.account1}: ${JSON.stringify(diff.account1Value)}`);
      lines.push(`  ${result.account2}: ${JSON.stringify(diff.account2Value)}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
