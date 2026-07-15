import { describe, expect, it } from "vitest";
import {
  markdownLimits,
  parseRestrictedMarkdown,
  renderRestrictedMarkdown,
} from "../lib/content/markdown";

describe("restricted Markdown", () => {
  it("renders the approved subset", () => {
    expect(
      renderRestrictedMarkdown(
        "Text with **strength**, *emphasis* and [a link](https://example.com).\n\n- One\n- Two",
      ),
    ).toBe(
      '<p>Text with <strong>strength</strong>, <em>emphasis</em> and <a href="https://example.com/">a link</a>.</p>\n<ul><li><p>One</p></li><li><p>Two</p></li></ul>',
    );
  });

  it("escapes text and link attributes", () => {
    expect(
      renderRestrictedMarkdown(
        '[A & B](https://example.com "A &quot;title&quot;")',
      ),
    ).toBe(
      '<p><a href="https://example.com/" title="A &quot;title&quot;">A &amp; B</a></p>',
    );
  });

  it.each([
    "# Heading",
    "<script>alert(1)</script>",
    '<iframe src="https://example.com"></iframe>',
    "![image](https://example.com/image.jpg)",
    "`code`",
    "> quote",
    "---",
  ])("rejects unsupported syntax %s", (markdown) => {
    expect(() => parseRestrictedMarkdown(markdown)).toThrow(/Unsupported/u);
  });

  it.each([
    "[bad](http://example.com)",
    "[bad](javascript:alert(1))",
    "[bad](javascript&#x3A;alert(1))",
    "[bad](data:text/html;base64,PHNjcmlwdD4=)",
  ])("rejects unsafe link %s", (markdown) => {
    expect(() => parseRestrictedMarkdown(markdown)).toThrow(
      /Unsafe Markdown link/u,
    );
  });

  it("rejects oversized Markdown", () => {
    expect(() => parseRestrictedMarkdown("a".repeat(100_001))).toThrow(
      /100000 characters/u,
    );
  });

  it("rejects excessive syntax complexity before parsing", () => {
    const repetitions = Math.floor(markdownLimits.maxSyntaxMarkers / 6) + 1;
    const markdown = `${"_**".repeat(repetitions)}x${"**_".repeat(repetitions)}`;

    expect(() => parseRestrictedMarkdown(markdown)).toThrow(/syntax markers/u);
  });

  it.each(["- ", "+ ", "> ", "1. "])(
    "rejects excessive %scontainer nesting before parsing",
    (marker) => {
      const markdown = `${marker.repeat(markdownLimits.maxSyntaxMarkers + 1)}x`;

      expect(() => parseRestrictedMarkdown(markdown)).toThrow(
        /syntax markers/u,
      );
    },
  );

  it("rejects excessive line complexity before parsing", () => {
    const paragraphs = "Text\n\n".repeat(markdownLimits.maxLines);
    const list = "-\n".repeat(markdownLimits.maxLines);

    expect(() => parseRestrictedMarkdown(paragraphs)).toThrow(/lines/u);
    expect(() => parseRestrictedMarkdown(list)).toThrow(/lines/u);
    expect(() =>
      parseRestrictedMarkdown("-\r".repeat(markdownLimits.maxLines)),
    ).toThrow(/lines/u);
  });
});
