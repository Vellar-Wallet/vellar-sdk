import { redirect } from "next/navigation";
import { DOC_PAGES } from "@/lib/docs-registry";

// The site is docs-only; send the root to the docs entry page. Derived from the
// registry rather than hardcoded, so reordering or re-slugging the first page
// can't leave the front door pointing at a 404.
export default function Home() {
  redirect(`/docs/${DOC_PAGES[0].slug}`);
}
