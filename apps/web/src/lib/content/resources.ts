import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { httpsUrlSchema } from "./urls";

const approvedRoots = ["src/assets/", "src/content-assets/"] as const;
const approvedExtensions = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
]);

function isPathContained(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function isSafeLocalResourcePath(value: string): boolean {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#") ||
    path.posix.isAbsolute(value) ||
    !approvedRoots.some((root) => value.startsWith(root))
  ) {
    return false;
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return false;
  }

  return (
    path.posix.normalize(value) === value &&
    approvedExtensions.has(path.posix.extname(value))
  );
}

export const localResourcePathSchema = z
  .string()
  .refine(isSafeLocalResourcePath, {
    error: "Expected a normalized resource path under an approved asset root",
  });

export const localResourceSchema = z.strictObject({
  kind: z.literal("local"),
  path: localResourcePathSchema,
});

export const externalResourceSchema = z.strictObject({
  kind: z.literal("external"),
  url: httpsUrlSchema,
});

export const safeResourceSchema = z.discriminatedUnion("kind", [
  localResourceSchema,
  externalResourceSchema,
]);

export async function resolveLocalResourcePath(
  appDirectory: string,
  resourcePath: string,
): Promise<string> {
  const validatedPath = localResourcePathSchema.parse(resourcePath);
  const approvedRoot = approvedRoots.find((root) =>
    validatedPath.startsWith(root),
  );
  if (approvedRoot === undefined)
    throw new Error("Resource root is not approved");

  const appPath = await realpath(appDirectory);
  let rootPath = path.resolve(appDirectory);
  for (const segment of approvedRoot.split("/").filter(Boolean)) {
    rootPath = path.join(rootPath, segment);
    if ((await lstat(rootPath)).isSymbolicLink()) {
      throw new Error("Content resources cannot use symbolic links");
    }
  }

  const relativeResourcePath = path.posix.relative(approvedRoot, validatedPath);
  let currentPath = rootPath;

  for (const segment of relativeResourcePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    if ((await lstat(currentPath)).isSymbolicLink()) {
      throw new Error("Content resources cannot use symbolic links");
    }
  }

  if (!(await lstat(currentPath)).isFile()) {
    throw new Error("Content resources must be regular files");
  }

  const [realRoot, realResource] = await Promise.all([
    realpath(rootPath),
    realpath(currentPath),
  ]);

  if (!isPathContained(appPath, realRoot)) {
    throw new Error("Content resource root resolves outside the application");
  }
  if (!isPathContained(realRoot, realResource)) {
    throw new Error("Content resource resolves outside its approved root");
  }

  return realResource;
}
