# ADR-0001: Start YC Todo from a clean application-only repository

## Status

Accepted

## Date

2026-08-15

## Context

The previous repository mixed the runnable application with personal learning
notes, App Store working notes, generated macOS metadata, and an experimental
`my_react_test` directory name. Its public history also contained many temporary
commit messages. There were no releases, forks, stars, or collaboration assets
that justified carrying that structure into the professional project.

## Decision

Create a new local repository containing only the application, source assets,
accurate public documentation, verification scripts, and project decisions.
Place the React/Vite project at the root and keep Tauri under `src-tauri/`, which
matches the official Tauri project structure:
https://v2.tauri.app/start/project-structure/

Do not import the previous Git history. Keep the previous repository unchanged
until the new local repository has been reviewed and a separate publishing
decision is made.

## Alternatives considered

### Clean the existing repository with a normal commit

Rejected because removed notes and temporary history would remain visible.

### Rewrite the existing repository history

Rejected for this migration because force-pushing is destructive and the user
explicitly prohibited upstream or GitHub changes.

## Consequences

- The new repository begins with a coherent application-only snapshot.
- Vite and its React plugin were updated to the current Vite 8-compatible
  toolchain after the production build and npm security checks were selected as
  migration acceptance gates.
- Historical implementation context is not available through the new Git log;
  significant retained decisions must be captured in ADRs instead.
- A license must be chosen before publishing the repository as open source.
