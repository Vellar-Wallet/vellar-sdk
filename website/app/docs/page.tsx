import { redirect } from "next/navigation";
import { DOC_PAGES } from "@/lib/docs-registry";

// /docs → the first page, read from the registry so it follows any reorder.
export default function DocsIndex() {
  redirect(`/docs/${DOC_PAGES[0].slug}`);
}
