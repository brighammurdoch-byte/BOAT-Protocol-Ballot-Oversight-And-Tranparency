/**
 * Export verification_key.json into a compact byte blob for on-chain storage.
 * Usage: npx tsx scripts/export_vk_bytes.ts build/verification_key.json
 */
import fs from "fs";
import path from "path";

const src = process.argv[2] ?? "build/verification_key.json";
const raw = fs.readFileSync(src, "utf8");
const vk = JSON.parse(raw);
const outPath = path.join(path.dirname(src), "verification_key.bytes.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: "Feed into PrivateBallotConfig / groth16-solana once ceremony completes",
      protocol: vk.protocol,
      curve: vk.curve,
      nPublic: vk.nPublic,
      raw,
    },
    null,
    2
  )
);
console.log("Wrote", outPath);
