import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Loader } from "astro/loaders";
import type { z } from "zod";
import { parseRestrictedYaml } from "./yaml";

export function restrictedYamlLoader<T extends z.ZodType>(
  directory: string,
  schema: T,
): Loader {
  return {
    name: `mountain-runners-restricted-yaml:${directory}`,
    async load({ config, generateDigest, logger, parseData, store, watcher }) {
      const directoryUrl = new URL(directory, config.root);
      const directoryPath = fileURLToPath(directoryUrl);

      const sync = async () => {
        const entries = await readdir(directoryPath, { withFileTypes: true });
        const files = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
          .sort((left, right) => left.name.localeCompare(right.name));

        store.clear();

        for (const file of files) {
          const filePath = path.join(directoryPath, file.name);
          const source = await readFile(filePath, "utf8");
          const id = path.basename(file.name, ".yaml");
          const restrictedData = parseRestrictedYaml(source, schema);

          if (
            typeof restrictedData !== "object" ||
            restrictedData === null ||
            !("id" in restrictedData) ||
            restrictedData.id !== id
          ) {
            throw new Error(
              `${filePath}: entry id must match its YAML file name (${id})`,
            );
          }

          const data = await parseData({ id, data: restrictedData, filePath });
          store.set({
            id,
            data,
            digest: generateDigest(source),
            filePath: path.relative(fileURLToPath(config.root), filePath),
          });
        }
      };

      await sync();

      if (watcher) {
        watcher.add(directoryPath);
        const reload = async (changedPath: string) => {
          if (
            path.dirname(changedPath) === directoryPath &&
            changedPath.endsWith(".yaml")
          ) {
            logger.info(`Reloading restricted YAML from ${directory}`);
            await sync();
          }
        };
        watcher.on("add", reload);
        watcher.on("change", reload);
        watcher.on("unlink", reload);
      }
    },
  };
}
