# Office Operations SPA

The React (Vite) single-page app for the St. Lucie County Tax Collector **office
operations** surfaces — served at the CloudFront root (`/`). It hosts the
check-in desk, service-clerk dashboard, lobby display, citizen scheduling,
walk-in registration, prescreen, and appointment-management pages
(`src/pages/*`). Staff pages authenticate against Cognito; public pages
(scheduling, queue status, confirmation) do not.

## Develop

```bash
npm run dev      # Vite dev server on :5173, proxies /api to the office-ops backend on :3000
npm run build    # tsc -b && vite build → dist/ (packaged by the Chatbot CDK stack)
npm run lint     # oxlint
```

Run the office-ops backend alongside it (`npm -w @st-lucie/office-ops run dev`
from the repo root). See the root `README.md` for the full local-dev flow.

## Runtime configuration

This app is **runtime-config-driven**, not build-time-baked. At load it fetches
`/config.json` (Cognito pool/client ids + API base paths) rather than reading
`VITE_*` values — so the same built bundle works across environments. `config.json`
is written by CDK (`RuntimeConfig`) and `scripts/post-deploy.sh`. The shared UI
package `@st-lucie/ui` is consumed as raw `.tsx` source via a Vite alias +
tsconfig path (`vite.config.ts`), so changes there hot-reload without a rebuild.

## Deploy

Frontends deploy as part of the Chatbot CDK stack (CDK packages the `dist/`
directories). For a from-zero deploy follow the root [`infra/DEPLOY.md`](../infra/DEPLOY.md);
for a frontend-only push use `scripts/build-frontends.sh`.
