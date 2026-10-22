# CSP Guidance for WebAuthn and Soroban RPC

This guide describes a minimum Content-Security-Policy (CSP) for an application
that embeds the Vellar passkey flow and talks to a Soroban RPC endpoint and a
wallet backend.

The policy is an application boundary, not an SDK default. Replace the example
origins with the exact RPC and backend origins used by the deployment. Keep the
allowlist as small as possible.

## Recommended Directives

- connect-src must allow the application origin, the configured Soroban RPC
  origin, and the facilitator or wallet-backend origin. This covers fetch, XHR,
  and other connection requests used during wallet setup, signing, and payment
  submission.
- frame-ancestors controls which parent pages may embed the application. Use
  'none' for a top-level app. If the passkey flow is intentionally embedded,
  replace it with the exact trusted parent origins.
- script-src should remain restricted to the application's own scripts. Do
  not add unsafe-inline or unsafe-eval just to make WebAuthn work.
- base-uri, object-src, and form-action reduce unrelated injection and
  navigation surfaces.
- worker-src should include self when the host application uses a worker. Add
  blob: only when the application's worker loader genuinely requires it.
- img-src and style-src should be narrowed to the application's actual asset
  sources. The example keeps them same-origin and allows data images.

WebAuthn itself is exposed through the browser credential APIs rather than a
network destination. The network destinations involved in the surrounding flow
still need to be present in connect-src, and the page must run in a secure
context such as HTTPS or localhost.

## Worked Example

The following header is suitable for a single-page app using Soroban testnet
and one wallet backend. Replace both example hosts before deployment:

~~~http
Content-Security-Policy:
  default-src 'self';
  base-uri 'none';
  object-src 'none';
  script-src 'self';
  connect-src 'self' https://soroban-testnet.stellar.org https://wallet-backend.example;
  img-src 'self' data:;
  style-src 'self';
  worker-src 'self';
  form-action 'self';
  frame-ancestors 'none';
~~~

If the application must be embedded by a known host, use an explicit
frame-ancestors value instead of a wildcard:

~~~http
frame-ancestors https://app.example;
~~~

Do not use frame-ancestors * for a wallet or payment application.

## Deployment Checklist

1. List the exact Soroban RPC URL and backend or facilitator URL configured by
   the application.
2. Add only their origins to connect-src; do not add full paths or broad
   wildcard domains unless the deployment requires them.
3. Decide whether the app is top-level or embedded and set frame-ancestors
   accordingly.
4. Serve the policy as an HTTP response header. A meta tag cannot express
   frame-ancestors reliably.
5. Roll out with Content-Security-Policy-Report-Only first if the application
   has not been audited, then enforce the policy after reviewing violations.
6. Verify passkey registration, assertion, RPC requests, and backend submission
   in a secure browser context.

## Maintainer Integration

This contributor document stays inside contrib/ so it can be reviewed without
changing protected source or website files. To publish the guidance as the
canonical documentation page, a maintainer should:

1. Move or adapt this content into
   website/content/docs/reference/csp-web-authn.md.
2. Link the page from the reference documentation navigation.
3. Replace the example RPC and backend origins with the deployment's configured
   hosts.
4. Add the final URL to the documentation index and verify the example header
   with the site's existing markdown or documentation checks.

The example is intentionally plain HTTP-header syntax so it can also be copied
into a reverse proxy or application server configuration.