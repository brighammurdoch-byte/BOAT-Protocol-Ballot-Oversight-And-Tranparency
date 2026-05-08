import { PublicKey, clusterApiUrl, Connection, Transaction } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";

export function devnetConnection() {
  return new Connection(clusterApiUrl("devnet"), "confirmed");
}

export async function withMobileWallet<T>(
  fn: (args: { connection: Connection; publicKey: PublicKey; wallet: any }) => Promise<T>
): Promise<T> {
  const connection = devnetConnection();
  return await transact(async (mobileWallet) => {
    const auth = await mobileWallet.authorize({
      cluster: "devnet",
      identity: { name: "BOAT", uri: "https://boatprotocol.org" },
    });
    const addr = auth.accounts[0]?.address;
    if (!addr) throw new Error("No wallet account returned by authorize().");
    const publicKey = new PublicKey(Buffer.from(addr, "base64"));

    const wallet = {
      publicKey,
      signTransaction: async (tx: Transaction) => {
        const [signed] = await mobileWallet.signTransactions({ transactions: [tx] });
        return signed;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        return await mobileWallet.signTransactions({ transactions: txs });
      },
    };

    return await fn({ connection, publicKey, wallet });
  });
}

export function parsePubkeyOrNull(s: string): PublicKey | null {
  const raw = s.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

