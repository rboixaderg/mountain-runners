---
name: spec-authoring
description: Use when defining a Mountain Runners phase, feature, task, or implementation specification. Creates a scoped, reviewable Catalan spec using the project convention.
---

# Mountain Runners Specification Authoring

Create or revise specifications under `docs/specs/`. The specification defines
what will be built and how completion is verified. It is not an implementation
plan, task checklist, or pull-request description.

## Required Context

Before writing, read:

1. `AGENTS.md`, `README.md`, and `docs/specs/README.md`.
2. The applicable roadmap, backlog entries, ADRs, architecture and content
   documents.
3. `DESIGN.md` for user-facing scope.
4. Related previous specifications and active local changes.

Treat all tracked text as public. Do not include secrets, private personal data,
unreviewed inherited content, or deployment credentials.

## Clarify Before Writing

Ask only for decisions that materially change scope, architecture, content
ownership, privacy, security, operations, or acceptance. Reuse accepted ADRs and
record confirmed decisions in the specification rather than leaving them implicit.

For a small feature, do not expand it into a phase. Keep the requirements and
tests proportional, but retain every required section from the convention.

## Authoring Workflow

1. Create a descriptive kebab-case file in `docs/specs/`.
2. Follow the ordered sections in `docs/specs/README.md` exactly.
3. State concrete, observable outcomes and exclusions. Do not write vague goals
   such as “improve UX” without a verifiable result.
4. Define one or more implementation tasks before implementation starts. For
   each, state scope, exclusions, dependencies, observable result, minimum
   checks and a dedicated PR or justified grouping. A single-task specification
   has one row and one task subsection.
5. Put detailed domain requirements after delivery tracking. Keep stable
   structure in code and changing editorial data in restricted YAML, per ADR 0004.
6. Define the smallest relevant automated and manual checks. Do not claim full
   WCAG conformance from automation alone.
7. Link the specification from the roadmap only when it is an approved roadmap
   delivery; otherwise link it from the relevant backlog entry.
8. Run Prettier and `git diff --check`. Review the diff for conflicts with ADRs,
   duplicated sources of truth, accidental scope expansion and private data.
9. Before declaring the spec ready, verify every required section exists and the
   task table has a matching subsection for every task identifier.

## Pull Request Handoff

Each draft PR links the specification, names the units and acceptance criteria it
covers, records executed checks, and identifies remaining decisions. Implementation
uses a dedicated worktree from the latest `main`; specification planning remains
in the primary worktree.
