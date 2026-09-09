# Search Evaluation

> The honest account of Bazaar search quality: what is measured, what the numbers
> mean, and what the pre-mainnet commitment is.

By the end of this page you will understand the current evaluation methodology,
what the MRR and NDCG numbers actually describe, and what is explicitly not yet
measured.

## Current state

The catalog currently holds 19 entries. At that corpus size, standard IR metrics
cannot distinguish a good ranker from a lucky one. Nineteen documents is small
enough that a handful of fortunate token overlaps move a score more than any
property of the ranking algorithm does.

So the evaluation below is not a quality proof. It is a regression baseline: a
reference point that catches a ranking change making things obviously worse, run
manually rather than enforced. Nothing gates the build on it today. Read it that
way.

The design decision it was built to answer is a real one, and the numbers do
answer it. Whether the resulting ranker is good in general is a separate
question that this evidence does not settle.

## What is measured

Two query sets of 10 queries each, run against the 19-entry catalog. Each set is
run twice: once with the lexical ranker alone, once with the hybrid system
(lexical plus semantic, fused via Reciprocal Rank Fusion).

Semantic queries share no vocabulary with any listing:

| Configuration | MRR | NDCG@3 |
| --- | --- | --- |
| Lexical only | 0.264 | 0.263 |
| Hybrid | 0.717 | 0.789 |

Keyword queries have direct token overlap with listings:

| Configuration | MRR | NDCG@3 |
| --- | --- | --- |
| Lexical only | 0.950 | 0.963 |
| Hybrid | 0.950 | 0.963 |

The hybrid system improves semantic queries substantially and leaves keyword
queries unchanged. That asymmetry is the whole reason hybrid was chosen over
replacing the lexical ranker outright: the lexical arm was already close to
ceiling on the queries it handles, so replacing it would have traded away known
good behaviour for a gain it did not need.

Before the semantic arm existed, a query sharing no token with any listing
returned nothing at all: an empty result set rather than a weak ranking. All 10
semantic test queries now return a relevant result. What remains to improve is
where those results rank, not whether they are retrieved.

## What the numbers mean

MRR 0.717 on the semantic set means the relevant result appears in the top 1 to
2 positions on average across the 10 test queries.

It does not mean the first result is always correct. Five of the 10 semantic
queries reach the top 3 but not first place. Averaged reciprocal rank hides that
distribution, which is why it is stated here explicitly: top-1 accuracy on
semantic queries is the weak spot, and it is a reranking problem rather than a
retrieval one.

> ⚠️ **These numbers describe a 19-entry catalog, not the ranking algorithm.** A
> ranker that simply memorised 19 entries would score identically on this
> harness. Nothing in the methodology as it stands could tell the two apart. Do
> not generalise from n=19, and do not cite these figures as evidence of search
> quality at any larger corpus size.

## What is not measured

The gaps are as load-bearing as the results. None of the following exists today:

- No precision@1 or recall@k on a diverse corpus.
- No human relevance judgment set beyond the current query set.
- No dev/locked hash split preventing overfitting.
- No CI regression floor, so a ranking change does not currently fail the build.
- No ablation across corpus sizes.
- No measurement of zero-result rate against real user queries.

The absent CI floor is the one that matters most operationally. Ranking quality
can currently change without anything failing, which means the numbers above
describe a point in time rather than an enforced property.

## The pre-mainnet commitment

Four items, scoped as a gating engineering commitment rather than a post-launch
nice-to-have:

1. Improve top-1 accuracy on semantic queries, which is a reranking problem
   rather than a retrieval one.
2. Extend the eval harness beyond one seller's 19-entry catalog.
3. Add documented metrics with a published floor that gates the build.
4. Document the quality-tracking process so ranking regressions are caught
   before deployment.

> **Note:** These sit alongside the three mainnet gating items in
> [Honesty](../reference/honesty.md). Search evaluation is a separate track from
> the facilitator and policy-contract readiness work, not a substitute for it.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A semantic query returns a relevant result outside the top position | Top-1 accuracy on semantic queries is the known weak spot: 5 of 10 test queries reach the top 3 but not first place | Read the top 3 rather than the top 1. Reranking is item 1 of the pre-mainnet commitment |
| A new listing ranks below established ones | Trust ranking scores settlements x2 plus uniquePayers, and an empty query ranks by trust rather than recency | Accumulate settled payments, and use specific query tokens rather than an empty query. See [Get discovered](../sellers/get-discovered.md) |
| Search quality changes without the build failing | There is no CI regression floor yet, so a ranking change is not gated by the eval harness | Run the harness manually against a change. A published floor that gates the build is item 3 of the pre-mainnet commitment |
| Results look weaker than these figures suggest | The figures describe a 19-entry catalog and do not generalise | Treat them as a regression baseline, not a quality guarantee at your corpus size |

## Next steps

- [Search and retrieval](../architecture/search-and-retrieval.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Honesty](../reference/honesty.md)
- [Get discovered](../sellers/get-discovered.md)
