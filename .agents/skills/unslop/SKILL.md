---
name: unslop
description: Remove AI writing patterns from prose and explanations. Always apply when writing or editing text. For technical explanations, documentation and procedures, use the ASD-STE100-inspired technical mode.
---

# Unslop

Edit text to remove AI patterns. Use natural language for general prose and the
technical mode below for technical explanations and instructions.

## Language context

Keep the language requested by the user or used by the document. Do not translate
text just to apply this skill. Use project language conventions when specified.
The English word lists are examples, not a ban on valid technical terms. In Catalan,
check the following equivalents in context:

- Vocabulari d'IA i èmfasi buit: "addicionalment", "crucial", "fomentar",
  "endinsar-se", "potenciar", "obtenir", "interacció", "intricat", "paisatge"
  (abstracte), "pivotal", "mostrar", "tapís" (abstracte), "testimoni",
  "subratllar", "vibrant", "moment clau", "preparant el terreny per a",
  "empremta indeleble".
- Atribucions vagues: "Els experts creuen", "L'informe del sector suggereix",
  "Alguns crítics argumenten".
- Farciment: "Amb la finalitat de" es converteix en "Per"; "A causa del fet
  que" es converteix en "Perquè"; "És important tenir en compte que" s'elimina.
- Maneres elegants de dir "és": "serveix com a", "es presenta com a",
  "presumeix de", "compta amb" es converteixen en "és" o "té".

## Process

1. Choose the mode. Use technical mode for technical explanations and instructions.
2. Scan for the patterns below.
3. Rewrite. Preserve meaning, match the intended tone and keep the original language.
4. For general prose, add soul. For technical text, apply the technical rules instead.
5. Audit for remaining AI patterns. For technical text, also run the technical final check.

## Technical mode, inspired by ASD-STE100

Use this mode automatically for technical explanations, architecture descriptions,
API documentation, troubleshooting, setup guides and operational procedures.
The user does not need to request STE explicitly. For mixed content, apply it to
the technical parts and use the general style elsewhere.

This mode takes priority over "Adding soul" and any style rule that conflicts
with technical accuracy, safety or required syntax. Do not add opinions, informal
asides, deliberate mess or rhythm variation just to make technical text sound human.
A direct conversational tone is fine when it helps the reader.

ASD-STE100 is a controlled-English standard. These instructions adapt some of its
principles. They do not implement its complete rules or approved dictionary.
For Catalan and other languages, apply the principles without calling the result
STE-compliant. If the user requires formal conformity in English, obtain the
applicable official edition and check its rules and dictionary. If those resources
are unavailable, say that conformity cannot be verified. Do not invent approved
words or normative limits.

### Rules

1. Use one term for each technical concept. Define unfamiliar terms and acronyms
   on first use. Keep established domain terms when a simpler substitute would
   change their meaning.
2. Use short, direct sentences. Give each sentence one main idea. Keep conditions
   and their consequences together when splitting them would make the logic unclear.
3. Prefer active voice. Name the component or person that performs an action.
   Replace ambiguous pronouns with the relevant name.
4. Explain what a component does and how it works. Use concrete inputs, actions
   and outputs. Include a small example when it helps. Avoid abstract metaphors.
5. In procedures, use imperative verbs and numbered steps in execution order.
   Give each step one main action. State any prerequisite before the action.
   Put a condition before its instruction, for example "If the token has expired,
   request a new token."
6. State required values, units, paths and environment assumptions when relevant.
   Give the expected result and a way to verify it for procedures.
7. Put warnings before the hazardous action. Preserve permissions, restrictions,
   negative instructions and recovery information. Writing instructions is not
   permission to execute them.
8. Distinguish requirements, recommendations and options. Separate observed facts,
   assumptions and hypotheses. Keep uncertainty when evidence is incomplete.
9. Preserve code, commands, identifiers, quoted errors, URLs and literal syntax.
   Style rules about punctuation or vocabulary do not apply to those literals.
   Do not translate API names or change technical behavior to simplify wording.
10. Use headings, lists and tables when they clarify relationships or sequence.
    Keep necessary context, exceptions and limitations. Accuracy takes priority
    over brevity.

### Final check

- Can the reader identify the actor, action and object?
- Does each term keep the same meaning?
- Are conditions, prerequisites and warnings in the right place?
- Can the reader verify the result of each procedure?
- Have code, facts, uncertainty and safety constraints kept their meaning?

### Example in Catalan

Before: "El sistema aprofita una capa de caching per potenciar significativament
el rendiment i facilitar una experiència més fluida."

After: "La memòria cau desa una còpia de la resposta. Si la còpia encara és vàlida,
el servidor la retorna sense consultar la base de dades. Quan la còpia caduca,
el servidor torna a consultar la base de dades."

## Adding soul

Apply this section to general prose only. Technical mode takes priority.

Removing patterns is half the job. Sterile, voiceless writing is just as obvious.

