import { redirect } from "next/navigation";

// The site is docs-only; send the root to the docs entry page.
export default function Home() {
  redirect("/docs/introduction");
}
