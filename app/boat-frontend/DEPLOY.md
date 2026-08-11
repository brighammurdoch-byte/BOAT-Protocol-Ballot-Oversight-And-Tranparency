# BOAT web (static export)
#
# Local:
#   NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com npm run build
#   npx serve out
#
# Vercel (from this directory, requires `vercel login`):
#   npx vercel --prod --yes
#   Ensure NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com in project env.
#   Root directory in Vercel project settings: app/boat-frontend
#
# GitHub Pages (CI):
#   Workflow `.github/workflows/deploy-web.yml` builds the static `out/` folder
#   on push to `main` / `cursor/**` (or workflow_dispatch).
#   One-time repo setup (Settings → Pages → Source: GitHub Actions).
#   Agents cannot enable Pages via API without `pages: write` on the token.
#
# After Pages is enabled, expected URL shape:
#   https://<owner>.github.io/<repo>/
#   (or the custom domain configured in Pages settings)
