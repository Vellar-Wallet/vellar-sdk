// Example: List the CAIP-2 network identifiers used across the Vellar SDK.
//
// Run with: npx tsx contrib/examples/list-caip2-ids/list-caip2-ids.ts

export interface Caip2NetworkIdentifier {
  identifier: string;
  networkName: string;
  environment: 'production' | 'testnet' | 'devnet';
  description: string;
}

/**
 * CAIP-2 (Chain Agnostic Improvement Proposal 2) network identifiers
 * supported across the Vellar SDK ecosystem.
 */
export const STELLAR_CAIP2_IDENTIFIERS: Caip2NetworkIdentifier[] = [
  {
    identifier: 'stellar:pubnet',
    networkName: 'Stellar Public Mainnet',
    environment: 'production',
    description: 'Production network for live Stellar asset settlements and smart contracts.',
  },
  {
    identifier: 'stellar:testnet',
    networkName: 'Stellar Testnet',
    environment: 'testnet',
    description: 'Public test network for developing and testing Soroban contracts and x402 payments.',
  },
  {
    identifier: 'stellar:futurenet',
    networkName: 'Stellar Futurenet',
    environment: 'devnet',
    description: 'Experimental developer network for early preview of upcoming protocol upgrades.',
  },
];

export function getCaip2Identifiers(): Caip2NetworkIdentifier[] {
  return STELLAR_CAIP2_IDENTIFIERS;
}

function main() {
  console.log('=== CAIP-2 Network Identifiers in Vellar SDK ===\n');

  console.log('Identifier        | Network Name            | Environment  | Description');
  console.log('------------------|-------------------------|--------------|---------------------------------------------------------');

  for (const net of STELLAR_CAIP2_IDENTIFIERS) {
    console.log(
      `${net.identifier.padEnd(17)} | ${net.networkName.padEnd(23)} | ${net.environment.padEnd(12)} | ${net.description}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
