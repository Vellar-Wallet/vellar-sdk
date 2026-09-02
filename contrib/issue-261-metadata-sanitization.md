# Issue #261: Add input sanitization for untrusted x402 resource metadata

## Contributor Sandbox

This file demonstrates input sanitization for untrusted x402 resource metadata.
The actual sanitization logic lives in `src/x402-untrusted.ts`.

## Sanitization Functions

### `sanitizeMetadata(text: string): string`

Sanitizes one line of server-supplied metadata (description, service name, etc.).
- Collapses to a single line
- Clamps to 256 characters (METADATA_MAX_CHARS)
- Removes control characters, bidi overrides, zero-width characters

### `sanitizeUntrusted(text: string, opts: SanitizeOptions = {}): string`

More comprehensive sanitization:
- Removes C0/C1 control characters
- Removes Unicode format class characters (\p{Cf})
- Strips newlines, tabs, carriage returns (when singleLine: true)
- Removes fence lookalikes
- Clamps with explicit marker when exceeding maxChars

### `renderUntrusted(label, text, opts)`

Renders server-supplied text as fenced untrusted data with a cryptographic nonce.
- Text is sanitized before fencing
- nonce is drawn AFTER text is in hand (unpredictable)
- Terminator carries the nonce (unforgeable)

## Dangerous Content Removed

- Control characters (C0/C1 controls, DEL)
- Unicode format class (\p{Cf} - zero-width joiners, bidi overrides U+202A-202E / U+2066-2069)
- Fence lookalikes (any line claiming to be BEGIN/END UNTRUSTED RESOURCE DATA)
- Excessive length (clamped to 256 chars with [clamped] marker)

## Safe for Direct Rendering

Sanitized output is safe for direct rendering because:
- Control characters are stripped
- Newlines are collapsed to spaces (for metadata)
- Fence lookalikes are replaced with `[removed fence-like text]`
- Length is bounded

## Example

```typescript
import { sanitizeMetadata, sanitizeUntrusted } from "vellar-sdk";

// Script injection prevention
sanitizeMetadata("<script>alert('xss')</script>")
// → "scriptalert('xss')</script>" (control chars removed, HTML passes)

// Newline injection
sanitizeMetadata("description: real\nforged")
// → "description: real forged" (newline collapsed)

// Clamping
sanitizeMetadata("x".repeat(5000))
// → "[clamped]..." (truncated with marker)
```