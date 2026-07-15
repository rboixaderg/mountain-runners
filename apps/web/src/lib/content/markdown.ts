import type {
  Link,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { normalizeHttpsUrl } from "./urls";

export const markdownLimits = {
  maxCharacters: 100_000,
  maxDepth: 20,
  maxLines: 2_000,
  maxNodes: 10_000,
  maxSyntaxMarkers: 2_000,
} as const;

type MarkdownState = { nodes: number };

function inspectMarkdownNode(depth: number, state: MarkdownState): void {
  state.nodes += 1;
  if (state.nodes > markdownLimits.maxNodes) {
    throw new Error(`Markdown exceeds ${markdownLimits.maxNodes} nodes`);
  }
  if (depth > markdownLimits.maxDepth) {
    throw new Error(`Markdown exceeds ${markdownLimits.maxDepth} levels`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertPhrasingContent(
  node: PhrasingContent,
  depth: number,
  state: MarkdownState,
): void {
  inspectMarkdownNode(depth, state);

  switch (node.type) {
    case "text":
      return;
    case "strong":
    case "emphasis":
      node.children.forEach((child) =>
        assertPhrasingContent(child, depth + 1, state),
      );
      return;
    case "link": {
      const normalizedUrl = normalizeHttpsUrl(node.url);
      if (normalizedUrl === undefined) {
        throw new Error(`Unsafe Markdown link: ${node.url}`);
      }
      node.url = normalizedUrl;
      node.children.forEach((child) =>
        assertPhrasingContent(child, depth + 1, state),
      );
      return;
    }
    default:
      throw new Error(`Unsupported Markdown node: ${node.type}`);
  }
}

function assertListItem(
  node: ListItem,
  depth: number,
  state: MarkdownState,
): void {
  inspectMarkdownNode(depth, state);

  if (node.checked !== null && node.checked !== undefined) {
    throw new Error("Markdown task lists are not supported");
  }

  for (const child of node.children) {
    if (child.type === "paragraph") {
      inspectMarkdownNode(depth + 1, state);
      child.children.forEach((item) =>
        assertPhrasingContent(item, depth + 2, state),
      );
    } else if (child.type === "list") assertList(child, depth + 1, state);
    else throw new Error(`Unsupported Markdown node in list: ${child.type}`);
  }
}

function assertList(node: List, depth: number, state: MarkdownState): void {
  inspectMarkdownNode(depth, state);
  for (const child of node.children) assertListItem(child, depth + 1, state);
}

function assertRootContent(
  node: RootContent,
  depth: number,
  state: MarkdownState,
): void {
  if (node.type === "paragraph") {
    inspectMarkdownNode(depth, state);
    node.children.forEach((child) =>
      assertPhrasingContent(child, depth + 1, state),
    );
  } else if (node.type === "list") assertList(node, depth, state);
  else throw new Error(`Unsupported Markdown node: ${node.type}`);
}

export function parseRestrictedMarkdown(source: string): Root {
  if (source.length > markdownLimits.maxCharacters) {
    throw new Error(
      `Markdown exceeds ${markdownLimits.maxCharacters} characters`,
    );
  }

  const lineCount = source.split(/\r\n?|\n/u).length;
  if (lineCount > markdownLimits.maxLines) {
    throw new Error(`Markdown exceeds ${markdownLimits.maxLines} lines`);
  }

  const inlineSyntaxMarkers = source.match(/[*_[\]()]/gu)?.length ?? 0;
  const containerMarkers =
    source.match(/(?:^|(?<=[ \t]))(?:[-+>]|\d+\.)(?=[ \t])/gmu)?.length ?? 0;
  const syntaxMarkers = inlineSyntaxMarkers + containerMarkers;
  if (syntaxMarkers > markdownLimits.maxSyntaxMarkers) {
    throw new Error(
      `Markdown exceeds ${markdownLimits.maxSyntaxMarkers} syntax markers`,
    );
  }

  const tree = unified().use(remarkParse).parse(source) as Root;
  const state = { nodes: 1 };
  tree.children.forEach((node) => assertRootContent(node, 2, state));
  return tree;
}

function renderPhrasingContent(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "strong":
      return `<strong>${node.children.map(renderPhrasingContent).join("")}</strong>`;
    case "emphasis":
      return `<em>${node.children.map(renderPhrasingContent).join("")}</em>`;
    case "link":
      return renderLink(node);
    default:
      throw new Error(`Unsupported Markdown node: ${node.type}`);
  }
}

function renderLink(node: Link): string {
  const title = node.title ? ` title="${escapeHtml(node.title)}"` : "";
  return `<a href="${escapeHtml(node.url)}"${title}>${node.children.map(renderPhrasingContent).join("")}</a>`;
}

function renderListItem(node: ListItem): string {
  return `<li>${node.children.map(renderContent).join("")}</li>`;
}

function renderList(node: List): string {
  const tag = node.ordered ? "ol" : "ul";
  const start =
    node.ordered && node.start && node.start !== 1
      ? ` start="${node.start}"`
      : "";
  return `<${tag}${start}>${node.children.map(renderListItem).join("")}</${tag}>`;
}

function renderContent(
  node: RootContent | ListItem["children"][number],
): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${node.children.map(renderPhrasingContent).join("")}</p>`;
    case "list":
      return renderList(node);
    default:
      throw new Error(`Unsupported Markdown node: ${node.type}`);
  }
}

export function renderRestrictedMarkdown(source: string): string {
  return parseRestrictedMarkdown(source).children.map(renderContent).join("\n");
}
