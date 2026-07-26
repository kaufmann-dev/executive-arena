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
before it can run the worker script. Changing the command alone did not take effect when Coolify
reused the cached launch configuration.

## Fix

- Use `node --import tsx src/research-worker.ts` as the Coolify worker Start Command so the runtime
  does not invoke pnpm.
- Redeploy with **Rebuild without cache** after changing the Start Command.
- Keep the local `pnpm research:worker` script unchanged because the project-managed pnpm version is
  correct outside the Nixpacks runtime-path mismatch.
- Document the direct Node command and cache-free rebuild requirement in the Coolify deployment
  instructions.

## Verification

- `nixpacks plan -f json .` resolves `pnpm-9_x` on the runtime path and pnpm 11.16.0 for the explicit
  install and build commands.
- `node --import tsx src/research-worker.ts --once` reaches the worker's expected environment
  validation without reading `pnpm-workspace.yaml`.
- The cache-free Coolify deployment starts the worker with the direct Node command.
