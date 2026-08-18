# Agent Instructions

## Scope And Sources Of Truth

- This is an open-source project. Treat all tracked files, commit messages and
  pull-request text as public.
- Read `README.md`, `DESIGN.md` and the relevant document in `docs/` before
  proposing or making a non-trivial change.
- `docs/decisions/` records accepted architectural decisions. Do not silently
  reverse them; propose an ADR when a decision must change.
- The Astro application and its content schemas are implemented in `apps/web`.
  Do not scaffold the planned Hono services or deployment tooling unless
  explicitly requested by an approved specification.

## Collaboration

- Keep changes small, focused and reviewable. Do not mix refactors with feature
  or content changes.
- Never overwrite or revert work you did not create.
- Update the relevant documentation when a technical decision, boundary or
  workflow changes.
- Use English for code, commit messages, `AGENTS.md` and `DESIGN.md`. Use
  Catalan for project documentation, user-facing content and pull-request
  descriptions.

## Code Conventions

Follow [`docs/code-conventions.md`](docs/code-conventions.md) when writing or
reviewing `apps/web` code. The review of every PR checks these rules:

- Keep pages (`src/pages/`) thin: only `getStaticPaths`, data loading, metadata
  and composition. Pages never contain `Intl.DateTimeFormat`, status
  derivations or host extraction.
- Keep presentation helpers pure in `src/lib/presentation/`: they return data or
  i18n message keys, and never import Astro or Paraglide. The locale contract
  follows the data (ADR 0004 and the amended rule 3 of ADR 0006): a helper
  receives the locale exactly when it reads locale-indexed fields
  (`Record<Locale, ...>`) or produces localized output; helpers over
  locale-free data (typed status keys, URL building, identifier extraction,
  type ordering, markdown parsing) omit it and never take an inert parameter.
  Components resolve message keys with the corresponding locale.
- Content stores semantic values, never render protocols or HTML attributes
  (`mailto:`, `tel:`...): components or `src/lib/presentation/` helpers build
  the `href` and attributes. Model validations reject anything the render could
  interpret (`%`, `?`, `#`, whitespace or control characters) without
  replicating presentation decisions.
- Extract the second occurrence of a date, status or URL helper to
  `src/lib/presentation/` and reuse it; never duplicate it in pages or
  components.
- Compose detail templates from section components; each section owns its data,
  messages and visibility guard, so the template reads as an outline.
- Define shared string values (message keys, statuses, time zones) as typed
  constants and derive union types from those constants; do not scatter magic
  strings through pages, components or helpers.
- Never use single-letter variables or aliases: every identifier must describe
  what it represents (e.g. `messages`, not `m`). Import bindings from external
  libraries keep their documented names (`z` from Zod).
- Prefer human readability over brevity: explicit branches, early returns and
  small named functions over nested ternaries.
- Write the smallest correct change: no speculative generality, no "just in
  case" guards, branches, props or defaults, and no checks the type system
  already guarantees. Extract helpers and components at the second real
  occurrence, never in advance.
- Never change visual output, routes, content or existing E2E selectors when
  refactoring.

## Security

- Never commit, print, paste or request secrets. Use environment variables and
  document only their names in `.env.example`.
- Do not add credentials to URLs, test fixtures, logs, screenshots or examples.
- Do not weaken authentication, authorization, validation, TLS, security
  headers or dependency integrity checks for convenience.
- Prefer minimal dependencies. Pin dependencies through the project lockfile
  and review new third-party services or telemetry.
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
- Changes may reach production only through a reviewed pull request merged into
  the protected default branch and, once phase 5 implements it, the approved
  deployment pipeline. Local agent sessions never deploy.

## Verification

- Run the smallest relevant checks before declaring work complete.
- Do not claim a check passed when the project has no applicable command yet.
- For documentation-only changes, verify links, file paths and consistency with
  the accepted ADRs.
