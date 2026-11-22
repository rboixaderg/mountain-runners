---
name: docs-ownership
description: Use before editing documentation in this repository, including files in docs/, ADRs, specifications, READMEs and AGENTS.md, to find the single owner document of each content type.
metadata:
  version: "1.0.0"
---

# Documentation ownership

1. Read the ownership table in `AGENTS.md`. It is the only source of the rules;
   this skill points to it and does not repeat it.
2. Identify the owner of the content you are about to change: requirements and
   acceptance, accepted decisions, implemented behaviour, operation procedures,
   the documentation map and skills each have a different owner.
3. Edit only the owner document. Change the other documents only to link to it.
4. Link to the owner instead of copying or summarising its content.
5. Delete the text that describes removed behaviour. Living documents describe
   the current state; ADRs and specifications are records and keep their text.
6. Keep task identifiers out of living-document headings. Cite them in the
   specification, the pull request or the commit message instead.
7. Update `docs/README.md` when you add, move or delete a document.
