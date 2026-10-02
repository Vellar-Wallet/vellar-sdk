"use client";

import { useEffect, useRef, useState } from "react";

// "Copy for AI agent" — copies the page's raw markdown (served at
// /docs/<slug>.md) so a developer can paste it straight into their coding
// agent. The dropdown adds "copy entire docs" (llms-full.txt) and a plain
// view of the markdown. Copying fetches the same route an agent would, so
// what you copy is exactly what the URL serves.

export function CopyForAgentButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Close the dropdown on any click outside it.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy(path: string) {
    setOpen(false);
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${res.status}`);
      await navigator.clipboard.writeText(await res.text());
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  }

  const label =
    status === "copied" ? "Copied ✓" : status === "error" ? "Copy failed" : "Copy for AI agent";

  return (
    <div className="docs-copy" ref={rootRef}>
      <button
        type="button"
        className="docs-copy-main"
        onClick={() => copy(`/docs/${slug}.md`)}
        title="Copy this page as markdown for your coding agent"
      >
        {label}
      </button>
      <button
        type="button"
        className="docs-copy-caret"
        aria-label="More copy options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div className="docs-copy-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => copy(`/docs/${slug}.md`)}>
            Copy this page
          </button>
          <button type="button" role="menuitem" onClick={() => copy("/llms-full.txt")}>
            Copy entire docs
          </button>
          <a role="menuitem" href={`/docs/${slug}.md`} target="_blank" rel="noopener noreferrer">
            View as markdown
          </a>
        </div>
      )}
    </div>
  );
}
