# Netlify frontend deployment and parity plan

Status: implementation plan only. This extends `00-baseline.md`, `20-storage-security.md`, and `30-render.md`; it changes no site, branch, deployment, or cloud resource. The local `static/` application is authoritative. The `quality-command-center-site/` React/Vite checkout at `origin/netlify-site` (`189bbea`) is a hard-coded visual demo and must not become product source.

## 1. One frontend in the main monorepo

Move, do not copy, the real HTML/CSS/JavaScript and vendored Chart.js/icons/font into this final layout:

```text
/
  app.py, quality.py, qcc/                 # FastAPI/application code
  requirements.txt, render.yaml
  netlify.toml                             # site-wide build, proxy, headers
  frontend/
    index.html
    package.json, package-lock.json, .nvmrc, vite.config.js
    src/app.js, src/styles.css
    src/vendor/{chart.umd.min.js,bootstrap-icons.min.css,bootstrap-icons.woff2}
    dist/                                  # generated, gitignored
  docs/migration/, tests/
```

Delete `static/` only in the implementing commit after the move; never import `quality-command-center-site/`, its mock data, React components, or generated output. Preserve DOM IDs, wording, CSS, charts, responsive breakpoints, focus behavior, and all workflows; only Vite entry/asset paths and migration-required behavior may change. Vite `base` is `/` and all build dependencies are exact versions in the lockfile.

Local live development runs FastAPI on `127.0.0.1:8765` and Vite on `127.0.0.1:5173`; Vite proxies `/api/*` to FastAPI, so the browser still sees one origin. The launcher’s production-like mode first builds `frontend/dist`, then FastAPI (with `SERVE_FRONTEND=true`) serves that directory, including the non-API HTML fallback. Render sets `SERVE_FRONTEND=false`; it exposes only health and the proxied API. Thus both local modes use the same source/build, never a Python-side copy.

## 2. Netlify build and Git contract

Connect existing site ID `053e5afa-4918-4d66-bc84-e925eecff8ee` to repository `dipeshonnet/QCCenter` with:

| Setting | Required value |
|---|---|
| Production branch | `main` |
| Base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `frontend/dist` in repository terms (`dist` relative to base) |
| Branch deploys | disabled |
| Deploy Previews | enabled for pull requests |
| Runtime | Node `22.13.0`, npm `10.9.2`, Vite `8.0.13`, pinned in `.nvmrc`, `package.json`, and lockfile |

