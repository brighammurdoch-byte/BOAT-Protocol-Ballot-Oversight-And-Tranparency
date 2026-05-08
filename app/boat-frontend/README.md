## BOAT web/PWA frontend

This is BOAT’s **static-export web UI**. It reads Solana RPC directly (no BOAT backend) and can be installed as a PWA.

For overall frontend status, see `../../FRONTEND_STATUS.md`.

## Getting Started

### Dev server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Static export (recommended for phone/PWA testing)

```bash
npm run build
```

This outputs a static site into `out/` (because `next.config.ts` sets `output: "export"`).

Serve it locally (example):

```bash
py -m http.server 5173 --directory out --bind 0.0.0.0
```

On mobile, wallet-connect works best inside a wallet’s in-app browser (Phantom/Solflare).

### Notes
- If you’re on public Wi-Fi, local LAN hosting may be blocked (client isolation). Use a hotspot or an HTTPS tunnel.
- The forum is a prototype backed by public Nostr relays, not on-chain storage.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
