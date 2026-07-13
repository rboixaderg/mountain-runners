---
name: project-context
description: Use when working on Mountain Runners architecture, content, design, security, deployment or agent workflows to load the governing project documentation first.
---

# Mountain Runners Project Context

Before proposing or changing project code, configuration or documentation:

1. Read `AGENTS.md` and `README.md`.
2. Read `DESIGN.md` for user-facing visual work.
3. Read the relevant file in `docs/` and the matching ADR before altering an
   accepted architectural boundary.
4. Treat all tracked text as public. Never include secrets or private data.
5. Do not scaffold planned systems, publish changes or deploy unless the user
   explicitly requests it.

For future content changes, preserve the distinction between unpublished and
published material. For public-chat work, preserve its read-only boundary. For
editorial-agent work, preserve branch, validation and pull-request controls.
