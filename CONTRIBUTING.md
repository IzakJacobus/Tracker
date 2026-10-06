# Contributing to Stint

Thanks for helping! Stint is a small, focused product. Keep changes simple, tested and
documented.

## Prerequisites

* [Bun](https://bun.sh) 1.4.2+ (runtime, package manager, test runner)
* For the desktop app: Rust (stable) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Getting started

```bash
bun install
bun run seed        # optional: creates a demo company in apps/server/data
bun run dev         # server on https://localhost:47600 (loopback http on :47601), web on :5173
```

## Checks (run before every push — CI runs the same)

```bash
bun run lint        # Biome: lint + formatting
bun run typecheck   # tsc --noEmit, strict mode, every package
bun run test        # unit + integration tests
bun run test:e2e    # Playwright end-to-end tests (needs `bun run build` first)
```

`bun run format` fixes formatting and import order automatically.

## Conventions

* **TypeScript strict everywhere.** No `any`; prefer `unknown` + Zod parsing at boundaries.
* **Domain logic lives in `packages/shared`** as pure functions with unit tests. Server and client
  both import it; permission checks are *enforced* on the server.
* **Database changes** go in a new numbered file in `apps/server/src/db/migrations/` and are
  registered in `migrations/index.ts`. Never edit a released migration.
* **Commits:** small, meaningful, imperative mood (`Add weekly grid keyboard navigation`).
  Reference the phase or issue where useful.
* **Branches:** `main` is always releasable; work on `feature/<name>` or `fix/<name>` and open a PR.
* **Docs:** user-facing behaviour changes need a README / `docs/` update and a CHANGELOG entry
  under *Unreleased*.
* **Dependencies:** free, open-source, permissive licences only (MIT, Apache-2.0, BSD, ISC, zlib,
  OFL for fonts). No telemetry, no paid services.

## Releasing

1. Update `CHANGELOG.md` (move *Unreleased* to the new version) and bump versions in
   `package.json` files and `apps/desktop/src-tauri/tauri.conf.json`.
2. Tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The *Release* workflow builds the server installer and desktop installers and publishes a
   GitHub Release.
