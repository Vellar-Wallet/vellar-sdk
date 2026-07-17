import { redirect } from "next/navigation";

// /docs → the first page.
export default function DocsIndex() {
  redirect("/docs/introduction");
}
