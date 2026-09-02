// Example: several mock signers each approve a sample transaction until a
// configured threshold is met, then it's marked ready. A signer approving
// twice only counts once toward the threshold — approvals are deduplicated
// by signer id.
//
// Run with: npx tsx multi-signer-approval-demo.ts

export class MultiSignerApproval {
  #threshold: number;
  #approvals = new Set<string>();

  constructor(threshold: number) {
    if (threshold <= 0) {
      throw new RangeError(`threshold must be a positive number, got ${threshold}`);
    }
    this.#threshold = threshold;
  }

  /** Records an approval from `signerId`. A repeat approval from the same
   * signer is a no-op — it does not count twice toward the threshold. */
  approve(signerId: string): void {
    this.#approvals.add(signerId);
  }

  get approvalCount(): number {
    return this.#approvals.size;
  }

  /** True once distinct approvals reach (or exceed) the threshold. */
  get isReady(): boolean {
    return this.#approvals.size >= this.#threshold;
  }
}

function main() {
  const approval = new MultiSignerApproval(2);
  const signers = ["signer-alice", "signer-bob", "signer-carol"];

  console.log(`Threshold: 2 of ${signers.length} signers`);

  console.log(`${signers[0]} approves...`);
  approval.approve(signers[0]!);
  console.log(`  approvals: ${approval.approvalCount}, ready: ${approval.isReady}`);

  console.log(`${signers[0]} approves again (should not double-count)...`);
  approval.approve(signers[0]!);
  console.log(`  approvals: ${approval.approvalCount}, ready: ${approval.isReady}`);

  console.log(`${signers[1]} approves...`);
  approval.approve(signers[1]!);
  console.log(`  approvals: ${approval.approvalCount}, ready: ${approval.isReady}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
