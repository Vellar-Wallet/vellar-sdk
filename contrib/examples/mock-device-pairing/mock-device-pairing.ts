// Example: a mock version of the extension device pairing flow — request,
// approve, then issue a session — for use in tests without a real
// extension. In-memory state only; no network or WebAuthn involved.
//
// Issuing a session for a pairing request that hasn't been approved yet
// returns a clear error rather than a session, the same way a real backend
// would refuse to hand out a session before the paired device confirms.
//
// Run with: npx tsx mock-device-pairing.ts

export type PairingStatus = "pending" | "approved";

export interface PairingRequest {
  requestId: string;
  deviceLabel: string;
  status: PairingStatus;
  requestedAt: string;
}

export interface PairedSession {
  requestId: string;
  sessionId: string;
  deviceLabel: string;
  issuedAt: string;
}

/** In-memory pairing authority: tracks requests by id and only issues a
 * session once the matching request has been approved. */
export function createMockPairingFlow() {
  const requests = new Map<string, PairingRequest>();
  let nextRequestSeq = 1;
  let nextSessionSeq = 1;

  return {
    /** Step 1: a device asks to be paired. Starts out "pending". */
    request(deviceLabel: string): PairingRequest {
      const pairingRequest: PairingRequest = {
        requestId: `req_${nextRequestSeq++}`,
        deviceLabel,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      requests.set(pairingRequest.requestId, pairingRequest);
      return pairingRequest;
    },

    /** Step 2: approve a pending request (e.g. confirmed from an already
     * paired device). Throws for an unknown request id. */
    approve(requestId: string): PairingRequest {
      const pairingRequest = requests.get(requestId);
      if (!pairingRequest) {
        throw new Error(`No pairing request with id "${requestId}"`);
      }
      pairingRequest.status = "approved";
      return pairingRequest;
    },

    /** Step 3: issue a session for an approved request. Throws — rather
     * than returning a session — if the request is unknown or still
     * pending approval. */
    issueSession(requestId: string): PairedSession {
      const pairingRequest = requests.get(requestId);
      if (!pairingRequest) {
        throw new Error(`No pairing request with id "${requestId}"`);
      }
      if (pairingRequest.status !== "approved") {
        throw new Error(`Pairing request "${requestId}" is not approved yet (status: "${pairingRequest.status}")`);
      }
      return {
        requestId,
        sessionId: `sess_${nextSessionSeq++}`,
        deviceLabel: pairingRequest.deviceLabel,
        issuedAt: new Date().toISOString(),
      };
    },
  };
}

function main() {
  const pairingFlow = createMockPairingFlow();

  console.log("Step 1: request pairing for 'Chrome extension on laptop'");
  const req = pairingFlow.request("Chrome extension on laptop");
  console.log(`  requestId=${req.requestId} status=${req.status}`);

  console.log("Step 2: issue a session before approval (should fail)");
  try {
    pairingFlow.issueSession(req.requestId);
  } catch (err) {
    console.log(`  error: ${(err as Error).message}`);
  }

  console.log("Step 3: approve the request");
  const approved = pairingFlow.approve(req.requestId);
  console.log(`  requestId=${approved.requestId} status=${approved.status}`);

  console.log("Step 4: issue the session now that it's approved");
  const session = pairingFlow.issueSession(req.requestId);
  console.log(`  sessionId=${session.sessionId} deviceLabel=${session.deviceLabel}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
