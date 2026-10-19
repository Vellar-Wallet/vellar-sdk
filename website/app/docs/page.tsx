import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCanonicalUrl } from "@/lib/canonical-url";
import { DOC_PAGES } from "@/lib/docs-registry";

export const metadata: Metadata = {
  alternates: {
    canonical: getCanonicalUrl(""),
  },
};

// /docs → the first page, read from the registry so it follows any reorder.
export default function DocsIndex() {
  redirect(`/docs/${DOC_PAGES[0].slug}`);
}
