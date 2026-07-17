# Agent Instructions

## Scope And Sources Of Truth

- This is an open-source project. Treat all tracked files, commit messages and
  pull-request text as public.
- Read `README.md`, `DESIGN.md` and the relevant document in `docs/` before
  proposing or making a non-trivial change.
- `docs/decisions/` records accepted architectural decisions. Do not silently
  reverse them; propose an ADR when a decision must change.
- The application and planned services do not exist yet. Do not scaffold Astro,
  Hono, deployment tooling or content schemas unless explicitly requested.

## Collaboration

- Keep changes small, focused and reviewable. Do not mix refactors with feature
  or content changes.
- Never overwrite or revert work you did not create.
- Update the relevant documentation when a technical decision, boundary or
  workflow changes.
- Use English for code, commit messages, `AGENTS.md` and `DESIGN.md`. Use
  Catalan for project documentation, user-facing content and pull-request
  descriptions.

## Security

- Never commit, print, paste or request secrets. Use environment variables and
  document only their names in `.env.example`.
- Do not add credentials to URLs, test fixtures, logs, screenshots or examples.
- Do not weaken authentication, authorization, validation, TLS, security
  headers or dependency integrity checks for convenience.
- Prefer minimal dependencies. Pin dependencies through the project lockfile
  once the application exists and review new third-party services or telemetry.
- Treat public-chat input as untrusted and keep the future editorial assistant
  restricted to allowed content paths and explicit scripts.
- Do not run destructive commands or commands that publish, deploy, push,
  create releases, alter infrastructure or change remote configuration without
  explicit user approval in the current conversation.

## Git And Review

- Keep the primary worktree on `main` and reserve it for phase planning,
  tracking documentation and adding or refining tasks.
- Implement every task assigned to a development phase in a dedicated Git
  worktree, on its own short-lived branch created from the latest `main`. Do not
  make implementation changes in the primary worktree.
- Worktree isolation does not bypass branch protection: implementation changes
  still require validation and a reviewed pull request before merging.
- Use Conventional Commits: `type(scope): summary`, with a concise imperative
  summary. Allowed types include `feat`, `fix`, `docs`, `refactor`, `test`,
  `build`, `ci`, `chore` and `security`.
- Title a pull request for a specification task as
  `type(phase-N-tN.M): summary`, using the exact phase and task identifiers from
  the specification. A pull request that only defines or changes a phase
  specification uses `docs(specs-phase-N): summary`. The title must describe
  only the work covered by that pull request.
- Do not create commits unless explicitly asked. When asked, inspect status and
  diff, stage only intended files and use a semantic commit message.
- Agents must never merge a pull request or enable auto-merge. A human
  maintainer always performs the final merge.
- Changes reach production only through a reviewed pull request merged into the
  protected default branch and the configured CI/CD pipeline.

## Verification

- Run the smallest relevant checks before declaring work complete.
- Do not claim a check passed when the project has no applicable command yet.
- For documentation-only changes, verify links, file paths and consistency with
  the accepted ADRs.
