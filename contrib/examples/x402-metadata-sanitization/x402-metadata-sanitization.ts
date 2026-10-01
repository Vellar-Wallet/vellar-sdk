/**
 * Issue #261: Input sanitization for untrusted x402 resource metadata.
 */

// Characters that are dangerous for rendering
const DANGEROUS_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Cf}/gu;
const NEWLINES_AND_TABS = /[\n\r\t\u000B\u000C\u0085\u2028\u2029]/g;
// Basic HTML tags injection guard
const HTML_TAGS = /<[^>]*>?/g;

export interface ResourceMetadata {
  name?: string;
  description?: string;
}

export function sanitizeResourceMetadata(metadata: ResourceMetadata): ResourceMetadata {
  const sanitize = (text: string) => {
    let out = text.replace(DANGEROUS_CHARS, "");
    out = out.replace(NEWLINES_AND_TABS, " ");
    out = out.replace(HTML_TAGS, "");
    if (out.length > 256) {
      out = `${out.slice(0, 256).replace(/[\uD800-\uDBFF]$/, "")}…[clamped]`;
    }
    return out.trim();
  };

  return {
    name: metadata.name ? sanitize(metadata.name) : undefined,
    description: metadata.description ? sanitize(metadata.description) : undefined,
  };
}
