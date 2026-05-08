import { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  NostrForumClient,
  BOAT_ELECTION_TAG,
  DEFAULT_FORUM_RELAYS,
} from "@boat/sdk";
import { generateSecretKey } from "nostr-tools";

export default function ForumScreen() {
  const { election } = useLocalSearchParams<{ election?: string }>();
  const [electionStr, setElectionStr] = useState(election ?? "");
  const [body, setBody] = useState("");
  const [posts, setPosts] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const client = new NostrForumClient(DEFAULT_FORUM_RELAYS);
      const list = await client.listPosts(electionStr.trim());
      client.close();
      setPosts(JSON.stringify(list, null, 2));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [electionStr]);

  const post = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const sk = generateSecretKey();
      const client = new NostrForumClient(DEFAULT_FORUM_RELAYS);
      await client.publish(sk, electionStr.trim(), body);
      client.close();
      setBody("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [body, electionStr, load]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Forum</Text>
      <Text style={styles.sub}>
        Tag &quot;{BOAT_ELECTION_TAG}&quot; plus election address. Relays:{" "}
        {DEFAULT_FORUM_RELAYS.join(", ")}
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
      <Pressable style={styles.btn} onPress={load} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Refresh</Text>
        )}
      </Pressable>
      <Text style={styles.label}>New post</Text>
      <TextInput
        style={[styles.input, { minHeight: 100 }]}
        multiline
        placeholder="Proposal / discussion"
        placeholderTextColor="#64748b"
        value={body}
        onChangeText={setBody}
      />
      <Pressable style={styles.btn} onPress={post} disabled={busy}>
        <Text style={styles.btnText}>Publish (new Nostr key)</Text>
      </Pressable>
      {posts ? <Text style={styles.mono}>{posts}</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: "#0f172a", flexGrow: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  sub: { color: "#94a3b8", fontSize: 13 },
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
  btnText: { color: "#fff", fontWeight: "600" },
  mono: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 11 },
  err: { color: "#fca5a5" },
});
