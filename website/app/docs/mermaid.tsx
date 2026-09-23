"use client";

import { useEffect, useRef, useState } from "react";

// Renders a ```mermaid fenced block as an SVG diagram.
//
// Mermaid is loaded with a dynamic import inside the effect rather than a
// top-level import, so its ~500KB only reaches browsers that actually open a
// page carrying a diagram. Two of thirty docs pages have one.
//
// The pre-render fallback is the diagram source in a <pre>, which is also what
// a reader sees if the import fails or JS is off: worse than a picture, but it
// still says what the diagram says.

let idCounter = 0;

export function Mermaid({ chart }: { chart: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    idCounter += 1;
    const id = `mermaid-${idCounter}`;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "var(--body)",
          themeVariables: {
            // Paper ground, forest ink: the same tokens the rest of the docs
            // use, so a diagram does not read as a foreign embed.
            background: "#ffffff",
            primaryColor: "#dcf8ec",
            primaryTextColor: "#0c3b31",
            primaryBorderColor: "#0c3b31",
            lineColor: "#0c3b31",
            textColor: "#0c3b31",
            actorBkg: "#dcf8ec",
            actorBorder: "#0c3b31",
            actorTextColor: "#0c3b31",
            actorLineColor: "rgba(12, 59, 49, 0.32)",
            signalColor: "#0c3b31",
            signalTextColor: "#0c3b31",
            noteBkgColor: "#ffefc9",
            noteBorderColor: "#0c3b31",
            noteTextColor: "#0c3b31",
            sequenceNumberColor: "#ffffff",
          },
        });
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (svg && !failed) {
    return (
      <div
        ref={hostRef}
        className="docs-mermaid"
        // Mermaid output is generated from content authored in this repo and
        // rendered with securityLevel "strict", which strips scripts and
        // event handlers from the SVG.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <pre className="docs-mermaid-source">
      <code>{chart}</code>
    </pre>
  );
}
