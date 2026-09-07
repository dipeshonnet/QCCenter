# Storage, authentication, and edge-security migration plan

Status: decision-complete. This plan extends `00-baseline.md` and `10-database.md`; it does not introduce Supabase Auth.

## 1. Storage model and ownership

Create two **private** Supabase Storage buckets per environment:

- `qcc-ingest`: sampling CSV/XLSX only; 25 MiB bucket limit; MIME allow-list `text/csv` and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- `qcc-export-temp`: generated CSV/XLSX only; 50 MiB limit; the same MIME types.

No public bucket is permitted. Keys are server-generated and immutable: `v1/ingest/YYYY/MM/DD/{upload_id}.{csv|xlsx}` and `v1/exports/{kind}/YYYY/MM/DD/{job_id}.{csv|xlsx}`. Never include usernames, account names, original filenames, or user paths; never upsert. Storage metadata contains `content-type`, `upload-id` or `job-id`, SHA-256, and application version. Postgres is authoritative for original name, object key, size, hash, creator, status, timestamps, error code, and deletion time. Extend `uploads` with `created_by`, `last_error`, `deleted_at`, and status `ERROR`; add an `export_jobs` table containing job ID, kind, normalized parameters/entity ID, requester, object key/hash/size, `PENDING|RUNNING|READY|FAILED|EXPIRED`, error code, and created/ready/expires timestamps.

