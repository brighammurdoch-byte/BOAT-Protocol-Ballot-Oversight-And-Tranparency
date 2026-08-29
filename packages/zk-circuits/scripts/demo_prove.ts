/**
 * Tiny offline prove demo (dev binder proof).
 * Usage: npm run demo:prove
 */
import { buildPrivateBallot, summarizePackage, bytes32ToHex } from "../src/index.js";

const election = new Uint8Array(32);
crypto.getRandomValues(election);

const secrets = Array.from({ length: 5 }, (_, i) => `usu-voter-${i}`);
const pkg = buildPrivateBallot({
  secret: secrets[0],
  electionPubkey: election,
  outcomeIndex: 1,
  electorateSecrets: secrets,
  leafIndex: 0,
});

console.log("Private ballot package (dev Groth16-shaped):");
console.log(summarizePackage(pkg));
console.log("electionId", bytes32ToHex(pkg.electionId));
console.log("publicInputs", pkg.publicInputs.map(bytes32ToHex));
