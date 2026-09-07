# Render deployment and operations plan

Status: decision-complete planning only. This extends `00-baseline.md`, `10-database.md`, and `20-storage-security.md`; implementation must preserve their database, Storage, authentication, and recovery decisions.

## 1. Service and build contract

Deploy one public Render **Python web service** per environment. Use Singapore, no persistent disk, one instance and one Uvicorn worker. Staging may use `free`; production uses `1c-2g` because XLSX parsing is CPU/memory intensive and [Render says Free is not for production](https://render.com/docs/free). Pin `PYTHON_VERSION=3.13.15` rather than Render's changing default; Render accepts any released Python version from 3.7.3 onward ([version rules](https://render.com/docs/python-version)).

The existing `launcher.py` and OS start scripts remain local conveniences: they bind `127.0.0.1:8765`, probe the port, and open a browser, so Render must not invoke them. Keep the current pinned FastAPI/Uvicorn/OpenPyXL/multipart packages and add pinned SQLAlchemy 2.x, psycopg 3, Alembic, and `httpx` for the Storage adapter. Generate and review a fully pinned lock/requirements file in implementation.

Commands (run from repository root):

```sh
# build
python -m pip install --upgrade pip && python -m pip install -r requirements.txt

# start
uvicorn app:app --host 0.0.0.0 --port "$PORT" --workers 1 --proxy-headers --forwarded-allow-ips="*" --timeout-keep-alive 5 --limit-concurrency 50 --backlog 128 --timeout-graceful-shutdown 40
```

Render requires `0.0.0.0:$PORT`; its FastAPI guide uses this Uvicorn shape ([guide](https://render.com/docs/deploy-fastapi)). Trusting forwarded headers is acceptable only because the process port is reachable through Render ingress; FastAPI otherwise warns not to trust arbitrary forwarding proxies ([proxy guidance](https://fastapi.tiangolo.com/advanced/behind-a-proxy/)).

Proposed `render.yaml` (duplicate secret values are entered independently; never commit them):

```yaml
services:
  - type: web
    name: qcc-api-staging
    runtime: python
    region: singapore
    plan: free
    branch: main
    autoDeployTrigger: checksPass
    buildCommand: python -m pip install --upgrade pip && python -m pip install -r requirements.txt
    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips="*" --timeout-keep-alive 5 --limit-concurrency 50 --backlog 128 --timeout-graceful-shutdown 40
    healthCheckPath: /readyz
    maxShutdownDelaySeconds: 45
    envVars:
      - { key: PYTHON_VERSION, value: 3.13.15 }
      - { key: APP_ENV, value: staging }
      - { key: DATABASE_URL, sync: false }
      - { key: DATABASE_SSL_ROOT_CERT_FILE, value: /etc/secrets/supabase-ca.crt }
      - { key: SUPABASE_URL, sync: false }
      - { key: SUPABASE_SECRET_KEY, sync: false }
      - { key: NETLIFY_JWS_SECRET, sync: false }
      - { key: PUBLIC_ORIGIN, sync: false }
      - { key: ALLOWED_HOSTS, sync: false }
  - type: web
    name: qcc-api-production
    runtime: python
    region: singapore
    plan: 1c-2g
    branch: main
    autoDeployTrigger: off
    buildCommand: python -m pip install --upgrade pip && python -m pip install -r requirements.txt
    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips="*" --timeout-keep-alive 5 --limit-concurrency 50 --backlog 128 --timeout-graceful-shutdown 40
    healthCheckPath: /readyz
    maxShutdownDelaySeconds: 45
    envVars:
      - { key: PYTHON_VERSION, value: 3.13.15 }
      - { key: APP_ENV, value: production }
      - { key: DATABASE_URL, sync: false }
      - { key: DATABASE_SSL_ROOT_CERT_FILE, value: /etc/secrets/supabase-ca.crt }
      - { key: SUPABASE_URL, sync: false }
      - { key: SUPABASE_SECRET_KEY, sync: false }
      - { key: NETLIFY_JWS_SECRET, sync: false }
      - { key: PUBLIC_ORIGIN, sync: false }
      - { key: ALLOWED_HOSTS, sync: false }
  - type: worker
    name: qcc-worker-production
    runtime: python
    region: singapore
    plan: 1c-2g
    branch: main
    autoDeployTrigger: off
    buildCommand: python -m pip install --upgrade pip && python -m pip install -r requirements.txt
    startCommand: python -m qcc.worker
    maxShutdownDelaySeconds: 45
    envVars:
      - { key: PYTHON_VERSION, value: 3.13.15 }
      - { key: APP_ENV, value: production }
      - { key: DATABASE_URL, sync: false }
      - { key: DATABASE_SSL_ROOT_CERT_FILE, value: /etc/secrets/supabase-ca.crt }
      - { key: SUPABASE_URL, sync: false }
      - { key: SUPABASE_SECRET_KEY, sync: false }
```

This uses documented Blueprint fields and `sync:false` placeholders ([specification](https://render.com/docs/blueprint-spec)). The worker claims Postgres export jobs, generates Storage artifacts, retries post-commit deletes, and runs reconciliation every 15 minutes; it performs no schema changes. Upload `supabase-ca.crt` independently to each service as a Render Secret File; it appears at the path above ([secret-file behavior](https://render.com/docs/configure-environment-variables)). Keep staging and production in separate Render environments and Supabase projects. The matrix below completes each service's `envVars`; fixed values may be literal YAML entries and environment-specific values use `sync:false`. Staging release tests run `python -m qcc.worker --once` from protected CI; a persistent staging worker is optional and paid.

## 2. Stateless application and lifecycle

Remove production creation/use of `data/`, `data/uploads`, `exports/`, `backups/`, and `logs/`. Replace SQLite and import-time `init_quality_db()` with Postgres/Alembic; replace upload paths with private Storage object keys; keep export bytes in memory or `qcc-export-temp`; send operational logs to stdout/stderr; use an OS temporary spool only during a request and always close/delete it. Static assets packaged from git remain read-only. Render files are ephemeral and disappear on deploy, restart, or Free spin-down ([filesystem behavior](https://render.com/docs/deploys)).

Replace `@app.on_event` maintenance with FastAPI `lifespan`, the recommended startup/shutdown mechanism ([FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)). Startup must parse all required configuration, validate exact origins/hosts, create the SQLAlchemy engine, connect with `SELECT 1`, require `alembic_version=head`, and verify both private buckets and their size/MIME policy. Any failure is logged once without secrets and raised, causing a non-zero start/deploy failure. It must never migrate, create directories, seed, or swallow failure. Shutdown sets readiness false, stops accepting jobs, drains requests, closes DB/HTTP pools, and exits inside 40 seconds; Render sends `SIGTERM` then waits the configured delay ([shutdown behavior](https://render.com/docs/deploys)).

Add unauthenticated direct endpoints: `/healthz` returns only `200 {"status":"ok"}` if the process is alive; `/readyz` has a two-second budget and returns 200 only after startup, while not draining, with DB reachable at Alembic head and a recent successful Storage capability check; otherwise 503 plus component names, never credentials. Render probes `/readyz`; failed new instances never receive traffic, and persistent failures restart the instance ([health semantics](https://render.com/docs/health-checks)). `/api/status` remains authenticated/proxied product status, not platform health.

## 3. Configuration and secrets

| Variable/secret | Secret | Scope | Fixed value/purpose |
|---|---:|---|---|
| `PYTHON_VERSION`, `APP_ENV`, `LOG_LEVEL` | no | web, worker | `3.13.15`; `staging|production`; `INFO` |
| `PORT` | no | web | Render-supplied; never override |
| `PUBLIC_ORIGIN`, `ALLOWED_HOSTS` | no | web | Exact Netlify HTTPS origin; Netlify and Render hosts, no wildcard |
| `DATABASE_URL` | yes | web, worker | SQLAlchemy psycopg URL; Supavisor session port 5432 |
| `DATABASE_SSL_ROOT_CERT_FILE` | no | web, worker | `/etc/secrets/supabase-ca.crt`; file supplied separately |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | yes | web, worker | Server-only Storage endpoint and component key |
| `INGEST_BUCKET`, `EXPORT_BUCKET` | no | web, worker | `qcc-ingest`; `qcc-export-temp` |
| `NETLIFY_JWS_SECRET` / `NETLIFY_SITE_ID` | yes / no | web | Verify proxy signature and exact site |
| `DB_POOL_SIZE`, `DB_POOL_TIMEOUT_S`, `DB_RECYCLE_S` | no | web, worker | `5`, `10`, `300`; overflow `0`, pre-ping on |
| `DB_STATEMENT_TIMEOUT_MS`, `STORAGE_CONNECT_TIMEOUT_S`, `STORAGE_READ_TIMEOUT_S` | no | web, worker | `30000`, `5`, `20` |
| `MAX_UPLOAD_BYTES`, `MAX_ROWS`, `MAX_COLS`, `MAX_JSON_BYTES` | no | web | `26214400`, `200000`, `250`, `1048576` |
| `SIGNED_URL_TTL_S`, `RELEASE_SHA` | no | web / both | `60`; promoted Git commit |
| `WORKER_POLL_S`, `JOB_LEASE_S`, `RECONCILE_INTERVAL_S` | no | worker | `2`, `300`, `900` |
| `DIRECT_DATABASE_URL`, direct CA/role password | yes | protected CI/backup only | Alembic, dump/restore; never Render runtime |
| `BACKUP_ENCRYPTION_KEY`, backup destination credentials | yes | backup only | Versioned encryption and off-platform target |
| Render deploy hook/API token, Supabase management token | yes | protected CI/operator | Deploy exact SHA; provision/operate only |

Initial-admin password is interactive input, never an environment variable. Redact URLs, headers, cookies, signed URLs, filenames, and bodies from logs.

Use the session pooler because Render is persistent and the shared pooler supplies IPv4; reserve direct port 5432 for Alembic/`pg_dump` ([Supabase connection matrix](https://supabase.com/docs/guides/database/connecting-to-postgres)). One worker owns a five-connection SQLAlchemy pool; monitor combined web/Storage/provider connections and keep below Supavisor allocation. Private buckets, server-generated keys, 25/50 MiB bucket limits, MIME allow-lists, no upsert, server-only secret access, and 60-second signed downloads remain as specified in `20-storage-security.md` ([private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).

## 4. Edge limits and operations

Apply `TrustedHostMiddleware(..., www_redirect=False)` and exact Origin/CSRF/Netlify-signature checks. Direct Render `/api/*` requests return 404; only health endpoints are directly callable. Render terminates TLS and redirects HTTP to HTTPS; derive scheme only from trusted `X-Forwarded-Proto`, require HTTPS in production, and keep Secure `__Host-` cookies. No CORS. Reject JSON above 1 MiB and missing/oversize `Content-Length` early; independently count streamed multipart bytes and stop above 25 MiB. Retain 200,000-row/250-column parser limits. Standard DB statements time out at 30 seconds; API/export design must stay inside Netlify's 26-second proxy constraint, with long exports asynchronous.

Emit one-line JSON operational logs to stdout with UTC time, level, environment, release, request/correlation ID, route template, status, latency, and safe error code. Do not write local log files. `audit_events` is the separate, transactional, immutable business/security record; never duplicate its detail payload into operational logs. Render keeps log streams but caps application lines, so avoid per-row logging ([Render logs](https://render.com/docs/logging)).

Enable Render email/Slack alerts for deploy failure and unhealthy service ([notifications](https://render.com/docs/notifications)); review CPU, memory, request volume/latency, and bandwidth. Add external five-minute probes for Netlify `/` and Render `/healthz`, allowing 90 seconds for Free cold start. Alert immediately on health/deploy/migration/backup failure; also on warm 5xx >2% for 5 minutes, p95 >2 seconds for 10 minutes, memory >80% for 15 minutes, DB pool >80%, quota usage at 70%/85%, or recovery point age >26 hours. Add Administrator-only `/api/admin/diagnostics` returning release, uptime, schema revision, pool counts, worker heartbeat/job depth, and redacted DB/Storage state. A correlation ID must join Netlify, app, Render `Rndr-Id`, database error code, and audit event without exposing data.

## 5. Regions, release, limits, and rollback

Choose Render **Singapore** and Supabase exact **Singapore (`ap-southeast-1`)**: it is the closest common platform region for India/APAC ([Render regions](https://render.com/docs/regions), [Supabase regions](https://supabase.com/docs/guides/platform/regions)). India-to-Singapore user traffic and Netlify-edge-to-Render traffic remain public/cross-location. Choosing Supabase Mumbai would improve data locality but creates unavoidable Singapore-to-Mumbai API/database/Storage traffic; do so only for an India-residency requirement and measure latency.

Protect GitHub `main`: PR tests include converted Postgres tests, security tests, empty Alembic upgrade, and staging migration using `DIRECT_DATABASE_URL` from the protected staging environment. Run releases on a hardened, ephemeral, Singapore self-hosted GitHub runner with outbound IPv6 so the direct Supabase endpoint is reachable; do not assume GitHub-hosted IPv6. The exact migration command is `python -m alembic upgrade head`; `env.py` must refuse any URL except `DIRECT_DATABASE_URL`. After checks pass, staging deploys `main`; smoke/E2E verifies `/readyz`, login, core write, upload, and export. Production requires approval; GitHub runs the same command with the protected production direct credential, then triggers both Render services for that exact `GITHUB_SHA` and sets `RELEASE_SHA`; web is promoted only after the worker is healthy by heartbeat. Never deploy if migration fails. Render's paid pre-deploy command is deliberately unused: it is unavailable on Free and would expose the direct credential to the web service ([pre-deploy rules](https://render.com/docs/deploys)).

Free Render has 0.1 CPU/512 MiB, spins down after 15 idle minutes, wakes in about a minute, provides 750 workspace hours/month, one instance, ephemeral disk, arbitrary restarts, no SSH/one-off jobs or free background workers, and only two previous rollback targets. Thus a Free prototype cannot guarantee export processing or cleanup and is not a parity/release environment. Supabase Free has two active projects, pauses after low activity over seven days, 500 MB database, 1 GB Storage, 5 GB uncached plus 5 GB cached egress, 50 MB maximum object, and no automatic backup/PITR ([pricing](https://supabase.com/pricing), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Neither is an availability or recovery solution. Prototype recovery remains encrypted nightly off-platform dump, RPO 24 hours/RTO 8 hours; Storage objects are not in database backups ([backup scope](https://supabase.com/docs/guides/platform/backups)).

Build/start/readiness failure leaves the previous successful Render deploy serving. Migration failure stops promotion. Every migration is expand/contract: add/backfill first, deploy compatible code, and remove only after the rollback window. If migration succeeds but app deploy fails, keep the old compatible app, fix/roll forward, or deploy the last compatible artifact; never auto-downgrade. Render rollback reuses a prior artifact but current secrets/config persist ([rollback behavior](https://render.com/docs/rollbacks)). For destructive data/schema error, enter maintenance mode, restore to a new Supabase project per `20-storage-security.md`, validate, rotate/repoint secrets, revoke sessions, and switch traffic; Storage recovery is separate.
