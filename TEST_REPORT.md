# Quality Command Center Verification Report

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
