# Quality Command Center migration baseline

Baseline verified 2026-09-03. This document records the starting point and boundaries for later migration plans; it does not authorize implementation or infrastructure changes.

## 1. Current-state inventory

**Source of truth.** The authoritative product is the local FastAPI Quality Command Center in `app.py`, `quality.py`, and `static/`. The separate `quality-command-center-site/` dashboard is a visual demo with hard-coded data, partial interactions, no API, authentication, or persistence, and is not a functional specification. The local SQLite database currently has the clearly labelled showcase dataset enabled; production will not inherit it.

**Repository and deployment.** The main repository is clean on local/GitHub `main` at `9a173f1`; `origin` is `https://github.com/dipeshonnet/QCCenter.git`. A gitignored nested repository, `quality-command-center-site/`, is clean on local `main` at `189bbea`, tracking `origin/netlify-site`. Its linked Netlify site ID is `053e5afa-4918-4d66-bc84-e925eecff8ee`; `netlify.toml` runs `npm run build`, publishes `dist`, applies basic headers, and rewrites all routes to `index.html`. The site URL, account plan, deploy status, and production-branch setting could not be verified without Netlify credentials.

**Runtime and UI.** FastAPI/Uvicorn serves both a vanilla HTML/CSS/JavaScript single-page frontend and JSON/file APIs from one localhost origin (`127.0.0.1:8765`). Chart.js, icons, and fonts are bundled. `quality.py` adds the Quality Command Center routes to `app.py`. Dependencies are pinned: FastAPI, Uvicorn, OpenPyXL, and multipart handling.

**Database and SQL.** `data/quality_randomizer.db` is a 335,872-byte SQLite WAL database. Startup runs idempotent `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` migrations. The 24 application tables group into:

- identity: `users`, `sessions`, `roles`, `user_roles`, `user_profiles`;
- organization/configuration: `accounts`, `account_config`, `processes`, `process_settings`, `app_settings`;
- sampling: `uploads`, `sampling_runs`, `sample_records`;
- scorecards/audits: `scorecard_versions`, `scorecard_items`, `audit_cases`, `audit_responses`, `audit_defects`;
- imports/CAPA/auditability: `result_imports`, `result_import_rows`, `capas`, `capa_events`, `audit_events`, `schema_migrations`.

The application uses synchronous `sqlite3` and hand-written SQL—parameterized values plus controlled dynamic filters/placeholder lists—with per-context commit/rollback. SQLite-specific behavior includes `PRAGMA`, `AUTOINCREMENT`, `?` parameters, `INSERT OR IGNORE`, integer booleans, text timestamps/JSON, `lastrowid`, collations, and the online backup API. There is no ORM or external migration tool.

**Authentication and authorization.** Passwords use per-user salts and PBKDF2-HMAC-SHA256 (420,000 iterations). A random session token is stored only as SHA-256 in `sessions`, expires after eight hours, and is sent as the HttpOnly `qsr_session` cookie. A readable `qsr_csrf` cookie must match `X-CSRF-Token` on authenticated mutations; setup/login are exempt. Cookies are SameSite Strict and currently non-Secure for localhost. API-side role checks enforce Administrator, QA Auditor, QA Reviewer, and Operations Manager. The browser also logs out after 30 minutes of inactivity; this is not a shorter server expiry.

**Files, exports, backup/restore.** Sampling accepts CSV/XLSX up to 25 MiB, stores a temporary file under `data/uploads`, hashes and records it, deletes it after a committed run, and expires ready uploads after 24 hours. Historical imports stage row JSON in SQLite. Run/manifest XLSX, quality-report XLSX, and import-error CSV are generated in memory and streamed; formula-leading strings are neutralized. `exports/` is reserved but unused. Logs and backups are local files. Startup creates at most one daily SQLite backup and retains seven automatic backups; manual backups are unpruned. Restore accepts only `.db`, checks integrity and required tables, creates a pre-restore backup, replaces the live database through SQLite backup APIs, then reapplies schema initialization.

**Tests.** `unittest` uses isolated temporary directories/databases. Eight recorded passing tests cover schema/roles, scorecard immutability, scoring and critical CAPA, sample-to-audit creation, atomic historical import failure, analytics/date bounds, capability/stability, and showcase isolation. The report also records browser verification and legacy coverage, but upload validation, authentication/CSRF, authorization permutations, export contents, backup/restore failure modes, concurrency, Postgres, Storage, and deployed end-to-end behavior need explicit automated coverage.

## 2. Target architecture and request/data flows

```text
Browser -> Netlify static frontend -> same-origin /api proxy -> Render FastAPI
                                                        |-> Supabase Postgres
                                                        `-> Supabase private Storage
