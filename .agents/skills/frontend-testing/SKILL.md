---
name: frontend-testing
description: Use when adding, changing or reviewing Mountain Runners tests, or choosing between unit, Astro render, build-contract and browser E2E coverage for the static Astro application.
---

# Mountain Runners frontend testing

## Governing sources

Read `../../../docs/testing-strategy.md` relative to this skill directory before
writing or reviewing tests. It is the source of truth for test-level selection,
expectations, isolation, redundancy and validation. Read the applicable project
instructions, specification and ADRs as well.

Use the existing Vitest, Astro Container, build verifiers, Playwright and Node
test suites.

## Write or fix tests

1. Describe the input or user action and the expected result. For a bug, name
   the incorrect result that the test must catch.
2. Read nearby tests. Extend an existing scenario when it already covers the
   behavior instead of adding a duplicate.
3. Choose the level using the project strategy:
   - calculation or pure rule: unit test;
   - component HTML: Astro render test;
   - published-page output: build-contract test;
   - real user interaction: browser E2E;
   - server or deployment boundary: Node operational test.
     Do not add every level for every change. Use more than one only when they
     catch different failures, such as date grouping and opening a calendar day.
4. Write the test with concrete inputs and expected results. Follow the
   strategy's rules for catalog data, semantic locators and external requests.
5. Verify that the test catches the intended error, then run the focused test
   and applicable suites and gates. Use `vitest` for API details and
   `quality-gate` for public-page validation. Report what ran and what remains
   unverified.

## Review existing tests

1. List the relevant requirements and identify which tests check each one.
2. Look for incorrect behavior that could still leave those tests passing.
   Propose a concrete missing case and explain which level should cover it.
3. Identify duplicates only when they catch the same failure in the same cases.
   Before recommending removal, name the test that preserves that coverage.
   An E2E does not replace unit boundary cases; helper tests do not prove that
   a page uses the helper.
4. Report missing cases, duplicates and weak assertions with file references.
   Distinguish findings from inspection from failures reproduced by execution.
   For a review-only request, do not modify tests.
