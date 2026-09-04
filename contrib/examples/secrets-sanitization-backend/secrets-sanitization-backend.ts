/**
 * Issue #256: Secrets Sanitization in Backend Request & Error Handling.
 */

export function sanitizeErrorSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(sk_[a-zA-Z0-9_]{10,})/g, "[REDACTED_SECRET_KEY]")
    .replace(/(apiKey|token|secret|password)=([^&\s]+)/gi, "$1=[REDACTED]");
}
