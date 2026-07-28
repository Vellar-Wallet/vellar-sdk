import { describe, expect, it } from "vitest";
import { createMockPairingFlow } from "./mock-device-pairing";

describe("createMockPairingFlow", () => {
  it("starts a request as pending", () => {
    const flow = createMockPairingFlow();
    const req = flow.request("Test device");
    expect(req.status).toBe("pending");
    expect(req.deviceLabel).toBe("Test device");
  });

  it("issuing a session before approval throws instead of returning a session", () => {
    const flow = createMockPairingFlow();
    const req = flow.request("Test device");
    expect(() => flow.issueSession(req.requestId)).toThrow(/not approved yet/);
  });

  it("approve marks a pending request as approved", () => {
    const flow = createMockPairingFlow();
    const req = flow.request("Test device");
    const approved = flow.approve(req.requestId);
    expect(approved.status).toBe("approved");
  });

  it("issues a session for an approved request", () => {
    const flow = createMockPairingFlow();
    const req = flow.request("Test device");
    flow.approve(req.requestId);
    const session = flow.issueSession(req.requestId);
    expect(session.requestId).toBe(req.requestId);
    expect(session.deviceLabel).toBe("Test device");
    expect(session.sessionId).toBeTruthy();
  });

  it("approve throws for an unknown request id", () => {
    const flow = createMockPairingFlow();
    expect(() => flow.approve("does-not-exist")).toThrow(/No pairing request/);
  });

  it("issueSession throws for an unknown request id", () => {
    const flow = createMockPairingFlow();
    expect(() => flow.issueSession("does-not-exist")).toThrow(/No pairing request/);
  });

  it("issues distinct session ids for separate approved requests", () => {
    const flow = createMockPairingFlow();
    const reqA = flow.request("Device A");
    const reqB = flow.request("Device B");
    flow.approve(reqA.requestId);
    flow.approve(reqB.requestId);
    const sessionA = flow.issueSession(reqA.requestId);
    const sessionB = flow.issueSession(reqB.requestId);
    expect(sessionA.sessionId).not.toBe(sessionB.sessionId);
  });

  it("keeps requests from separate flow instances independent", () => {
    const flowA = createMockPairingFlow();
    const flowB = createMockPairingFlow();
    const req = flowA.request("Device A");
    expect(() => flowB.approve(req.requestId)).toThrow(/No pairing request/);
  });
});
