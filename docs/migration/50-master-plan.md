# Quality Command Center migration master plan

Status: decision-complete implementation and cutover plan, verified against the repository on 2026-09-03. The current FastAPI application in `app.py`, `quality.py`, and `static/` is authoritative. Its 24 SQLite tables, 57 HTTP routes (root plus 56 API routes), four roles, PBKDF2/session/CSRF behavior, file flows, and nine current test methods were checked. `TEST_REPORT.md`'s count of eight tests is stale. This plan imports **no SQLite data**. Keep `data/quality_randomizer.db` and its WAL/SHM files read-only, checksummed, access-controlled, and undeployed as a rollback/reference artifact.

## 1. Final architecture and boundaries

```text
Browser -> Netlify CDN/Vite app -> signed same-origin /api proxy -> Render FastAPI web
                                                               |-> Supabase Postgres
                                                               `-> private Supabase Storage
                                             Render worker <---- Postgres job leases
                 Render backup cron -> direct Postgres -> encrypted AWS S3 recovery bucket
```

- **Netlify** serves only the real frontend moved from `static/`; the nested `quality-command-center-site/` mock is never imported. It owns TLS, static caching/headers, SPA fallback, and the forced signed proxy. It contains no API URL, Supabase URL/key, or business logic.
- **FastAPI web** owns validation, authentication, authorization, CSRF/origin/proxy checks, business rules, transactions, audit events, upload parsing, and authorized download redirects. It is stateless and never migrates or seeds at startup.
- **Postgres** is authoritative for identity, sessions, configuration, sampling, audits, defects, CAPA, job state, and audit/recovery metadata. Services own transactions; repositories only issue SQLAlchemy statements.
- **Storage** holds short-lived private ingest and export objects only. `StorageService` alone accepts object keys; browsers never receive a Supabase key or ingest URL.
- **Worker** claims export/cleanup jobs with `FOR UPDATE SKIP LOCKED`, lease/heartbeat/retry semantics, creates exports, and reconciles metadata/objects every 15 minutes. One paid worker is required in staging and production.
- **Backup cron** is a separate privileged Render cron job, runs every 15 minutes to service manual requests and creates one nightly recovery point. Only it receives `DIRECT_DATABASE_URL`, backup destination credentials, encryption key, and Supabase management token.
- Use paid `1c-2g`, one instance/one process for both staging and production web and worker in Singapore. A free web-only prototype is permitted but is not a release environment.

## 2. Final data, Storage, identity, and edge contracts

Postgres uses `public`, `extensions.citext`, `bigint ... identity`, native `boolean`, `bytea`, `jsonb`, `date`, `double precision`, and UTC `timestamptz`. Alembic owns schema state. Revision `0001_postgres_schema` creates the 23 current domain tables described in `10-database.md` (all except legacy `schema_migrations`) with its named checks, foreign keys, cascades/`SET NULL`, indexes, and partial unique constraints; `0002_seed_roles` idempotently inserts Administrator, QA Auditor, QA Reviewer, and Operations Manager. `0001` transforms uploads as follows; `0003_async_jobs_recovery` adds the job/recovery tables:

- `uploads.created_by`, `last_error`, `deleted_at`, status `READY|USED|EXPIRED|ERROR`, and `object_key` instead of `stored_path`;
- `export_jobs(job_id, kind, parameters jsonb, entity_id, requester, object_key, sha256, size_bytes, status, error_code, attempts, lease_owner, lease_expires_at, created_at, ready_at, expires_at)`, with `PENDING|RUNNING|READY|FAILED|EXPIRED` and idempotency uniqueness on requester/kind/normalized parameters while active;
- `backup_jobs(job_id, requested_by, status, error_code, attempts, created_at, started_at, completed_at)` and `recovery_points(id, type, status, object_key, size_bytes, sha256, schema_revision, created_at, expires_at, provider_window jsonb)`.

All mutations and their `audit_events` commit together at READ COMMITTED. Lock first-admin, process scorecard allocation/publish, upload/run eligibility, audit/import/CAPA transitions, and job claims; unique constraints arbitrate duplicates. Map SQLSTATE `23505` to current 409, `23503` to 404/409, `23514`/`23502`/class 22 to 400, stale state to 409, dependency/timeout to 503, and unknown faults to 500 plus correlation ID. Retry a deadlock/serialization failure at most twice only for idempotent commands.

Storage buckets per environment are private: `qcc-ingest` (CSV/XLSX, 25 MiB) and `qcc-export-temp` (CSV/XLSX, 50 MiB). Keys are immutable and server-generated: `v1/ingest/YYYY/MM/DD/{upload_id}.{ext}` and `v1/exports/{kind}/YYYY/MM/DD/{job_id}.{ext}`; no names/user data and no upsert. Uploads stream through a bounded OS spool, hash and validate extension/MIME/container/encoding, non-empty content, 25 MiB, 200,000 rows, and 250 columns before object creation. Insert failure deletes the object; reconciliation handles orphans. Ready inputs and exports expire in 24 hours; error/orphan bytes in one hour. Historical import bytes are never retained.

Keep FastAPI identity, not Supabase Auth: 16-byte salt, PBKDF2-HMAC-SHA256/420,000, 12–200 character new passwords, 256-bit session tokens stored only as SHA-256, fixed eight-hour UTC expiry, active-profile/current-role check on every request, and 30-minute UI inactivity logout. Password reset, deactivation, or role change revokes all target sessions. Production/staging cookies are host-only `__Host-qsr_session` (`Secure; HttpOnly; SameSite=Strict; Path=/`) and readable `__Host-qsr_csrf` (`Secure; SameSite=Strict; Path=/`); development keeps current non-Secure names on HTTP. Unsafe methods require constant-time cookie/header CSRF equality and exact Origin; login/setup require Origin and rate limiting.

Netlify's forced `/api/*` rewrite precedes asset/SPA rules and signs requests with HS256 JWS. FastAPI validates signature, `iss=netlify`, expiry, site ID, deploy context, and exact signed site URL/Origin. Direct Render `/api/*` is 404; no CORS. `/healthz` is direct liveness only; `/readyz` checks startup, draining state, DB at Alembic head, and recent Storage capability within two seconds. Every API/auth/download response is `private, no-store`. Trust forwarded scheme only at Render ingress; allow exact hosts only.

## 3. Public HTTP compatibility

Netlify preserves `/` and all visible workflows. Unless listed as a deliberate change below, preserve exact method/path, query/body fields, success status, response keys, filename/MIME, and current 400/401/403/404/409/422 meanings for these 56 API routes:

- Public through signed proxy: `GET /api/status`; `POST /api/setup`, `/api/login`. Status stays unauthenticated because current bootstrap requires it, resolving `30-render.md`'s contrary statement.
- Session/read: `POST /api/logout`; `GET /api/me`, `/api/quality/me`, `/api/dashboard`, `/api/accounts`, `/api/accounts/{account_id}/config`, `/api/runs`, `/api/runs/{rid}`, `/api/inventory`, `/api/scorecards`, `/api/audits`, `/api/audits/{audit_id}`, `/api/results/imports/{import_id}/errors`, `/api/analytics/summary`, `/api/analytics/control-chart`, `/api/analytics/pareto`, `/api/analytics/capability`, `/api/capas`, and `/api/capas/{capa_id}`.
- Core mutations: `POST /api/accounts`, `/api/uploads`, `/api/uploads/{upload_id}/inspect`, `/api/uploads/{upload_id}/preview`, `/api/uploads/{upload_id}/runs`, `/api/runs/{rid}/void`, `/api/audits/{audit_id}/submit`, `/api/audits/{audit_id}/review`, `/api/results/imports`, `/api/results/imports/{import_id}/commit`, `/api/capas`, `/api/capas/{capa_id}/transition`; `PUT /api/accounts/{account_id}/config`, `/api/audits/{audit_id}`, `/api/capas/{capa_id}`; `DELETE /api/accounts/{account_id}`.
- Administration: `GET /api/admin/overview`, `/api/admin/showcase-data`, `/api/admin/users`, `/api/admin/processes`, `/api/audit`, `/api/settings/backups`; `POST /api/admin/users`, `/api/admin/processes`, `/api/admin/scorecards`, `/api/admin/scorecards/{scorecard_id}/items`, `/api/admin/scorecards/{scorecard_id}/publish`, `/api/settings/backup`, `/api/settings/restore`; `PUT /api/admin/showcase-data`, `/api/admin/processes/{process_id}`, `/api/admin/processes/{process_id}/settings`.
- The two current synchronous export GETs are governed by the deliberate replacements below.

Current general read access remains available to every active authenticated role, including process and scorecard lists. Administrator alone may read overview/users/showcase/audit/recovery data and mutate accounts/configuration/users/processes/scorecards/showcase/recovery. Other mutations retain today's matrix: Administrator or QA Auditor upload/sample/audit save/submit; Administrator, QA Auditor, or QA Reviewer import preview; Administrator or QA Reviewer import commit; Administrator or QA Reviewer run void; Administrator, QA Reviewer, or Operations Manager audit review/CAPA mutation. Upload/import staging is limited to creator or Administrator; export jobs to requester or Administrator. UI hiding is never authorization.

Intentional, versioned changes are exact:

- `GET /api/runs/{rid}/export` and `GET /api/reports/quality.xlsx` return 410 with replacement instructions for one release. Their new `POST` variants return `202 {job_id,status_url}`. Add `GET /api/exports/{job_id}` and authenticated `GET /api/exports/{job_id}/download`; the latter audits and returns 303 to a 60-second signed URL.
- `GET /api/settings/backups` becomes Administrator-only and returns `{provider,recovery_points}`; `POST /api/settings/backup` returns `202 {job_id,status_url}`. `POST /api/settings/restore` returns 410 and a runbook ID for one release, then is removed; web restore and the `.db` picker are deleted.
- Add `POST /api/password`, `DELETE /api/admin/users/{username}/sessions`, and Administrator-only `GET /api/admin/diagnostics`.
- `POST /api/logout` becomes idempotent: it returns 200 and clears both cookies even for missing, expired, or revoked sessions. `GET /api/audit` accepts opaque `cursor` plus `limit` and returns `{items,next_cursor}` instead of a bare list.
- Password minimum increases from 8 to 12 characters for setup, admin create/reset, and new `/api/password`; maximum remains 200. Production first-admin is the advisory-locked CLI using password stdin; `/api/setup` therefore returns the existing 409 after bootstrap. Local development may still use setup. Showcase GET remains; enabling via PUT is 403 in production and allowed in development/staging only.

## 4. Environment contract

| Scope | Required contract |
|---|---|
| all services | `PYTHON_VERSION=3.13.15`, `APP_ENV=staging|production`, `LOG_LEVEL=INFO`, `RELEASE_SHA=<40-hex commit>` |
| web/worker | secret pooled `DATABASE_URL=postgresql+psycopg://...` using Supavisor session mode `:5432`; `DATABASE_SSL_ROOT_CERT_FILE=/etc/secrets/supabase-ca.crt`; pool size 5, overflow 0, timeout 10s, recycle 300s, pre-ping; statement timeout 30000ms |
| web/worker | secret `SUPABASE_URL`, component-specific `SUPABASE_SECRET_KEY`; `INGEST_BUCKET=qcc-ingest`, `EXPORT_BUCKET=qcc-export-temp`; connect/read timeout 5/20s |
| web | Render `PORT`; exact `PUBLIC_ORIGIN`, comma-delimited exact `ALLOWED_HOSTS`; secret `NETLIFY_JWS_SECRET`; `NETLIFY_SITE_ID`; limits `MAX_UPLOAD_BYTES=26214400`, `MAX_ROWS=200000`, `MAX_COLS=250`, `MAX_JSON_BYTES=1048576`, `SIGNED_URL_TTL_S=60` |
| worker | `WORKER_POLL_S=2`, `JOB_LEASE_S=300`, `RECONCILE_INTERVAL_S=900` |
| backup cron only | secret direct IPv6 `DIRECT_DATABASE_URL` with `sslmode=verify-full`, CA, `BACKUP_ENCRYPTION_KEY`, AWS S3/KMS credentials, Supabase management token; never web/worker/Netlify |
| Netlify only | runtime-scoped `API_ORIGIN` and JWS secret, context-specific; Node `22.13.0`, npm `10.9.2`; neither is exposed as `VITE_*` |

Secrets are never committed, logged, returned, or built into artifacts. Rotate quarterly and on exposure/personnel change: create/deploy/verify/revoke for Storage and DB; current+next overlap for JWS; key-versioned decryption for backups; revoke all sessions after identity/DB compromise.

## 5. Ordered implementation batches and gates

1. **Characterization (no dependency):** freeze route/DTO/error/workbook fixtures and port all nine tests; add auth/CSRF/role/upload/export/concurrency cases. **Expected:** `tests/fixtures/`, contract and browser tests. **Gate:** current SQLite application passes the characterization suite.
2. **Postgres core (1):** add `qcc/config.py`, `qcc/database.py`, models/repositories/services, `alembic.ini`, `migrations/0001_*` and `0002_*`, and pinned dependencies; remove runtime DDL/SQLite branches only after parity. **Gate:** empty upgrade, second no-op, metadata/constraint tests, all behavioral tests on disposable Postgres.
3. **Identity and transactions (2):** add `qcc/auth.py`, `qcc/security.py`, middleware and transaction services; update `app.py`/`quality.py` for session revocation, password flow, locks, error mapping, and audit atomicity. **Gate:** full auth/role matrix and two-connection races pass.
4. **Storage/jobs/recovery (2–3):** add `qcc/storage.py`, `qcc/worker.py`, `qcc/backup.py`, migration `0003_*`, spool validation, worker/sweeper/cron CLIs, and operator restore tooling. **Gate:** injected DB/Storage failures leave neither dangling committed references nor unreconciled objects; encrypted dump restores to a new project within RPO 24h/RTO 8h.
5. **Frontend/proxy (3–4):** move `static/` to `frontend/{index.html,src,package.json,package-lock.json,.nvmrc,vite.config.js}` without UI redesign; add one safe API wrapper, async export and Recovery UI, and root `netlify.toml`. **Gate:** build/asset/secret scans, route parity, 390/768/1440 visual and keyboard checks, and 25 MiB proxy upload under 26 seconds.
6. **Platform/CI (2–5):** add `render.yaml`, `.github/workflows/{ci,deploy}.yml`, `docs/runbooks/`, JSON logging, health/readiness, and diagnostics. **Gate:** staging at the exact SHA passes all tests and a restore drill.
7. **Cutover (6):** produce versioned release manifests/evidence; provision, migrate empty production, bootstrap admin, deploy worker/web/frontend, accept, and monitor. **Gate:** signed approval and rollback rehearsal evidence.

## 6. Provisioning and CI/CD order

1. In GitHub protect `main` (PRs, reviews, required backend/frontend/integration/security/secret-scan checks); create protected `staging` and `production` environments, production reviewer, and a hardened ephemeral Singapore runner with IPv6.
2. Create separate Supabase staging/production projects in exact Singapore `ap-southeast-1`; enable SSL enforcement/citext, create least-privilege runtime and migration roles, private buckets/policies/limits, and obtain CA, pooler, and direct URLs.
3. Create versioned/Object-Locked, KMS-encrypted private AWS S3 recovery bucket in Singapore and least-privilege backup identity.
4. Create separate Render environments and paid `1c-2g` web/worker plus backup cron, Singapore, `main`, one instance, no disk, web `/readyz`, 45-second shutdown. Keep APIs unusable except health until Netlify signing is configured; auto-deploy off.
5. Connect existing Netlify site `053e5afa-4918-4d66-bc84-e925eecff8ee` to `dipeshonnet/QCCenter` `main`, base `frontend`, build `npm run build`, publish `dist`; production branch only, PR previews to staging API, signed forced proxy first.
6. CI runs `python -m alembic upgrade head` with the direct staging URL, deploys exact SHA worker then web, verifies heartbeat/readiness, deploys Netlify, and runs acceptance. Production repeats only after approval: migrate, bootstrap the sole admin from stdin, start worker, deploy ready web, then publish Netlify. Migrations precede compatible code; use expand/backfill/deploy/contract across releases.

## 7. Test and acceptance strategy

Local uses Postgres 17 in a container and a development-only filesystem `StorageService`; CI uses disposable Postgres 17 plus fault-injecting storage and browser containers. Staging alone proves Supavisor/direct SSL, real private Storage, signed Netlify proxy, Render restarts, and Chromium/Firefox/WebKit. Production runs non-destructive smoke tests with a dedicated test account, then removes it by audited application actions.

Release evidence must prove: generic login failures/rate limits; cookie rotation, logout clearing/idempotence, restart-safe eight-hour sessions and 30-minute inactivity; CSRF missing/mismatch and bad Origin/JWS/Host rejection; inactive/must-change users and every role's allow/deny matrix; upload format/ZIP-bomb/size/row/column/traversal/cross-user cases; deterministic random and coverage sampling, prior-ID exclusion, atomic run/audit creation and voiding; audit save/score/submit/reject/approve, published-card immutability, critical defects and automatic CAPA; historical import duplicate/error/all-or-nothing behavior; seven ordered CAPA stages/evidence/closure; analytics dates, yield/DPU/DPMO/sigma, p/u, I-MR, Cp/Cpk and Pareto; formula-safe CSV/XLSX contents, async idempotent exports, authorization, expiry and 60-second downloads; immutable/redacted audit pagination; web/worker restart recovery; 50 concurrent reads and paired races for setup/account/publish/upload/run/import/review/CAPA/job claims; DB pool exhaustion/deadlock/timeout, Storage outage/corruption/orphans, worker death/lease expiry, proxy 502/504/26-second limit, quota/full/read-only states, failed migration/deploy, backup failure, and restore drill.

## 8. Operations, cutover, rollback, and limits

Emit one-line redacted JSON stdout logs with UTC time, environment/SHA, correlation ID, route, status, latency, safe code, worker/job data; business detail stays in transactional audit events. Alert on deploy/readiness/migration/backup failure, warm 5xx >2%/5m, p95 >2s/10m, memory or DB pool >80%, quotas at 70%/85%, job backlog/expired lease, and recovery point age >26h. Probe Netlify `/` and Render `/healthz` every five minutes. Runbooks: deploy/migrate; worker backlog; Storage reconciliation; credential/JWS rotation; DB/Storage outage; quota exhaustion; backup verification; new-project restore; security incident/session revocation.

Cutover: freeze changes, checksum/tag the legacy local release/database, take recovery point, verify staging evidence, migrate empty production, bootstrap admin, smoke via signed proxy, run full acceptance, publish Netlify exact SHA, watch errors/latency/jobs for 60 minutes, then retire the mock branch only after the rollback window. No SQLite rows or objects move.

Rollback before data writes: restore the previous Netlify artifact and compatible Render web/worker, leaving additive schema. After writes, prefer roll-forward; never automatically downgrade. For destructive schema/data error, enable Render maintenance mode, stop workers, restore the latest encrypted dump into a **new** Supabase project, recreate/verify buckets, rotate/repoint secrets, revoke sessions, smoke test, and switch traffic. The unchanged local application plus retained SQLite database is the last-resort reference/local rollback, not a cloud database restore source.

Free tiers are prototype-only: Render Free is 0.1 CPU/512 MiB, idles after 15 minutes, wakes in about a minute, shares 750 hours/month, has ephemeral disk/arbitrary restarts/no free background worker and only two rollback artifacts. Supabase Free allows two active projects, may pause after one inactive week, has a 500 MB database, 1 GB Storage, 5 GB uncached plus 5 GB cached egress, and no automatic backup/PITR. Netlify credit-based Free has 300 credits/month and proxy requests still time out at 26 seconds. Before production-grade use, pay for always-on Render web+worker/cron, Supabase Pro with managed daily backups (PITR if RPO requires), adequate Netlify capacity/support, off-platform monitored backups, restore drills, an SLA/on-call owner, capacity/load testing, and approved data-residency/retention controls.

## 9. Account-owned values required before provisioning

- GitHub organization/repository ID, visibility/plan, default/protected branch, environment reviewer/team, runner ID/network, deploy identities, and required-check names.
- Supabase organization, staging/production project refs, Postgres 17 and exact Singapore region confirmation, pooler/direct hosts, runtime/migration role names, CA fingerprint, bucket IDs, quotas, management-token owner, and plan.
- Render workspace/environment/service/cron IDs, names, Singapore region, plan, `onrender.com` hosts, deploy hooks/API-token owner, alert recipients, and maintenance authority.
- Netlify team, site ID (confirm `053e5afa-4918-4d66-bc84-e925eecff8ee`), plan, canonical/custom and preview URLs, DNS/TLS owner, production branch, JWS key owner, and context-specific API targets.
- AWS account, `ap-southeast-1` S3 bucket name/ARN, KMS key ARN, Object Lock/retention, backup identity, encryption-key custodian; RPO 24h/RTO 8h owners and restore approvers.
- Initial `admin` password custodian, public origin/allowed hosts, secret owners/rotation dates, monitoring/on-call contacts, data classification/residency/retention approval, traffic/file forecasts, budget, and upgrade thresholds.

## Recommended execution sequence

Characterize current behavior; implement Postgres and concurrency; harden identity/edge; add Storage, workers, and recovery; move the real frontend; provision staging and complete acceptance/restore rehearsal; provision empty production; bootstrap, deploy, cut over, observe, and only then retire the demo source.
