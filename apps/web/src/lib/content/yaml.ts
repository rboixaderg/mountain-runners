import { Buffer } from "node:buffer";
import type { ZodType } from "zod";
import {
  isAlias,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";

export const yamlLimits = {
  maxBytes: 1024 * 1024,
  maxDepth: 20,
  maxNodes: 10_000,
  maxScalarCharacters: 100_000,
} as const;

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

function inspectYamlNode(
  node: unknown,
  depth: number,
  state: { nodes: number },
  source: string,
): void {
  if (node === null) return;

  if (!isNode(node) && !isPair(node)) {
    throw new Error("YAML contains an unsupported node");
  }

  state.nodes += 1;
  if (state.nodes > yamlLimits.maxNodes) {
    throw new Error(`YAML exceeds ${yamlLimits.maxNodes} nodes`);
  }
  if (depth > yamlLimits.maxDepth) {
    throw new Error(`YAML exceeds ${yamlLimits.maxDepth} levels`);
  }

  if (isPair(node)) {
    if (!isScalar(node.key) || typeof node.key.value !== "string") {
      throw new Error("YAML mapping keys must be strings");
    }
    if (node.key.value === "<<")
      throw new Error("YAML merge keys are forbidden");
    if (dangerousKeys.has(node.key.value)) {
      throw new Error(`Dangerous YAML mapping key: ${node.key.value}`);
    }

    inspectYamlNode(node.key, depth, state, source);
    inspectYamlNode(node.value, depth, state, source);
    return;
  }

  if (isAlias(node)) throw new Error("YAML aliases are forbidden");
  if (node.anchor) throw new Error("YAML anchors are forbidden");
  if (node.tag?.startsWith("!"))
    throw new Error("Custom YAML tags are forbidden");

  if (isScalar(node)) {
    const sourceLength = node.range
      ? source.slice(node.range[0], node.range[1]).length
      : 0;
    if (
      sourceLength > yamlLimits.maxScalarCharacters ||
      String(node.value ?? "").length > yamlLimits.maxScalarCharacters
    ) {
      throw new Error(
        `YAML scalar exceeds ${yamlLimits.maxScalarCharacters} characters`,
      );
    }
    return;
  }

  if (isMap(node)) {
    for (const pair of node.items) {
      inspectYamlNode(pair, depth + 1, state, source);
    }
    return;
  }

  if (isSeq(node)) {
    for (const item of node.items) {
      inspectYamlNode(item, depth + 1, state, source);
    }
  }
}

export function parseRestrictedYaml<T>(source: string, schema: ZodType<T>): T {
  if (Buffer.byteLength(source, "utf8") > yamlLimits.maxBytes) {
    throw new Error(`YAML exceeds ${yamlLimits.maxBytes} bytes`);
  }

  const document = parseDocument(source, {
    merge: false,
    schema: "core",
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) throw document.errors[0];
  if (document.warnings.length > 0) throw document.warnings[0];
  if (document.directives.yaml.version !== "1.2") {
    throw new Error("Only YAML 1.2 documents are supported");
  }
  if (Object.keys(document.directives.tags).some((tag) => tag !== "!!")) {
    throw new Error("Custom YAML tag directives are forbidden");
  }

  inspectYamlNode(document.contents, 1, { nodes: 0 }, source);

  return schema.parse(document.toJS({ maxAliasCount: 0 }));
}
