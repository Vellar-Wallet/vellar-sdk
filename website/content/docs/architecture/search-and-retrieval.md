# Search and Retrieval

> How the Bazaar catalog ranks search results, what the current evaluation
> shows, and what is honestly not yet measured.

By the end of this page you will understand the two-stage ranking pipeline
behind `/discovery/search`, what the measured quality numbers actually say and
where they stop being informative, and what the pre-mainnet plan is for
extending evaluation beyond a 19-entry corpus.

## The ranking pipeline

`/discovery/search` runs two independent rankers over the catalog and fuses
their outputs with Reciprocal Rank Fusion. Neither stage replaces the other:
each is good at a class of query the other handles poorly, and RRF combines
them by rank position rather than by score, so the two stages do not have to
share a scale.

### Stage 1: lexical ranking

The lexical stage scores token overlap between the query and the catalog entry.
Its correctness depends less on any single clever step than on both sides of
the comparison being processed identically.

**Tokenization.** The query and the catalog fields are split on the same path,
and both sides normalise identically. A tokenizer applied to one side only
would silently drop matches that a reader would expect to work.

**Synonym expansion.** 8 bidirectional groups, expanded before stemming. The
order matters: stemming first would transform whole words that the synonym map
is keyed on, and the lookups would then miss.

**Stemming.** 6 suffix rules (tion/sion, ing, ly, ed, er, and plural s with an
ss exemption), applied to both sides. Stemming one side against an unstemmed
other breaks matches, which is the same symmetry requirement as tokenization.

**Field weighting.** Not all catalog fields carry equal signal about what a
resource is:

| Field | Weight |
| --- | --- |
| `serviceName` | 4x |
| `tags` | 3x |
| `description` | 2x |
| resource URL | 1x |

**Trust ranking.** Relevance ties are broken by observed usage: `settlements`
x2 plus `uniquePayers`. An empty query ranks by trust rather than recency, so a
new listing with no settlements ranks below established ones. That is a
deliberate choice: recency ordering rewards whoever listed last, trust ordering
rewards whoever has actually been paid.

> **Note:** This stage is token-scored relevance, not semantic matching, in the
> sense the `/discovery/search` endpoint description uses. Stage 2 is where
> meaning enters.

### Stage 2: semantic ranking

The semantic stage embeds catalog entries with Voyage AI `voyage-code-3` at
1024 dimensions and stores one embedding per catalog entry. At query time it
computes cosine similarity over an in-memory cache and fuses the resulting
ranking with the lexical one via RRF.

This is the arm that answers a query sharing no vocabulary with any listing.
The lexical stage cannot: with zero token overlap there is nothing to score.

> ⚠️ **A Voyage outage degrades the ranking, it does not break the endpoint.**
> With the semantic arm unavailable, `/discovery/search` returns lexical
> results with no semantic component. It does not hang. A query that depends on
> the semantic arm will rank worse or return nothing, and the response gives no
> indication that half the pipeline was missing.

## Measured quality

Two query sets of 10 each were run against a catalog of 19 entries. Semantic
queries share no vocabulary with any listing; keyword queries have direct token
overlap.

Semantic queries:

| Ranker | MRR | NDCG@3 |
| --- | --- | --- |
| Lexical only | 0.264 | 0.263 |
| Hybrid | 0.717 | 0.789 |

Keyword queries:

| Ranker | MRR | NDCG@3 |
| --- | --- | --- |
| Lexical only | 0.950 | 0.963 |
| Hybrid | 0.950 | 0.963 |

The shape of these two tables is the entire argument for the architecture.
Hybrid improves semantic queries substantially and leaves keyword queries
unchanged. That is why hybrid was chosen over replacing the lexical ranker with
the semantic one: the lexical stage is already close to ceiling on the queries
it is good at, and swapping it out would have risked that for a gain that
fusion delivers anyway.

> ⚠️ **These numbers describe a 19-entry catalog, not the ranking in general.**
> At n=19 standard IR metrics cannot distinguish a good ranker from a lucky
> one. A ranker that had memorised 19 entries would score identically. Read
> them as evidence that the semantic arm changed something real on this corpus,
> not as a quality claim about search at scale.

MRR 0.717 on semantic queries means the relevant result appears in the top 1 to
2 positions on average across the 10 test queries. It does not mean the first
result is always correct.

## What is not yet measured

Stated plainly, so that nobody has to infer it from the absence of a number:

- No precision@1 or recall@k on a diverse corpus.
- No human relevance judgment set beyond the current query set.
- No dev/locked hash split preventing overfitting.
- No CI regression floor, so a ranking change does not currently fail the
  build.
- No ablation across corpus sizes.
- No measurement of zero-result rate against real user queries.

The last two matter most for anyone assessing whether these results carry to a
larger catalog. Without an ablation across corpus sizes there is no evidence
about how the fusion behaves as n grows, and without a zero-result measurement
against real queries there is no evidence about the queries users actually
type.

## The honest current state

Before the semantic arm was added, a query sharing no token with any listing
returned nothing at all: an empty result set rather than a weak ranking. That
was the failure worth fixing, and it is fixed. All 10 semantic test queries now
return a relevant result.

What remains is where those results rank, not whether they are retrieved. 5 of
the 10 semantic queries reach the top 3 but not first place. The problem has
moved from retrieval to ordering, which is a different and narrower problem.

## The pre-mainnet plan

Four commitments, scoped as pre-mainnet engineering work rather than a
post-launch nice-to-have:

1. Improve top-1 accuracy on semantic queries. This is a reranking problem
   rather than a retrieval one, since the relevant results are already being
   returned.
2. Extend the eval harness beyond one seller's 19-entry catalog.
3. Add documented metrics with a published floor that gates the build.
4. Document the quality-tracking process so ranking regressions are caught
   before deployment.

See [Search evaluation](../reference/evaluation.md) for the fuller account,
including the query sets and the reasoning behind each metric.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A query returns nothing | No lexical token overlap and the semantic arm is unavailable, so neither stage can score the corpus | Retry once Voyage is reachable, or rephrase using vocabulary that appears in listings (`serviceName`, `tags`, `description`) |
| A relevant result ranks below a less relevant one | Trust ranking (`settlements` x2 plus `uniquePayers`) breaks ties toward established listings, so a new entry with no settlements ranks low | Expected behaviour, not a bug. Sellers accumulate rank by taking settled payments; see [Get discovered](../sellers/get-discovered.md) |
| Semantic-style queries suddenly rank much worse | Voyage is unavailable and the pipeline degraded to lexical ranking only, with no signal in the response | Compare against a known keyword query, which is unaffected, then retry the semantic query later |

## Next steps

- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Search evaluation](../reference/evaluation.md)
- [Get discovered](../sellers/get-discovered.md)
- [Honesty](../reference/honesty.md)
