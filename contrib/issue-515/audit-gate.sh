#!/usr/bin/env bash
set -e

# REVIEW-CHECKPOINT: 2026-10-31
# The audit gate was softened to critical on 2026-09-07 due to the passkey-kit -> toml chain.
CURRENT_DATE=$(date +%Y%m%d)
EXPIRY_DATE="20261031"

if [ "\(CURRENT_DATE" -gt "\)EXPIRY_DATE" ]; then
  echo "::error::Audit softening review checkpoint (2026-10-31) has expired!"
  echo "Please check if the @stellar/stellar-sdk -> toml advisory is resolved."
  echo "If yes, restore --audit-level=high. If no, extend the expiry date in this script."
  exit 1
fi

echo "Running audit with softened critical gate (Expires 2026-10-31)..."
npm audit --audit-level=critical