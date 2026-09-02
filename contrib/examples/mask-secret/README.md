# Mask Secret Key Example (#113)

Provides a lightweight, safe utility `maskSecret` that masks all but the first few characters of a secret key string (such as a Stellar secret seed starting with `S`). Suitable for safe logging without exposing sensitive key material in stdout or telemetry.

## Examples & Expected Outputs

| Input Secret Key | Visible Chars | Masked Output for Safe Logging |
| --- | --- | --- |
| `SD4V5Q7Z3X8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G` | 4 (Default) | `SD4V****************************************************` |
| `SBXZ9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA9876` | 4 (Default) | `SBXZ****************************************************` |
| `SBXZ9876543210` | 2 | `SB****************` |
| `S123` | 4 | `****` (Fully masked to prevent leaks) |

## Run it

```sh
npx tsx contrib/examples/mask-secret/mask-secret.ts
```

## Tests

```sh
npx vitest run contrib/examples/mask-secret
```
