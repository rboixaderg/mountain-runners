// Prerender routes share in-flight work. The development server must reread
// content and images on each request so edits are visible without a restart.
export function createBuildCache<Value>() {
  const results = new Map<string, Promise<Value>>();

  return (key: string, load: () => Promise<Value>): Promise<Value> => {
    if (!import.meta.env?.PROD) return load();

    const existing = results.get(key);
    if (existing) return existing;

    const pending = load();
    results.set(key, pending);
    return pending;
  };
}
