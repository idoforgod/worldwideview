# ADR-001 Pre-flight Audit — 2026-05-21

**Auditor:** Claude (ADR-001 Local App workstream) &nbsp; **Branch:** `feat/adr-001-local-app`  
**Status:** Complete — see gate summary in §6

This document records the six step-0 checklist items from the master deploy plan
(`i-want-you-to-delightful-candle.md`, §"Deploy Order") before any ADR-001 code
lands on production.

---

## 1. Coolify Env-Var Audit

Swept every `JWT_*`, `TICKET_*`, `JWKS_*`, and `AUTH_*` variable across the three
live services. Values are masked; only presence is recorded.

### Debris check

| Service | Coolify resource | `JWT_*` | `TICKET_*` | `JWKS_*` | `AUTH_SECRET` | Decision |
|---|---|---|---|---|---|---|
| Local App | `worldwideview-demo` | — | — | — | ✓ set | nothing to remove |
| Data Engine | `wwv-engine-stack` | — | — | — | — | nothing to remove |
| Marketplace | `worldwideview-marketplace` | — | — | — | — | nothing to remove |

**Result: No debris from the previous failed deploy.** All three services are clean.
No removals required.

### ADR-001 vars — gaps to fill in deploy steps 1–2

| Service | Missing var | Required by | When to set | Notes |
|---|---|---|---|---|
| `worldwideview-demo` | `ENCRYPTION_MASTER_KEY` | **C1 hard gate** | **Step 1 — first action** | Without it the app boots but step-1 code will refuse to start |
| `worldwideview-demo` | `MARKETPLACE_URL` | C3 ticketClient | Step 1 | Server-side token exchange endpoint |
| `worldwideview-demo` | `NEXT_PUBLIC_WWV_MARKETPLACE_URL` | C3/C5 client | Step 1 | Client-side Marketplace link |
| `worldwideview-demo` | `PROXY_HOST_ALLOWLIST` | C2 SSRF | Step 1 | Set to `"*"` (observation mode); tighten in step 7c |
| `worldwideview-demo` | `NEXT_PUBLIC_WWV_TICKET_AUTH_PLUGINS` | C5 flag | Step 6 | Leave empty (dormant) until step 6 cutover |
| `worldwideview-marketplace` | `DATABASE_URL`, `AUTH_SECRET` | A basics | Step 2 | Marketplace cannot function without these |
| `worldwideview-marketplace` | EdDSA signing key + JWKS endpoint | A1–A2 | Step 2 | Required for `/api/auth/exchange` to sign tickets |
| `wwv-engine-stack` | JWKS / JWT public-key config | B JWKS wiring | Step 4 | See §5 — not blocking until cutover |

---

## 2. Data Engine `main` Branch State

**Repo:** `silvertakana/wwv-data-engine`  
**Branch audited:** `main` (HEAD matches `feat/adr-001-data-engine`)

