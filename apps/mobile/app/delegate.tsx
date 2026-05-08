import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { delegateVote } from "@boat/sdk";
import { parsePubkeyOrNull, withMobileWallet } from "../lib/solana";

export default function DelegateScreen() {
  const router = useRouter();
  const { election } = useLocalSearchParams<{ election?: string }>();
  const [electionStr, setElectionStr] = useState(election ?? "");
  const [delegateStr, setDelegateStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const electionKeyOrNull = useMemo(() => parsePubkeyOrNull(electionStr), [electionStr]);
  const delegateKeyOrNull = useMemo(() => parsePubkeyOrNull(delegateStr), [delegateStr]);

  const submit = useCallback(async () => {
    setErr(null);
    setResult("");
    setBusy(true);
    try {
      const electionKey = electionKeyOrNull;
      const delegateKey = delegateKeyOrNull;
      if (!electionKey) throw new Error("Election address required.");
      if (!delegateKey) throw new Error("Delegate voter pubkey required.");

      const out = await withMobileWallet(async ({ connection, wallet }) => {
        return await delegateVote(connection, wallet, electionKey, delegateKey);
      });

      setResult(JSON.stringify({ signature: out.signature }, null, 2));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [delegateKeyOrNull, electionKeyOrNull]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Delegate vote</Text>
      <Text style={styles.sub}>
        You must be registered and not have voted yet. The delegate must also be registered.
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

      <Text style={styles.label}>Delegate voter pubkey (base58)</Text>
      <TextInput
        style={styles.input}
        placeholder="Delegate wallet address"
        placeholderTextColor="#64748b"
        value={delegateStr}
        onChangeText={setDelegateStr}
        autoCapitalize="none"
      />

      <Pressable
        style={styles.btn}
        disabled={busy || !electionKeyOrNull || !delegateKeyOrNull}
        onPress={submit}
      >
        <Text style={styles.btnText}>{busy ? "Submitting…" : "Delegate"}</Text>
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
  sub: { color: "#94a3b8", marginBottom: 8, fontSize: 12 },
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

