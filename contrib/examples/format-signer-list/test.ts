import { formatSignerList } from "./index";

console.log("format-signer-list tests:");

{
  const result = formatSignerList([]);
  console.assert(result.lines.length === 1 && result.lines[0] === "No signers", "expected empty message");
  console.log("ok: empty array → no signers");
}

{
  const signers = [
    { key: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", type: "ed25519", weight: 1 },
    { key: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", type: "ed25519", weight: 5 },
    { key: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", type: "sha256", weight: 3 },
  ];

  const result = formatSignerList(signers);
  console.assert(result.signers[0].weight === 5, "expected highest weight first");
  console.assert(result.signers[1].weight === 3, "expected mid weight second");
  console.assert(result.signers[2].weight === 1, "expected lowest weight last");
  console.log("ok: sort by weight desc");
  console.log(result.lines.join("\n"));
}

console.log("format-signer-list tests passed");