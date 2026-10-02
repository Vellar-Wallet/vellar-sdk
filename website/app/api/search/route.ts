// Exports a static Orama search index for app/search.tsx's staticClient to
// fetch client-side — force-static like every other docs route (createFromSource
// also supports a dynamic server-side GET, but that needs a non-static route,
// which would be the one server-rendered corner of an otherwise fully static
// docs site).
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/fuma-source";

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
