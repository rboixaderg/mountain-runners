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
- Keep `README.md` to the current state; decisions live in `docs/decisions/`.
- Use English for code, commit messages, `AGENTS.md` and `DESIGN.md`. Use
  Catalan for project documentation, user-facing content and pull-request
  descriptions.

## Documentation Ownership

Load the `docs-ownership` skill before editing documentation. Every content type
has a single owner document, and the other documents link to it:

| Content type                                                | Owner document                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements and acceptance                                 | The specification in `docs/specs/`                                                                                                                             |
| Accepted decisions                                          | The ADR in `docs/decisions/`                                                                                                                                   |
| Implemented behaviour of a component                        | Its single living document (the private agent: `tools/server/agent/README.md`)                                                                                 |
| Operation procedures (install, update, rollback, incidents) | The component document in `docs/operations/` (`web-and-releases.md`, `previews.md`, `agent.md`), with the shared server content in `docs/operations/README.md` |
| The documentation map                                       | `docs/README.md`                                                                                                                                               |
| External and project skills                                 | `.agents/skills/` and its manifest                                                                                                                             |

- Other documents link to the owner and never summarise it.
- Living documents are organised by component, not by task, and task identifiers
  such as (T8.4) do not appear in their headings.
- Living documents describe the current state only: when a feature is removed,
  delete its description instead of annotating it. ADRs and specifications are
  records and are exempt.
- A pull request that changes behaviour updates the owner document in the same
  pull request and does not duplicate it elsewhere.
- Task working documents live with their phase specification.

A living document is any tracked Markdown file under `docs/`, `tools/` or
`packages/`, except the files in `docs/decisions/` and `docs/specs/`.

## Agent Tooling

- `.agents/skills/` is the single source of truth for project skills. OpenCode
  reads it through `opencode.json`, Pi discovers it directly and Claude Code
  reads it through the per-skill symbolic links in `.claude/skills/`.
- When you add, rename or remove a skill in `.agents/skills/`, update the
  matching entry with
  `ln -s ../../.agents/skills/<name> .claude/skills/<name>`. Never copy a skill
  into `.claude/skills/`. `tools/agent-skills/` checks that both directories
  list the same skills.
- Keep skill frontmatter to the Agent Skills fields (`name`, `description`,
  `license`, `compatibility`, `metadata`) so every agent tool loads the skill
  unchanged.
- Own skills carry `metadata.version`; bump it when the skill's behaviour
  changes, not for a typo fix.
- External skills stay byte-identical to `skills-manifest.json`, and only a
  reviewed pull request re-pins them. `docs/skills.md` is the registry.
- `CLAUDE.md` only imports `AGENTS.md`. Keep project instructions in
  `AGENTS.md` and tool-specific files free of duplicated rules.

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
  case" guards, branches, props or defaults. Do not repeat checks the type system
  guarantees for internal values; preserve runtime validation at trust
  boundaries. Extract reusable helpers and fragments at the second real
  occurrence, never in advance; keep components required by the accepted
  architecture even when they are used once.
- Use named Tailwind utilities backed by theme tokens for ordinary styles. Do
  not turn bespoke CSS into arbitrary Tailwind values merely to keep it in a
  class attribute.
- Promote a repeated value to a `@theme` token at the second semantically
  equivalent occurrence, or when `DESIGN.md` already defines the role. Edit
  `global.css` in any phase only to add or adjust approved scale tokens
  consumed in that same phase. Prefer the closed scales in `DESIGN.md` over
  near-equal historical values; do not invent per-page spacing, tracking or
  shadow exceptions.
- Keep custom CSS minimal and scoped to the component or template that owns it.
  Every custom rule must have a concrete reason that named utilities and theme
  tokens cannot express clearly.
- Treat CSS classes as implementation details, never as E2E hooks. Tests prefer
  role and accessible name, labels, visible text and semantic relationships.
  Use `data-testid` only when no semantic alternative exists, and document the
  reason next to the test.
- Refactors preserve visual output, routes, content and user-observable
  behavior. Selector syntax may change when those contracts remain intact.

## Preview Server Tooling

- In `tools/server/preview/`, give each new command its own
  `commands/<name>/` directory and each process, persistent or short-lived, its
  own `processes/<name>/` directory. Different names for the same executable
  share one directory.
- Name command entry points `cli.mjs` and process entry points `main.mjs`.
  Keep supporting modules with their owner; leave only modules used by more
  than one program at the preview root. Use descriptive names for those modules.
- Keep the installed layout, symlinks, systemd units, tests and the directory
  map in [`docs/operations/`](docs/operations/README.md) in sync. This rule does
  not require reorganizing the existing `tools/server/release/` implementation.

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
- Do not remove or hide `PreviewNotice` or the `PUBLIC_PREVIEW` build switch.
  This rule guides agents; it is not a security boundary against PR authors.
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
- Agents must never merge a pull request on their own initiative and never
  enable auto-merge. A human decides the final merge.
- The private phase 8 agent is the only scoped exception. Its merge amendment
  to ADR 0013 is approved (PR #183), but no permission is active until its
  controls are verified. It merges a pull request only on a verified group
  member's explicit `/merge` request (optionally `/merge <PR>`), resolved and
  pinned to the pull request and commit the service last reported to that
  thread, with every required check green and the branch up to date. It never merges on its own initiative, from untrusted text, with newer
  commits than the reported one or with an administrator bypass. Local sessions
  and every other agent keep the no-merge rule.
- Changes may reach production only through a reviewed pull request merged into
  the protected default branch and the approved deployment pipeline. Local agent
  sessions never deploy the web.
- Two server components are installed manually instead: the private phase 8
  agent service
  ([`docs/operations/agent.md`](docs/operations/agent.md#actualitzar)) and the
  release and preview server tooling
  ([`docs/operations/web-and-releases.md`](docs/operations/web-and-releases.md#actualitzar-les-eines-en-un-vps-existent)).
  A local agent session on a maintainer-controlled machine may start, stop,
  restart or update them only from a reviewed `main` commit, with the
  maintainer's explicit approval in the current conversation. The Telegram
  agent, its Pi sandbox and any approval sent through Telegram never authorize
  this: the Telegram agent never deploys anything, itself included.

## Verification

- Follow `docs/testing-strategy.md` and load `frontend-testing` when adding,
  changing or reviewing tests. Choose the least costly level that detects the
  regression; preserve independent boundary tests and page-wiring coverage.
- Run the smallest relevant checks before declaring work complete.
- The local `pre-push` hook only runs the fast `pnpm check:local`; it does not
  replace the checks the change requires. When a change adds or modifies an E2E
  journey, run it locally before declaring the work complete; CI still runs the
  full suite.
- Do not claim a check passed when the project has no applicable command yet.
- Record validation evidence in the pull request and CI, not in additional
  repository reports, unless an approved specification explicitly requires them.
- Do not create companion documents for editorial entries. Article content and
  publication state belong only in the entry's YAML; record review notes and
  pending approvals in the pull request.
- For documentation-only changes, verify links, file paths and consistency with
  the accepted ADRs.