`StorageService` is the only storage adapter. It exposes `put_stream`, `get_stream`, `head`, `delete`, and `sign_download`; routes cannot accept a bucket or object key. It uses a dedicated Render-only Supabase secret key (legacy service-role only if unavoidable), bounded connect/read timeouts, and limited retries for idempotent reads/deletes. The browser receives neither this key nor a Supabase client. Secret/service-role keys bypass RLS and must remain server-side ([Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)); deny `anon`/`authenticated` grants and policies on both buckets as defense in depth. Private objects otherwise require authorization or a time-limited URL ([private bucket behavior](https://supabase.com/docs/guides/storage/buckets/fundamentals)).

## 2. Upload, processing, download, and retention

All ingress remains browser -> FastAPI. `POST /api/uploads` requires Administrator or QA Auditor. FastAPI streams to a private, request-scoped spool while hashing and enforcing 25 MiB before upload; it verifies extension, declared MIME, XLSX ZIP/container structure or CSV decoding, non-empty data, at most 200,000 rows/250 columns, and parser resource limits. Client MIME and filename are never trusted. Only after validation does the adapter create the object and then insert `READY` metadata. If the insert fails, delete the object; a sweeper catches deletion failure. Inspect/preview/run endpoints lock and authorize the row: only its creator or an Administrator may use it, and only while `READY`. A successful run transaction changes it to `USED`; post-commit deletion is retried asynchronously. Missing/corrupt objects return 409, mark the upload `ERROR`, and emit an audit event; Storage timeout/unavailability returns 503 with a correlation ID, never provider details.

Historical `POST /api/results/imports` keeps no source object: validate from the bounded spool, transactionally retain parsed rows/hash in Postgres, then delete the spool. `READY` ingest objects expire after 24 hours; `ERROR`, failed-request, and object-without-row orphans after one hour. A scheduled worker runs every 15 minutes, reconciles both directions using prefix pages, marks metadata before deletion, retries with backoff, and audits final failure. Used/expired metadata follows relational audit retention; temporary bytes do not.

Generated output decisions are fixed:

- Import-error CSV remains an authorized FastAPI stream at `GET /api/results/imports/{id}/errors`; it is formula-safe, `no-store`, and not retained.
- Run and quality-report XLSX become asynchronous because Netlify proxy rewrites time out after 26 seconds ([Netlify proxy limits](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)). Replace the two download links with `POST /api/runs/{rid}/export` and `POST /api/reports/quality.xlsx`; each returns `202 {job_id,status_url}`. The UI polls `GET /api/exports/{job_id}` and enables `GET /api/exports/{job_id}/download` when ready. The download route rechecks the requester's current session, role, and entity scope, audits the download, then returns a 303 to a single-object signed URL valid for 60 seconds. Jobs are idempotent per requester/normalized parameters while pending or ready.
- XLSX objects expire after 24 hours and are then deleted by the sweeper. No generated export is permanently retained: immutable run data and report inputs remain in Postgres and can regenerate it. A result exceeding 50 MiB fails with `EXPORT_TOO_LARGE`; the UI directs the administrator to narrow a report or upgrade the Storage limit before retrying a run export. Never sign ingest objects. Signed URLs are bearer credentials, are absent from logs/audit data, and are not presented until authorization succeeds.

Until account-scoped grants are designed, all active authenticated roles retain the current run/report read access. Upload and import staging is visible only to its creator or an Administrator; export job status/download is visible only to its requester or an Administrator.

## 3. Managed-Postgres recovery workflow

Remove SQLite startup copies, local backup directories, `.db` upload/validation, and live database replacement. Supabase database backups do **not** include Storage objects ([backup scope](https://supabase.com/docs/guides/platform/backups)); temporary ingest/export objects are deliberately excluded from recovery.

Change `GET /api/settings/backups` to Administrator-only and return provider recovery-window status plus off-platform logical recovery points (`id`, type, status, UTC creation, size, SHA-256, schema revision, retention). Change `POST /api/settings/backup` to enqueue an isolated backup job and return 202/job ID; the same job also runs nightly. It uses `DIRECT_DATABASE_URL`, `pg_dump` custom format, encryption, checksum and `pg_restore --list`, stores outside the Supabase project, retains daily 7 days/monthly 3 months, and writes success/failure audit events. Target RPO is 24 hours on the prototype and RTO is 8 hours; paid production must use managed daily backup or PITR plus the independent dump.

Delete `POST /api/settings/restore`; during one release it returns 410 with the recovery runbook reference. Remove the `.db` picker and destructive Restore button. Rename “Database protection” to “Recovery,” show last successful point/provider window/RPO, keep “Create recovery point,” and add “View restore procedure.” Restore is operator-only: approve incident/change, enable maintenance mode, restore into a new Supabase project, validate checksum/schema/counts/login, reconfigure buckets/secrets, run smoke tests, switch Render secrets, revoke all sessions, and only then switch traffic. Never restore over production from the web process. Audit request, approval, start, validation, cutover, rollback, and actor.

## 4. FastAPI identity and authorization

Keep FastAPI users/roles/sessions in Postgres. Passwords remain 16-byte per-user salt plus PBKDF2-HMAC-SHA256/420,000 iterations, constant-time verification, 12-200 character new-password policy, and no password/audit logging. Benchmark annually and increase iterations without weakening stored hashes. Login gives one 256-bit random token; store SHA-256 only. Sessions have fixed eight-hour UTC expiry (no sliding), are checked with the active profile and current roles on every request, and are purged hourly. The 30-minute browser inactivity logout remains supplementary.

Login rejects inactive users with the same generic response, rate-limits by account and trusted client IP, rotates cookies, and audits `LOGIN`, `LOGIN_FAILED` (no password), and lock/rate-limit events. `must_change_password` restricts access to me/password/logout; add `POST /api/password`, which replaces the hash, clears the flag, revokes other sessions, rotates the current session, and audits. Admin password reset, deactivation, or role change revokes all target sessions in the same transaction. Add `DELETE /api/admin/users/{username}/sessions`; logout is idempotent, clears both cookies even for expired/revoked tokens, and audits when identity is known. Authorization remains server-side; UI role hiding is cosmetic. Security-relevant mutations and their audit event commit atomically. `/api/audit` is Administrator-only, cursor-paginated, and redacts secrets, cookies, signed URLs, raw file content, and passwords.

## 5. Netlify/Render request boundary

Netlify places a forced `200` rewrite for `/api/*` to Render **before** the SPA fallback and signs proxy requests with Netlify JWS. Production FastAPI accepts `/api/*` only with valid `x-nf-sign` issuer, site ID, site URL, and expiry; direct `onrender.com` API requests return 404. Only minimal unauthenticated `/healthz` is direct. Set every API/auth/download response `Cache-Control: private, no-store`.

Use host allow-listing for the canonical app host and exact Render host. Render terminates TLS, so Uvicorn trusts forwarded headers only from Render's ingress path and derives HTTPS from `X-Forwarded-Proto`; untrusted forwarded headers are ignored. Cookies are `__Host-qsr_session` (`Secure; HttpOnly; SameSite=Strict; Path=/`) and `__Host-qsr_csrf` (`Secure; SameSite=Strict; Path=/`, readable). Every unsafe method, including logout, requires constant-time CSRF cookie/header equality **and** exact canonical `Origin` (Referer fallback); setup/login require the origin check and rate limiting. No `Domain` attribute.

Production has no CORS middleware because the browser calls same-origin `/api`; reject preflights and credentialed direct-Render use. Keep CSP/connect-src `'self'`, HSTS at the public host, nosniff, DENY/frame-ancestors, referrer and permissions policies. Preview deployments use separate non-production data/secrets and explicit hosts, never wildcard origins.

## 6. Secrets and rotation

Render runtime secrets: pooled `DATABASE_URL`, CA path/content, `SUPABASE_URL`, one component-specific `SUPABASE_SECRET_KEY`, and Netlify JWS verification secret/site identity. `DIRECT_DATABASE_URL`, backup encryption key, destination credentials, and Supabase management token exist only in migration/backup jobs. Netlify holds only its runtime proxy-signing secret. Frontend-visible configuration contains no Supabase key or URL; a publishable key is unnecessary. Secrets never enter git, build arguments/artifacts, URLs, telemetry, errors, or audit details.

Rotate quarterly and immediately on exposure/personnel change: create a new component-specific Supabase secret, deploy it, verify Storage, then delete the old key; update and verify pooled/direct database credentials before revoking old credentials; rotate backup encryption with key-versioned decrypt support; rotate proxy JWS by temporarily accepting current+next in FastAPI, update Netlify, verify, then remove old. A suspected session/database leak also revokes all sessions. Record owner, date, verifier, and evidence without secret values.

## 7. Misuse/failure cases and acceptance

- [ ] Tests reject forged MIME/extensions, ZIP bombs, malformed/empty/oversize files, row/column excess, traversal-like names, overwrite attempts, and cross-user upload IDs.
- [ ] Storage/DB failure tests prove no committed missing-object reference, bounded retries, reconciled orphans, 503/correlation responses, and no secret leakage.
- [ ] Export tests prove current authorization at creation/download, formula neutralization, 60-second URLs, no caching/logging, expiry cleanup, idempotency, and usable large-file UI states.
- [ ] Auth matrix proves inactive/must-change users, all roles, fixed expiry, logout, reset/deactivation/role-change revocation, brute-force throttling, and atomic audit events.
- [ ] Browser tests prove Secure/HttpOnly/SameSite cookies, CSRF and Origin failures, forwarded HTTPS, trusted-host rejection, no CORS, signed Netlify proxy success, and direct Render denial.
- [ ] Recovery drill restores the latest dump to a new project within RPO/RTO, validates schema/data and bucket recreation, rotates secrets, revokes sessions, and records evidence.
- [ ] Repository/build/log scans find no database URL, Supabase secret/service-role key, backup key, cookie, or signed URL; frontend network traffic contacts neither Supabase nor Render directly.