Use `npm ci` in CI before tests; Netlify’s dependency-install phase uses the committed lockfile, then executes the command above. Keep `netlify.toml` at repository root and make its base/publish interpretation explicit; Netlify documents base/package/publish behavior for [monorepos](https://docs.netlify.com/configure-builds/monorepos/) and Node selection under [dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/#node-js-and-javascript). Protect `main` with frontend build, unit, browser-parity, and secret-scan checks. Record `COMMIT_REF` in build metadata/UI diagnostics; deploy the exact release SHA coordinated with `30-render.md`.

## 3. Same-origin API boundary

The first, forced rule is `/api/* -> https://<environment-render-host>/api/:splat` with status `200`, before assets and the SPA fallback. Configure it as Netlify’s signed proxy (`signed = "NETLIFY_JWS_SECRET"`); FastAPI validates `x-nf-sign`, issuer, expiry, site ID, and signed deploy/site URL. Netlify documents proxy behavior and its **26-second response limit** in [rewrites and proxies](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/). Do not use redirects that expose the Render URL to the browser.

The proxy must preserve method, query, multipart/body bytes, upstream status, `Content-Type`, `Content-Disposition`, `Location`, correlation ID, and every `Set-Cookie`. Production cookies remain host-only `__Host-qsr_session` (`Secure; HttpOnly; SameSite=Strict; Path=/`) and readable `__Host-qsr_csrf` (`Secure; SameSite=Strict; Path=/`); no `Domain`. The signed-download 303 goes to a 60-second Supabase URL, and host-only app cookies cannot accompany it. FastAPI—not Netlify static-header rules—sets `private, no-store` on every API/auth/download response.

Replace the current generic `api()` and four `location.href` XLSX paths with one wrapper that:

- accepts only relative paths beginning `/api/`, rejects an origin/absolute URL, uses `credentials: "same-origin"`, sends `Accept: application/json`, and adds the CSRF cookie as `X-CSRF-Token` on every unsafe method;
- parses JSON or text errors, preserves 401/403/409/422 meaning and correlation IDs, returns to login only on 401, and maps Netlify 502/504 or non-JSON gateway bodies to an actionable unavailable/timeout state;
- aborts ordinary synchronous calls before 26 seconds and exposes retry without replaying mutations. A throttled 25 MiB upload must complete through the proxy inside the limit; otherwise cutover is blocked until application-level `/api` chunking is implemented;
- starts and polls the asynchronous run/report export jobs fixed by `20-storage-security.md`, then navigates to the same-origin authorized download endpoint. Import-error CSV remains an authorized, `no-store` same-origin download.

No source, generated file, HTML, or `VITE_*` value may contain `onrender.com`, Supabase URLs/keys, or an API base URL. A CI scan enforces this. `API_ORIGIN` and the JWS secret are Netlify configuration-only values, scoped separately to production and Deploy Preview contexts and never exposed to Vite/client code.

## 4. Static routing, headers, and environments

Order rules: forced `/api/*` proxy; real files; explicit missing `/assets/*` 404; finally `/* -> /index.html 200`. Current navigation is in-memory and root-based, but the fallback makes refreshes safe if URL routes are later added; missing JS/CSS must never receive HTML. Use root-absolute Vite asset URLs and hashed filenames.

Set `index.html` and error documents to `Cache-Control: public, max-age=0, must-revalidate`; hashed `/assets/*` to `public, max-age=31536000, immutable`. Apply `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, plus HSTS after HTTPS/custom-domain validation, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Cross-Origin-Opener-Policy: same-origin`. See Netlify’s [custom headers](https://docs.netlify.com/manage/routing/headers/) and [SPA fallback](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/#history-pushstate-and-single-page-apps) guidance.

Production proxy target is Render production. Every Deploy Preview proxies only to the isolated staging Render/Supabase configuration. Select this with Netlify deploy-context configuration, fail the build if the target is absent/not allow-listed, and cryptographically bind Origin to the verified JWS deploy URL rather than accepting wildcard origins. Previews use separate cookies/data, display a persistent “Preview / non-production data” banner, disable first-admin setup unless explicitly seeded, and never reach production secrets or records. Netlify describes immutable PR previews in [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/) and context-scoped values in [environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/).

## 5. Demo replacement and safe retirement

Create a draft deploy from the main-based real frontend, verify it against staging, then change the existing site’s repository/base/production branch while preserving domain and TLS. Publish only after the checklist passes and Render production is ready. Confirm the deployed commit and proxy target, then remove `netlify-site` from production/branch-deploy settings. Tag its last commit for archaeology, retain the immutable demo deploy during the rollback window, and only then delete the remote branch; it must never again be a production source. Roll back by Netlify deploy artifact plus the compatible Render release, not by reconnecting the demo branch.

## 6. Parity release checklist

- [ ] **Global/auth:** setup, login/logout, eight-hour session, 30-minute inactivity, password-change state, role-hidden controls, 401/403/CSRF/Origin failures, desktop/tablet/mobile navigation, filters/date presets, dialogs, keyboard/focus, empty/loading/error/toast states.
- [ ] **Home:** metrics, p/u chart, limits/signals, Pareto, urgent CAPA, review counts, scopes, local dates.
- [ ] **Scorecards:** published cards; admin draft/item types, weights/SLA/critical rules, publish/immutability.
- [ ] **Sampling:** CSV/XLSX limits, upload/hash, sheets/header detection, mapping/filters, duplicates/blanks/prior IDs, coverage/random/target preview, atomic commit, audit cases, retry, async run export.
- [ ] **Results:** queue/filter/open, save/submit/reject/approve, scoring/critical CAPA, historical preview/mapping/atomic commit, formula-safe error CSV.
- [ ] **Analytics:** all scopes/dates, Yield/DPU/DPMO/sigma, p/u and I-MR/capability where applicable, baselines/signals, Pareto, async quality report.
- [ ] **CAPA:** create, filter/open/edit, ordered seven stages, ownership/dates/evidence/history/closure.
- [ ] **Reports:** run list/detail, export job pending/ready/failed/expired, authorized 303, filenames/MIME/workbook contents, signed-link expiry.
- [ ] **Admin:** accounts/processes, users/roles/session revocation, scorecards, sampling/analytics policies, mappings, CAPA policy, showcase isolation, Recovery replacement, audit pagination/redaction.
- [ ] **Edge/visual:** direct Render API denied; no CORS/backend URLs; cookies and no-store verified; 404/fallback/cache/security headers; 26-second failures; 25 MiB upload; 1440/768/390 screenshot and computed-font/color/spacing comparison against the local UI in Chromium, Firefox, and Safari/WebKit; zero unexpected console/network errors.

Release requires every item, fresh-production initialization, and recorded screenshots/network traces at the same Git SHA.
