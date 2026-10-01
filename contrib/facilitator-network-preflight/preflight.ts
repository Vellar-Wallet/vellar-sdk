export interface SupportedResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SupportedFetch = (url: string) => Promise<SupportedResponse>;

export async function assertFacilitatorNetwork(
  fetchImpl: SupportedFetch,
  facilitatorUrl: string,
  configuredNetwork: string,
  configuredNetworkId: string,
): Promise<void> {
  const response = await fetchImpl(new URL("/supported", facilitatorUrl).toString());
  if (!response.ok) {
    throw new Error(`facilitator /supported returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { networks?: unknown }).networks) ||
    (payload as { networks: unknown[] }).networks.some((network) => typeof network !== "string")
  ) {
    throw new Error("facilitator /supported returned an invalid networks list");
  }

  const networks = (payload as { networks: string[] }).networks;
  if (!networks.includes(configuredNetworkId)) {
    throw new Error(
      `Facilitator network mismatch: configured network "${configuredNetwork}" ` +
        `(${configuredNetworkId}), but facilitator advertised: ${networks.join(", ") || "(none)"}. ` +
        "Nothing was signed.",
    );
  }
}

export async function preflightThenSign<T>(
  fetchImpl: SupportedFetch,
  facilitatorUrl: string,
  configuredNetwork: string,
  configuredNetworkId: string,
  sign: () => Promise<T>,
): Promise<T> {
  await assertFacilitatorNetwork(
    fetchImpl,
    facilitatorUrl,
    configuredNetwork,
    configuredNetworkId,
  );
  return sign();
}