```

Netlify will publish the real application frontend from GitHub `main`, not the demo. A same-origin `/api/*` proxy to Render is preferred so the existing cookie-session and double-submit CSRF semantics remain intact; otherwise sibling custom domains plus credentialed CORS must be proven. Render owns validation, authorization, business rules, transactions, analytics, signed/private object access, and export streaming. Postgres holds all relational/session/audit metadata. Private Storage holds temporary inputs, evidence or generated artifacts that must persist; object keys, not local paths, are stored in Postgres. Upload flow is browser → FastAPI → validated private object + metadata; commit is a Postgres transaction followed by governed object cleanup. Reads/analytics query Postgres. Downloads are streamed by FastAPI or use short-lived signed URLs after authorization. Backup/restore must cover database and Storage as separate assets.

## 3. Feature-parity checklist

- [ ] First-admin setup; login/logout; eight-hour server sessions; 30-minute UI inactivity; user/profile/role administration; API authorization; CSRF and security headers.
- [ ] Accounts, processes, sampling/coverage policies, mappings, targets, and system/showcase controls.
- [ ] Draft/version/publish/archive scorecards; published-version immutability; weighted, defect, critical-fail, and SLA scoring.
- [ ] CSV/XLSX upload, sheet/header inspection, mapping, filters, duplicate/blank/prior-sample handling, random/coverage selection, atomic commit, inventory, voiding, and run manifest export.
- [ ] Audit assignment/save/submit/reject/review lifecycle, evidence/notes, immutable history, and critical-finding CAPA creation.
- [ ] Historical-result preview/mapping/validation, all-or-nothing commit, duplicate protection, and error CSV.
- [ ] Yield/DPU/DPMO/sigma, p/u and I-MR charts, control-limit states/signals, Pareto, Cp/Cpk, filters, and date semantics.
- [ ] CAPA create/edit, ordered seven-stage transitions, evidence, due dates/priorities, event history, and closure.
- [ ] Quality XLSX and run XLSX outputs, formula-injection defense, audit log, backup listing/creation/validated restore, and pre-restore recovery point.
- [ ] Responsive UI, bundled/static assets, accessibility-critical interactions, browser compatibility, and actionable error/empty/loading states.

## 4. Migration constraints and major risks

- Complete behavioral and security parity is a release gate; endpoint or UI redesign must not silently remove capabilities.
- Production starts empty: translate schema/default roles/bootstrap only; do not copy any SQLite rows, accounts, users, sessions, uploads, backups, or showcase records.
- Raw SQL requires a reviewed Postgres conversion for types, constraints, placeholders, IDs/`RETURNING`, JSON, timestamps/time zones, collations, partial indexes, and transaction/concurrency behavior.
- Render's filesystem is ephemeral, so SQLite, uploads, logs, and backups cannot remain local. A storage failure must not leave committed metadata pointing to a missing object, or orphan objects after a failed transaction.
- Cross-site cookies would break SameSite Strict behavior. The Netlify proxy/domain design, `Secure` cookies, trusted origins, forwarded headers, CORS, and CSRF tests are mandatory.
- Free prototype limits are not production reliability: Render free services idle after 15 minutes, take about a minute to wake, have 750 workspace hours/month, may restart, and cannot use persistent disks; Supabase Free may pause after low activity, allows 500 MB database and 1 GB Storage/5 GB egress, and has no automatic database backups; Netlify's current credit Free plan has a hard 300-credit monthly limit, though this account may be legacy. Quota exhaustion or pausing can cause downtime. See [Render Free](https://render.com/docs/free), [Supabase pricing](https://supabase.com/pricing), [Supabase backups](https://supabase.com/docs/guides/platform/backups), and [Netlify credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).
- India/APAC optimization depends on selecting the closest mutually practical Render and Supabase regions and measuring end-to-end latency; free tiers provide no SLA, multi-region failover, PITR, or complete managed backup story. Database dumps and private Storage copies need an off-platform schedule, retention, encryption, restore drills, monitoring, and accepted RPO/RTO.

## 5. Locked decisions and account-owned values still needed

Locked: local Quality Command Center behavior is authoritative; target is Netlify + Render FastAPI + Supabase Postgres/private Storage; full parity; fresh production data; retain FastAPI authentication, roles, server sessions, and CSRF; eventual deployments come from GitHub `main`; optimize a no-cost India/APAC prototype while accepting documented limits.

Owners must supply/approve: Netlify team/site and plan, canonical/custom domains and DNS; Render workspace, service name, eligible region/plan, health-check and deploy settings; Supabase organization/project, region, database connection/pooler details, private bucket names and limits; GitHub access and branch protections; allowed origins; secret ownership/rotation; initial administrator provisioning; data classification/residency and retention; traffic/file-size forecasts; monitoring contacts; budget/upgrade triggers; and backup destination, cadence, retention, RPO/RTO, and restore authority.

## 6. Remaining planning-document responsibilities

- `01-data-storage.md`: Postgres DDL/migrations, seed/bootstrap, SQL conversion, Storage object model, lifecycle, and fresh-database procedure.
- `02-backend-security.md`: adapters, transactions, auth/session/CSRF preservation, proxy/CORS, uploads, exports, backup/restore, logging, and threat controls.
- `03-frontend-parity.md`: map every local screen/action/state to the Netlify frontend and remove reliance on demo data.
- `04-platform-operations.md`: GitHub-main deployment topology, regions, domains, secrets, quotas, health checks, observability, backups, recovery, cost triggers, and rollback.
- `05-verification-cutover.md`: traceable parity tests, migration rehearsals, security/performance/browser checks, fresh-production initialization, acceptance, cutover, and rollback gates.
