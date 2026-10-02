// Binds fumadocs-mdx's compiled content collection (source.config.ts's
// `docs`, compiled by the fumadocs-mdx CLI/Next plugin into .source/index.ts
// — gitignored generated output, never hand-edited) to fumadocs-core's
// loader(). This is the one new "content pipeline" seam the migration
// introduces; everything else (docs-registry.ts's DOC_PAGES, docs.ts's link
// rewriting, docs-agent.ts's agent-facing exports) is unchanged.
import { loader } from "fumadocs-core/source";
import { docs } from "../.source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
