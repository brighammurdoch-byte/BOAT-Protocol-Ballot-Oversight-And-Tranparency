import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { initializeElection } from "@boat/sdk";
import { withMobileWallet } from "../lib/solana";

export default function CreateElectionScreen() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startTs, setStartTs] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [endTs, setEndTs] = useState(() =>
    String(Math.floor(Date.now() / 1000) + 60 * 60)
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const create = useCallback(async () => {
    setErr(null);
    setResult("");
    setBusy(true);
    try {
      const startTime = Number(startTs);
      const endTime = Number(endTs);
      if (!title.trim()) throw new Error("Title is required.");
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime))
        throw new Error("Start/end must be unix timestamps in seconds.");
      if (endTime <= startTime) throw new Error("End time must be after start time.");

      const out = await withMobileWallet(async ({ connection, wallet }) => {
        return await initializeElection(connection, wallet, {
          title: title.trim(),
          startTime,
          endTime,
        });
      });

      setResult(
        JSON.stringify(
          {
            signature: out.signature,
            election: out.election.toBase58(),
            electionConfig: out.electionConfig.toBase58(),
            sbtMint: out.sbtMint.toBase58(),
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
  }, [endTs, startTs, title]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create election</Text>
      <Text style={styles.sub}>
        Initializes election + config + SBT mint PDAs on devnet.
      </Text>

      <Text style={styles.label}>Title (seeded into PDA)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Student Senate 2026"
        placeholderTextColor="#64748b"
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>Start time (unix seconds)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={startTs}
        onChangeText={setStartTs}
      />

      <Text style={styles.label}>End time (unix seconds)</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={endTs}
        onChangeText={setEndTs}
      />

      <Pressable style={styles.btn} disabled={busy} onPress={create}>
        <Text style={styles.btnText}>{busy ? "Creating…" : "Create election"}</Text>
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

