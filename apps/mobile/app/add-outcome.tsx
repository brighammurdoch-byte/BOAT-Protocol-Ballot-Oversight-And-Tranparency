import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PublicKey } from "@solana/web3.js";
import { addOutcome } from "@boat/sdk";
import { parsePubkeyOrNull, withMobileWallet } from "../lib/solana";

export default function AddOutcomeScreen() {
  const router = useRouter();
  const { election } = useLocalSearchParams<{ election?: string }>();
  const [electionStr, setElectionStr] = useState(election ?? "");
  const [label, setLabel] = useState("");
  const [indexStr, setIndexStr] = useState("0");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const electionKeyOrNull = useMemo(() => parsePubkeyOrNull(electionStr), [electionStr]);

  const submit = useCallback(async () => {
    setErr(null);
    setResult("");
    setBusy(true);
    try {
      const electionKey = electionKeyOrNull;
      if (!electionKey) throw new Error("Election address is required.");
      const outcomeIndex = Number(indexStr);
      if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 255) {
        throw new Error("Outcome index must be an integer 0-255.");
      }
      if (!label.trim()) throw new Error("Label is required.");

      const out = await withMobileWallet(async ({ connection, wallet }) => {
        return await addOutcome(connection, wallet, electionKey, label.trim(), outcomeIndex);
      });

      setResult(JSON.stringify({ signature: out.signature, outcome: out.outcome.toBase58() }, null, 2));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionKeyOrNull, indexStr, label]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Add outcome</Text>
      <Text style={styles.sub}>Authority-only; must be done before election start time.</Text>

      <Text style={styles.label}>Election (base58)</Text>
      <TextInput
        style={styles.input}
        placeholder="Election PDA"
        placeholderTextColor="#64748b"
        value={electionStr}
        onChangeText={setElectionStr}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Outcome index</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={indexStr}
        onChangeText={setIndexStr}
      />

      <Text style={styles.label}>Label</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Alice"
        placeholderTextColor="#64748b"
        value={label}
        onChangeText={setLabel}
      />

      <Pressable style={styles.btn} disabled={busy || !electionKeyOrNull} onPress={submit}>
        <Text style={styles.btnText}>{busy ? "Submitting…" : "Add outcome"}</Text>
      </Pressable>

      {result ? <Text style={styles.mono}>{result}</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}

      <Pressable style={[styles.btn, styles.secondary]} onPress={() => router.back()}>
        <Text style={styles.btnTextDark}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: "#0f172a", flexGrow: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  sub: { color: "#94a3b8", marginBottom: 8 },
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

