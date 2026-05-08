import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PublicKey } from "@solana/web3.js";
import { registerVoter, selfRegisterVoter } from "@boat/sdk";
import { parsePubkeyOrNull, withMobileWallet } from "../lib/solana";

export default function RegisterScreen() {
  const router = useRouter();
  const { election } = useLocalSearchParams<{ election?: string }>();
  const [electionStr, setElectionStr] = useState(election ?? "");
  const [voterStr, setVoterStr] = useState("");
  const [weightStr, setWeightStr] = useState("0");
  const [merkleProofHex, setMerkleProofHex] = useState(""); // comma-separated 64-byte hex? (32 bytes)
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const electionKeyOrNull = useMemo(() => parsePubkeyOrNull(electionStr), [electionStr]);
  const voterKeyOrNull = useMemo(() => parsePubkeyOrNull(voterStr), [voterStr]);

  const doRegisterByAuthority = useCallback(async () => {
    setErr(null);
    setResult("");
    setBusy(true);
    try {
      const electionKey = electionKeyOrNull;
      const voterKey = voterKeyOrNull;
      if (!electionKey) throw new Error("Election address required.");
      if (!voterKey) throw new Error("Voter public key required.");
      const w = BigInt(weightStr || "0");

      const out = await withMobileWallet(async ({ connection, wallet }) => {
        return await registerVoter(connection, wallet, electionKey, voterKey, w);
      });

      setResult(
        JSON.stringify(
          {
            signature: out.signature,
            voterRegistry: out.voterRegistry.toBase58(),
            voterTokenAccount: out.voterTokenAccount.toBase58(),
          },
          null,
          2
        )
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionKeyOrNull, voterKeyOrNull, weightStr]);

  const doSelfRegister = useCallback(async () => {
    setErr(null);
    setResult("");
    setBusy(true);
    try {
      const electionKey = electionKeyOrNull;
      if (!electionKey) throw new Error("Election address required.");

      const proof = parseMerkleProofCsvHex(merkleProofHex);
      const out = await withMobileWallet(async ({ connection, wallet }) => {
        return await selfRegisterVoter(connection, wallet, electionKey, proof);
      });

      setResult(
        JSON.stringify(
          {
            signature: out.signature,
            voterRegistry: out.voterRegistry.toBase58(),
            voterTokenAccount: out.voterTokenAccount.toBase58(),
          },
          null,
          2
        )
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionKeyOrNull, merkleProofHex]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Register</Text>
      <Text style={styles.sub}>
        Two modes: authority registers a voter (any policy) or self-register (OPEN/MERKLE only).
      </Text>

      <Text style={styles.label}>Election (base58)</Text>
      <TextInput
        style={styles.input}
        placeholder="Election PDA"
        placeholderTextColor="#64748b"
        value={electionStr}
        onChangeText={setElectionStr}
        autoCapitalize="none"
      />

      <Text style={[styles.label, { marginTop: 8 }]}>Authority registers voter</Text>
      <TextInput
        style={styles.input}
        placeholder="Voter pubkey (base58)"
        placeholderTextColor="#64748b"
        value={voterStr}
        onChangeText={setVoterStr}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Weight (u64). 0 = default weight"
        placeholderTextColor="#64748b"
        value={weightStr}
        onChangeText={setWeightStr}
        autoCapitalize="none"
      />
      <Pressable
        style={styles.btn}
        disabled={busy || !electionKeyOrNull || !voterKeyOrNull}
        onPress={doRegisterByAuthority}
      >
        <Text style={styles.btnText}>{busy ? "Submitting…" : "Register voter (authority)"}</Text>
      </Pressable>

      <Text style={[styles.label, { marginTop: 12 }]}>Self-register (connected wallet)</Text>
      <Text style={styles.sub}>
        For MERKLE mode: paste proof nodes as comma-separated hex (32 bytes each). For OPEN mode, leave empty.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="proof0hex,proof1hex,... (optional)"
        placeholderTextColor="#64748b"
        value={merkleProofHex}
        onChangeText={setMerkleProofHex}
        autoCapitalize="none"
      />
      <Pressable
        style={styles.btn}
        disabled={busy || !electionKeyOrNull}
        onPress={doSelfRegister}
      >
        <Text style={styles.btnText}>{busy ? "Submitting…" : "Self-register"}</Text>
      </Pressable>

      {result ? <Text style={styles.mono}>{result}</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}

      <Pressable style={[styles.btn, styles.secondary]} onPress={() => router.back()}>
        <Text style={styles.btnTextDark}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

function parseMerkleProofCsvHex(raw: string): Uint8Array[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((part) => hexToBytes(part.trim()));
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.toLowerCase().replace(/^0x/, "");
  if (h.length !== 64) throw new Error("Each proof node must be 32 bytes hex (64 chars).");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: "#0f172a", flexGrow: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  sub: { color: "#94a3b8", marginBottom: 4, fontSize: 12 },
  label: { color: "#cbd5e1", fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    padding: 12,
    color: "#f8fafc",
  },
  btn: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  secondary: { backgroundColor: "#e2e8f0" },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: "#0f172a", fontWeight: "600" },
  mono: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 12 },
  err: { color: "#fca5a5" },
});