The `main` branch is **not** in a rolled-back clean state. The decentralised auth
work from the prior attempt was **retained and fully merged** (PR #5
`feature/decentralised-plugin-auth-data-engine`, PR #6 `chore/standardise-ci`), with
four additional fix commits on top.

**Auth code present in `main`:**

- Dependencies: `@fastify/jwt ^10`, `get-jwks ^11`, `jose ^6`
- `websocket.ts` verifies EdDSA JWTs:
  ```
  allowedIss: 'https://marketplace.worldwideview.dev'
  algorithms: ['EdDSA']
  clockTolerance: 60
  expectedAud: process.env.ENGINE_ID || 'wwv-data-engine'
  ```

**Env-gated bypass (commit `e3e2940`):**  
`WWV_SKIP_WS_AUTH=true` is set on `wwv-engine-stack`. When true, every WS connection
is pre-authenticated with no JWT required. **This bypass is currently load-bearing:**
the JWKS endpoint is not yet wired (`websocket.ts:23` comment confirms), so the
engine cannot verify real tokens. `WWV_SKIP_WS_AUTH=true` must stay until Workstream
B wires JWKS (deploy step 4).

**Uncommitted working-tree WIP (not blocking steps 1–3):**  
`src/server.ts`, `src/websocket.ts`, `src/websocket.spec.ts` modified; untracked
`HANDOFF.md`, `src/startup-checks.ts`, `vitest.config.ts`. The Data Engine
workstream has unfinished work not yet committed. Must be resolved before step 4.

---

## 3. Dormant Routes / Flags Already in Production

| Flag / Route | Service | Current value | Introduced | Notes |
|---|---|---|---|---|
| `WWV_SKIP_WS_AUTH` | `wwv-engine-stack` | `true` (load-bearing) | 2026-05-20 | Engine bypass — must stay `true` until JWKS wired (step 4) |

No other ADR-001 feature flags are active in production. The old no-auth data path
is still the only path through the Data Engine.

---

## 4. `ENCRYPTION_MASTER_KEY` Gate (C1)

**Status: FAIL — not set on `worldwideview-demo`**

The `ENCRYPTION_MASTER_KEY` env var is absent from the live Local App. Once
`src/instrumentation.ts` boot validation ships (deploy step 1), the app will
**refuse to start** if this var is missing.

**Action required before deploy step 1:**  
Generate a 32-character key (`openssl rand -hex 16`) and set `ENCRYPTION_MASTER_KEY`
on `worldwideview-demo` in Coolify. This is the **first action of deploy step 1** and
blocks all subsequent steps.

---

## 5. SDK Delivery Decision (Gate for Workstream B)

**Status: OPEN — operator to confirm**

No evidence of a published `@worldwideview/wwv-plugin-sdk` package in the deployed
services. The `auth-contracts.ts` types (`TokenExchangeRequest`,
`TokenExchangeResponse`, `PluginTicket`, `MarketplaceSessionToken`) currently live in
the Local App's bundled SDK package.

Workstream B JWKS wiring requires a decision on how the engine receives the
Marketplace public key:
- **Option A:** Ed25519 public key as a Coolify env var (simplest)
- **Option B:** Remote JWKS URL env var — engine fetches key from
  `https://marketplace.worldwideview.dev/.well-known/jwks.json` at startup

**Cross-repo issuer alignment note:** The engine hard-codes
`allowedIss: 'https://marketplace.worldwideview.dev'`. The Local App's `MARKETPLACE_URL`
config defaults to `https://app.worldwideview.dev`. Confirm that the live Marketplace
issues JWTs with `iss: https://marketplace.worldwideview.dev` before step 5 smoke test.

This decision must be made and documented before deploy step 4.

---

## 6. Gate Summary

| Gate | Status | Blocks deploy step | Action |
|---|---|---|---|
| No legacy JWT/TICKET debris | ✅ PASS | — | None |
| `ENCRYPTION_MASTER_KEY` set on Local App | ❌ FAIL | **Step 1** | Set as first action of step 1 |
| Marketplace configured (DB, auth, signing key) | ❌ FAIL | **Step 2** | Configure `worldwideview-marketplace` in Coolify |
| SDK delivery decision confirmed | ⚠️ OPEN | Step 4 | Operator decision needed |
| Data Engine JWKS wired | ❌ FAIL | Step 4 / cutover | `WWV_SKIP_WS_AUTH` bypass active until then |
| Data Engine WIP committed | ⚠️ OPEN | Step 4 | Not blocking steps 1–3 |
| Issuer alignment confirmed | ⚠️ OPEN | Step 5 smoke test | Verify `iss` claim matches engine `allowedIss` |

**Top pre-cutover risks:**

1. **JWKS not wired on the engine** — `WWV_SKIP_WS_AUTH=true` is the only thing
   keeping streams alive. If this flag is ever accidentally unset, all WebSocket
   streams break immediately.
2. **Marketplace under-configured** — token exchange will error until step 2 env vars
   are set. `worldwideview-marketplace` currently has only infra vars (NIXPACKS,
   REDIS, REGISTRY_PRIVATE_KEY).
3. **`ENCRYPTION_MASTER_KEY` missing** — deploy step 1 will trigger a boot refusal
   if not set first. This is the riskiest item in the pre-cutover phase per the
   master plan.

---

## 7. Cleanup Log

**Removed this step (2026-05-21):**

| Resource | Type | UUID | Reason |
|---|---|---|---|
| `wwv-app-stack` | Coolify service | `h3gtnyotl6b7007hudlfqyf9` | Operator-confirmed deprecated |

**Remaining cleanup decisions (operator to confirm before step 4):**

| Resource | Type | UUID | Notes |
|---|---|---|---|
| `worldwideview web` | Application | `cisr3bruyyvvoeym41dexxa3` | Repo `silvertakana/worldwideview-web`; only REDIS+AISSTREAM vars — appears stale. Verify before removing. |
| `wwv-data-engine-legacy` | Application | `sj8519kr561va8ktcdq166hn` | Repo `wwv-data-engine-internal`, branch `master`; appears superseded by `wwv-engine-stack`. Verify before removing. |
