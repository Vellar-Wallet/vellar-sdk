import { createMockPolicyAttachRuntime } from "./index";

console.log("mock-policy-attach tests:");

{
  const attach = createMockPolicyAttachRuntime();

  const hash = await attach.attachPolicy("CINSTANCE");
  console.assert(hash.hash.length > 0, "expected non-empty hash");
  console.log("ok: attachPolicy returns a fixed hash:", hash.hash);
}

{
  const attach = createMockPolicyAttachRuntime({ hash: "custom-tx-123" });

  const hash = await attach.attachPolicy("CINSTANCE");
  console.assert(hash.hash === "custom-tx-123", "expected custom hash");
  console.log("ok: custom hash returned");
}

{
  const attach = createMockPolicyAttachRuntime();
  const resume = await attach.resume!("some-key-id");
  console.assert(resume === undefined, "resume should resolve void");
  console.log("ok: resume is a no-op");
}

console.log("mock-policy-attach tests passed");