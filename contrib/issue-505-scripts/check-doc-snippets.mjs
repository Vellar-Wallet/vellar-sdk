import fs from 'fs/promises';
import { execSync } from 'child_process';

// Expanded from 3 to 10 pages for broader drift detection
const PAGES = [
  "website/content/docs/getting-started/quickstart.md",
  "website/content/docs/x402.md",
  "website/content/docs/buyers/pay-for-a-resource.md",
  "website/content/docs/buyers/session-budgets.md",
  "website/content/docs/sellers/setup.md",
  "website/content/docs/sellers/issuing-tokens.md",
  "website/content/docs/reference/client-api.md",
  "website/content/docs/reference/errors.md",
  "packages/cli/README.md",
  "packages/mcp-x402-payer/README.md"
];