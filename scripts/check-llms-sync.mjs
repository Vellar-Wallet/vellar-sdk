#!/usr/bin/env node
// Check that llms.txt and llms-full.txt stay in sync with the docs registry.
//
// This script:
// 1. Extracts the set of page slugs from the generated llms.txt index
// 2. Extracts the set of page slugs from the generated llms-full.txt corpus
// 3. Compares both against the DOC_PAGES registry
// 4. Fails if:
//    - A page exists in DOC_PAGES but is missing from llms-full.txt
//    - A page listed in llms.txt points to a slug not in DOC_PAGES
//    - A page exists in DOC_PAGES but is missing from llms.txt

import { buildLlmsIndex, buildLlmsFull } from "../website/lib/docs-agent.js";
import { DOC_PAGES } from "../website/lib/docs-registry.js";

// Extract slugs from llms.txt (the index)
// Format: - [Title](https://docs.vellar.xyz/docs/{slug}.md): description
function extractSlugsFromIndex(index) {
  const slugs = new Set();
  const linkRegex = /\]\(https:\/\/docs\.vellar\.xyz\/docs\/([^.]+)\.md\)/g;
  let match;
  while ((match = linkRegex.exec(index)) !== null) {
    slugs.add(match[1]);
  }
  return slugs;
}

// Extract slugs from llms-full.txt (the corpus)
// Format: <!-- Source: https://docs.vellar.xyz/docs/{slug} -->
function extractSlugsFromCorpus(corpus) {
  const slugs = new Set();
  const sourceRegex = /<!-- Source: https:\/\/docs\.vellar\.xyz\/docs\/([^\s]+) -->/g;
  let match;
  while ((match = sourceRegex.exec(corpus)) !== null) {
    slugs.add(match[1]);
  }
  return slugs;
}

// Main validation logic
export function validateLlmsSync() {
  const registrySlugSet = new Set(DOC_PAGES.map((p) => p.slug));
  const indexOutput = buildLlmsIndex();
  const corpusOutput = buildLlmsFull();

  const indexSlugs = extractSlugsFromIndex(indexOutput);
  const corpusSlugs = extractSlugsFromCorpus(corpusOutput);

  const errors = [];

  // Check 1: every page in registry must be in llms-full.txt
  for (const slug of registrySlugSet) {
    if (!corpusSlugs.has(slug)) {
      errors.push(`❌ Missing from llms-full.txt: "${slug}" (present in registry)`);
    }
  }

  // Check 2: every page in llms.txt must exist in registry
  for (const slug of indexSlugs) {
    if (!registrySlugSet.has(slug)) {
      errors.push(`❌ Invalid slug in llms.txt: "${slug}" (not in registry)`);
    }
  }

  // Check 3: every page in registry must be in llms.txt
  for (const slug of registrySlugSet) {
    if (!indexSlugs.has(slug)) {
      errors.push(`❌ Missing from llms.txt: "${slug}" (present in registry)`);
    }
  }

  return { errors, indexSlugs, corpusSlugs, registrySlugSet };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors } = validateLlmsSync();

  if (errors.length > 0) {
    console.error("llms.txt and llms-full.txt sync check failed:\n");
    for (const error of errors) {
      console.error(error);
    }
    console.error(
      "\nFix by ensuring DOC_PAGES in website/lib/docs-registry.ts is complete and accurate.",
    );
    process.exit(1);
  }

  console.log("✓ llms.txt and llms-full.txt are in sync with the docs registry");
}
