# Quality Command Center Verification Report

## Account structure verification — 2026-09-08

- **19 automated tests passed** against disposable SQLite databases, including the original 10 tests and 9 account-structure tests.
- Account authorization was checked through HTTP endpoints and direct workflow tests: list/aggregate/export isolation, different roles per account, immediate grant removal, upload/import ownership, account/process mismatches, assignees, and foreign scorecard items.
- Process tests cover independent controls, mapping persistence, coverage and previous-ID history, archive/restore, blocked new work, and completion of existing audits/CAPAs.
- Scorecard tests cover cloning with new item IDs, metadata/item edits, removal/reordering, publishing, historical result preservation, and concurrent version allocation.
- SQLite migration tests verify copied controls, removal of global non-Administrator access, retained legacy-role reference, and repeat-startup preservation.
- Python compilation, JavaScript syntax checks, and `git diff --check` passed. Alembic successfully generated PostgreSQL upgrade SQL through `0002_account_structure`. A live PostgreSQL migration was **not run** because the local Docker engine was unavailable.
- Playwright checks used a localhost-only server with synthetic data: dependent dropdowns, disabled empty states, save/selection persistence, independent sibling-process controls, scorecard clone/edit/reorder/publish, archive/restore, and user-role round trips. Browser checks exposed and resolved stale scorecard selection and initial table-loading races.
- Screenshots are saved under `output/playwright/`. Existing dashboard inline-style CSP messages and the missing favicon were observed; the new administration flows produced no JavaScript exceptions.
- A separate browser session-switch check passed: saved role rows reload correctly, signing out clears cached Administrator screens, a reviewer-only account cannot select a process for sampling, and an auditor account displays its selected process's saved coverage policy.

The upgrade requires Admin to assign account roles to existing non-Administrator users. PostgreSQL migration must run before the matching application release; no production database or deployment was changed during verification.

## Original baseline verification

## Automated verification

The application was exercised against isolated SQLite workspaces so production data was not modified.

Passing coverage:

- Idempotent schema migration and default role initialization.
- Existing-administrator assignment to the Administrator role.
- Process and scorecard foundations.
- Published scorecard immutability.
- Weighted scoring and critical-fail override.
- Sampling commit creates audit cases and preserves `process_id` on the run.
- Audit submission/review and automatic draft CAPA for an approved critical finding.
- Yield, DPU, DPMO, shifted sigma, p/u limits, Pareto ordering, and provisional/stable baseline state.
- Atomic historical-result import rollback when any staged row is invalid.
- I-MR, Cp, and Cpk availability after twenty numeric SLA observations.
- Idempotent showcase-data enable/disable, stable analytics population, and preservation of real account/process records.
- Existing XLSX/CSV sampling, manifest exports, prior-sample exclusion, coverage policies, formula-injection protection, backup/restore, and audit logging remain available.

Command:

```text
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Result: **8 tests passed**.

## Browser and design verification

The locally served application was verified in the Codex in-app browser at 1440×1024 using an isolated synthetic quality dataset. The following interactions were exercised:

- Login and authenticated application bootstrap.
- Account selection and p/u chart switching.
- Home, Scorecards, Sampling, Results, Analytics, CAPA, Reports, and Admin navigation.
- All seven Administration sections.
- Dashboard metric, Pareto, CAPA, and control-chart rendering.
- Runtime console checked after primary interactions: no warnings or errors.

The Home screen was compared side by side with the selected command-center reference. Detailed evidence is recorded in `design-qa.md`.

Acceptance result: **PASS** for the requested local single-PC Quality Command Center scope.
