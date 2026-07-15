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

const maxMarkdownCharacters = 100_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertPhrasingContent(node: PhrasingContent): void {
  switch (node.type) {
    case "text":
      return;
    case "strong":
    case "emphasis":
      node.children.forEach(assertPhrasingContent);
      return;
    case "link": {
      const normalizedUrl = normalizeHttpsUrl(node.url);
      if (normalizedUrl === undefined) {
        throw new Error(`Unsafe Markdown link: ${node.url}`);
      }
      node.url = normalizedUrl;
      node.children.forEach(assertPhrasingContent);
      return;
    }
    default:
      throw new Error(`Unsupported Markdown node: ${node.type}`);
  }
}

function assertListItem(node: ListItem): void {
  if (node.checked !== null && node.checked !== undefined) {
    throw new Error("Markdown task lists are not supported");
  }

  for (const child of node.children) {
    if (child.type === "paragraph")
      child.children.forEach(assertPhrasingContent);
    else if (child.type === "list") assertList(child);
    else throw new Error(`Unsupported Markdown node in list: ${child.type}`);
  }
}

function assertList(node: List): void {
  for (const child of node.children) assertListItem(child);
}

function assertRootContent(node: RootContent): void {
  if (node.type === "paragraph") node.children.forEach(assertPhrasingContent);
  else if (node.type === "list") assertList(node);
  else throw new Error(`Unsupported Markdown node: ${node.type}`);
}

export function parseRestrictedMarkdown(source: string): Root {
  if (source.length > maxMarkdownCharacters) {
    throw new Error(`Markdown exceeds ${maxMarkdownCharacters} characters`);
  }

  const tree = unified().use(remarkParse).parse(source) as Root;
  tree.children.forEach(assertRootContent);
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
