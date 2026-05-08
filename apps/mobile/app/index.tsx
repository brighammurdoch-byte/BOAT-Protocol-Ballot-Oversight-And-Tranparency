import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_BOAT_PROGRAM_ID,
  fetchVoterRegistriesForElection,
  tallyFromRegistries,
} from "@boat/sdk";
import { devnetConnection, withMobileWallet } from "../lib/solana";

export default function HomeScreen() {
  const connection = useMemo(() => devnetConnection(), []);
  const [wallet, setWallet] = useState<string | null>(null);
  const [electionStr, setElectionStr] = useState("");
  const [tallyText, setTallyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const electionKeyOrNull = useMemo(() => {
    const raw = electionStr.trim();
    if (!raw) return null;
    try {
      return new PublicKey(raw);
    } catch {
      return null;
    }
  }, [electionStr]);

  const connect = useCallback(async () => {
    setErr(null);
    try {
      await withMobileWallet(async ({ publicKey }) => {
        setWallet(publicKey.toBase58());
        return true;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadTally = useCallback(async () => {
    setErr(null);
    setTallyText("");
    setBusy(true);
    try {
      const election = electionKeyOrNull;
      if (!election) {
        throw new Error(
          "Paste a valid Election address first (a long base58 string)."
        );
      }
      const rows = await fetchVoterRegistriesForElection(
        connection,
        DEFAULT_BOAT_PROGRAM_ID,
        election
      );
      const acc = await connection.getAccountInfo(election);
      if (!acc) throw new Error("Election account not found.");
      const totalW = rows.reduce((s, r) => s + r.weight, 0n);
      const quorumPct = 33;
      const tally = tallyFromRegistries(rows, totalW, quorumPct);
      setTallyText(
        JSON.stringify(
          {
            totalsByCandidate: Object.fromEntries(
              Object.entries(tally.totalsByCandidate).map(([k, v]) => [
                k,
                v.toString(),
              ])
            ),
            votedWeight: tally.votedWeight.toString(),
            registeredWeight: tally.registeredWeight.toString(),
            quorumMet: tally.quorumMet,
            participationPct: tally.participationPct,
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
  }, [connection, electionKeyOrNull]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>BOAT</Text>
      <Text style={styles.sub}>
        Ballot Oversight and Transparency — local tally from RPC only.
      </Text>

      <Pressable style={styles.btn} onPress={connect}>
        <Text style={styles.btnText}>Connect (Mobile Wallet)</Text>
      </Pressable>
      {wallet ? (
        <Text style={styles.mono}>Wallet: {wallet}</Text>
      ) : null}

      <Text style={styles.label}>Election address</Text>
      <TextInput
        style={styles.input}
        placeholder="Election PDA base58"
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        value={electionStr}
        onChangeText={setElectionStr}
      />
      <Pressable
        style={styles.btn}
        onPress={loadTally}
        disabled={busy || !electionKeyOrNull}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Load tally (device-side)</Text>
        )}
      </Pressable>

      {tallyText ? (
        <Text style={styles.mono}>{tallyText}</Text>
      ) : null}

      {err ? <Text style={styles.err}>{err}</Text> : null}

      <Link
        href={{
          pathname: "/forum",
          params: electionStr.trim() ? { election: electionStr.trim() } : {},
        }}
        asChild
      >
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Election forum (Nostr)</Text>
        </Pressable>
      </Link>

      <Text style={[styles.label, { marginTop: 10 }]}>Actions</Text>
      <Link href="/create-election" asChild>
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Create / initialize election</Text>
        </Pressable>
      </Link>
      <Link
        href={{
          pathname: "/add-outcome",
          params: electionStr.trim() ? { election: electionStr.trim() } : {},
        }}
        asChild
      >
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Add outcome (candidate)</Text>
        </Pressable>
      </Link>
      <Link
        href={{
          pathname: "/register",
          params: electionStr.trim() ? { election: electionStr.trim() } : {},
        }}
        asChild
      >
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Register voter</Text>
        </Pressable>
      </Link>
      <Link
        href={{
          pathname: "/vote",
          params: electionStr.trim() ? { election: electionStr.trim() } : {},
        }}
        asChild
      >
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Cast vote</Text>
        </Pressable>
      </Link>
      <Link
        href={{
          pathname: "/delegate",
          params: electionStr.trim() ? { election: electionStr.trim() } : {},
        }}
        asChild
      >
        <Pressable style={[styles.btn, styles.secondary]}>
          <Text style={styles.btnTextDark}>Delegate vote</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: "#0f172a", flexGrow: 1 },
  title: { fontSize: 28, fontWeight: "700", color: "#f8fafc" },
  sub: { color: "#94a3b8", marginBottom: 8 },
  label: { color: "#cbd5e1", fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    padding: 12,
    color: "#f8fafc",
    fontFamily: "monospace",
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
