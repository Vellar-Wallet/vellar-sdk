/**
 * Format an array of signer records into a readable display list,
 * sorted by weight descending.
 */

export interface SignerRecord {
  key: string;
  type: string;
  weight: number;
}

export interface FormattedSigner {
  key: string;
  type: string;
  weight: number;
}

export function formatSignerList(signers: SignerRecord[]): { lines: string[]; signers: FormattedSigner[] } {
  if (signers.length === 0) {
    return { lines: ["No signers"], signers: [] };
  }

  const sorted = [...signers].sort((a, b) => b.weight - a.weight);

  const lines = sorted.map((s, idx) => {
    return `${idx + 1}. ${s.type} key ${s.key} (weight ${s.weight})`;
  });

  return { lines, signers: sorted };
}