- **Have opinions.** React to facts instead of neutrally listing pros and cons.
- **Vary rhythm.** Short sentences. Then longer ones that take their time. Mix it up.
- **Acknowledge complexity.** "Impressive but also kind of unsettling" beats "impressive."
- **Use "I" when it fits.** First person isn't unprofessional.
- **Let some mess in.** Perfect structure looks machine-made.
- **Be specific.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am."

## Patterns to detect and fix

### Content

1. **Puffery.** "pivotal moment", "testament to", "evolving landscape", "setting the stage for", "indelible mark", "deeply rooted". Cut puffery, state what happened.
2. **Name-dropping.** Listing media outlets without context. Pick one, say what was said.
3. **Superficial -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Delete or expand with real sources.
4. **Promotional language.** "nestled", "vibrant", "breathtaking", "groundbreaking", "renowned", "stunning", "must-visit". Use neutral descriptions.
5. **Vague attributions.** "Experts believe", "Industry reports suggest", "Some critics argue". Name the source or delete.
6. **Formulaic challenges.** "Despite challenges... continues to thrive." Replace with specific facts.

### Language

7. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstract), pivotal, showcase, tapestry (abstract), testament, underscore, vibrant. Replace with plain words.
8. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Just say "is" or "has".
9. **"Not just X, but Y."** State the point directly instead.
10. **Rule of three.** Forcing ideas into groups of three. Use the natural number.
11. **Synonym cycling.** Protagonist, main character, central figure, hero all in one paragraph. Pick one, repeat it.
12. **False ranges.** "from X to Y" where X and Y aren't on a meaningful scale. List topics directly.

### Style

13. **Em dash overuse.** Avoid em dashes entirely. Use periods or commas only (no parentheses, no en dashes, no hyphen-as-dash substitutes). Em dashes are an AI tell, and reaching for parentheses instead just trades one tell for another. If a thought needs separation, end the sentence or use a comma.
14. **Colon overuse.** Colons are fine before a list or example. Not as mid-sentence connectors. "If you're coming from traditional automation: instead of registering event handlers, you describe conditions" adds nothing with the colon. Rewrite to let the point stand on its own without comparison framing. "Describing when the scheduler should fire works best as plain English." Same meaning, no crutch punctuation.
15. **Boldface overuse.** Don't bold every proper noun or acronym.
16. **Inline-header lists.** The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period, names the item, and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
19. **Curly quotes.** Replace with straight quotes.

### Communication artifacts

20. **Chatbot phrases.** "I hope this helps!", "Let me know if...", "Of course!", "Certainly!", "Found the smoking gun!" Remove.
21. **Cutoff disclaimers.** "While specific details are limited..." Find sources or remove.
22. **Sycophantic tone.** "Great question! You're absolutely right!" Respond directly.

### Filler

23. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". "It is important to note that" gets deleted.
24. **Excessive hedging.** "could potentially possibly be argued that it might" becomes "may".
25. **Generic conclusions.** "The future looks bright." State specific plans or facts.

### Jargon

26. **Abstract metaphor nouns.** Substrate, wedge, vector, locus, vantage, nexus, primitive (as noun), harness (as metaphor), surface (as in "API surface"), bedrock, scaffolding (as metaphor), modality, paradigm, gold-plating, ratchet (as metaphor), evacuate (for moving code), endgame, north star, flywheel. These read as technical but usually have a plainer concrete word. "Substrate" becomes "base". "Wedge in" becomes "add". "Vector" becomes "way" or "method". "Gold-plating" becomes "more than the job needs". "Ratchet" becomes the mechanism's real name or "a limit that only tightens". "Evacuate" becomes "move out". "Endgame" becomes "the last phase". Pick the concrete word.

### Plain speech

27. **Say what it does, not how it feels.** "the database stays close at hand", "SQL you can read", "types that follow your schema" name a feeling. The fix names the mechanism or a number: "`.toSQL()` returns the exact string sent to the database", "a column rename fails the build". Ask what the sentence tells the reader to do or know, then write that. If you can't restate it as a concrete instruction, fact, or number, cut it. One more check: if the sentence could appear unchanged in another project's docs, it says nothing about this one. Cut it.
28. **Shorten or split dense sentences.** If the reader has to backtrack to parse a sentence, break it in two or drop clauses. One idea per sentence.
29. **Active voice.** Prefer it. Catch "is/are/was/were + past participle" and name the actor: "queries are validated" becomes "the compiler validates queries", "the file is parsed by the loader" becomes "the loader parses the file". Passive is fine only when the actor is unknown or genuinely doesn't matter.
30. **Cut adverbs, or use a stronger verb.** "runs quickly" becomes "is fast" or the number. "significantly improves" becomes the measured delta. An adverb propping up a weak verb means the verb is wrong.
31. **Prefer the plain word.** "utilize" becomes "use", "leverage" becomes "use", "facilitate" becomes "help", "numerous" becomes "many", "in the event that" becomes "if". The fancier synonym is rarely clearer.