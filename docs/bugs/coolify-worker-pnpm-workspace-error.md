# Coolify research worker rejects the pnpm workspace

- Recorded: 2026-07-26 17:20:42 CEST (+0200)
- Base commit: `d418df4f264c13c4ca075f92abd40e4bb7093321`

## Symptom

A second Coolify service configured with `pnpm research:worker` restarted continuously with
`ERROR packages field missing or empty`.

## Root cause

The resolved Nixpacks plan placed its bundled pnpm 9 on the runtime `PATH`, while `package.json` pins
pnpm 11.16.0. The build phases already invoke pnpm 11 explicitly, but the custom worker start command
used the pnpm 9 executable. pnpm 9 rejects the project's valid settings-only `pnpm-workspace.yaml`
before it can run the worker script.

## Fix

- Use `npx --yes pnpm@11.16.0 run research:worker` as the Coolify worker Start Command.
- Keep the local `pnpm research:worker` script unchanged because the project-managed pnpm version is
  correct outside the Nixpacks runtime-path mismatch.
- Document the required pinned command in the Coolify deployment instructions.

## Verification

- `nixpacks plan -f json .` resolves `pnpm-9_x` on the runtime path and pnpm 11.16.0 for the explicit
  install and build commands.
- `npx --yes pnpm@11.16.0 run research:worker -- --once` reaches the worker's expected environment
  validation instead of failing while reading `pnpm-workspace.yaml`.
