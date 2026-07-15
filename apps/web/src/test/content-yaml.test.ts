import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  nonEmptyStringSchema,
  translatableSchema,
} from "../lib/content/primitives";
import { parseRestrictedYaml, yamlLimits } from "../lib/content/yaml";

const exampleSchema = z.strictObject({
  title: translatableSchema(nonEmptyStringSchema),
  order: z.number().int(),
});

describe("restricted YAML", () => {
  it("parses safe YAML 1.2 and validates it with Zod", () => {
    expect(
      parseRestrictedYaml(
        "title:\n  ca: Cursa de muntanya\n  en: Mountain race\norder: 1\n",
        exampleSchema,
      ),
    ).toEqual({
      title: { ca: "Cursa de muntanya", en: "Mountain race" },
      order: 1,
    });
  });

  it("keeps YAML 1.1-style ambiguous editorial values as strings", () => {
    expect(
      parseRestrictedYaml(
        "date: 2026-07-15\nanswer: yes\n",
        z.strictObject({ date: z.string(), answer: z.string() }),
      ),
    ).toEqual({ date: "2026-07-15", answer: "yes" });
  });

  it.each([
    ["duplicate keys", "title: { ca: Primer, ca: Segon }\norder: 1\n"],
    ["custom tags", "title: !custom { ca: Text }\norder: 1\n"],
    [
      "multiple documents",
      "title: { ca: Text }\norder: 1\n---\ntitle: { ca: Altre }\norder: 2\n",
    ],
    ["complex keys", "? [complex, key]\n: value\n"],
    ["YAML 1.1 directives", "%YAML 1.1\n---\ntitle: { ca: Text }\norder: 1\n"],
    [
      "custom tag directives",
      "%TAG !example! tag:example.com,2026:\n---\ntitle: { ca: Text }\norder: 1\n",
    ],
  ])("rejects %s", (_, yaml) => {
    expect(() => parseRestrictedYaml(yaml, z.unknown())).toThrow();
  });

  it("rejects anchors independently", () => {
    expect(() =>
      parseRestrictedYaml(
        "title: &title { ca: Text }\norder: 1\n",
        z.unknown(),
      ),
    ).toThrow(/anchors/u);
  });

  it("rejects aliases independently", () => {
    expect(() => parseRestrictedYaml("copy: *missing\n", z.unknown())).toThrow(
      /aliases/u,
    );
  });

  it("rejects merge keys independently", () => {
    expect(() =>
      parseRestrictedYaml("title:\n  <<: value\norder: 1\n", z.unknown()),
    ).toThrow(/merge keys/u);
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects the dangerous mapping key %s",
    (key) => {
      expect(() => parseRestrictedYaml(`${key}: value\n`, z.unknown())).toThrow(
        /Dangerous YAML mapping key/u,
      );
    },
  );

  it("rejects values outside the strict schema", () => {
    expect(() =>
      parseRestrictedYaml(
        "title: { ca: Text }\norder: 1\nunexpected: true\n",
        exampleSchema,
      ),
    ).toThrow();
  });

  it("rejects excessive nesting", () => {
    let yaml = "value";
    for (let level = 0; level <= yamlLimits.maxDepth; level += 1) {
      yaml = `level${level}:\n${yaml
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}`;
    }

    expect(() => parseRestrictedYaml(yaml, z.unknown())).toThrow(/levels/u);

    const compactDepth = yamlLimits.maxDepth * 1_000;
    const compactYaml = `${"[".repeat(compactDepth)}0${"]".repeat(compactDepth)}`;
    expect(() => parseRestrictedYaml(compactYaml, z.unknown())).toThrow(
      /levels/u,
    );
  });

  it("rejects excessive node counts", () => {
    const yaml = `items:\n${Array.from({ length: yamlLimits.maxNodes }, (_, index) => `  - ${index}`).join("\n")}\n`;
    expect(() => parseRestrictedYaml(yaml, z.unknown())).toThrow(/nodes/u);

    const emptyItems = `items:\n${"  -\n".repeat(yamlLimits.maxNodes + 1)}`;
    expect(() => parseRestrictedYaml(emptyItems, z.unknown())).toThrow(
      /nodes/u,
    );
  });

  it("rejects oversized string and numeric scalars", () => {
    expect(() =>
      parseRestrictedYaml(
        `value: ${"a".repeat(yamlLimits.maxScalarCharacters + 1)}\n`,
        z.unknown(),
      ),
    ).toThrow(/scalar/u);

    expect(() =>
      parseRestrictedYaml(
        `value: 0.${"0".repeat(yamlLimits.maxScalarCharacters)}\n`,
        z.unknown(),
      ),
    ).toThrow(/scalar/u);
  });

  it("measures the file limit in UTF-8 bytes", () => {
    const oversizedUtf8 = "é".repeat(Math.floor(yamlLimits.maxBytes / 2) + 1);

    expect(() => parseRestrictedYaml(oversizedUtf8, z.unknown())).toThrow(
      /bytes/u,
    );
  });
});
