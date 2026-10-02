# Non-throwing token amount parsing

This example addresses issue #430 within the contributor sandbox. It provides a UI-friendly parser that returns a discriminated result instead of throwing for malformed user input.

## Behavior

- ok: true returns the integer token units as value.
- ok: false returns a machine-readable reason and display-ready message.
- Reasons distinguish empty, not-a-number, negative, too-many-decimals, and zero.
- Invalid decimal configuration remains a RangeError, because it is a programmer configuration error.
- Values with exactly the token precision are accepted without rounding.

## Integration recipe

The core SDK can promote this implementation into src/payments.ts after maintainer review. The throwing parser should delegate to the non-throwing parser so both APIs share one validation path, and tryParseTokenAmount should be added to the canonical stable export list.

Run the example test with the repository test runner after copying or promoting the implementation.