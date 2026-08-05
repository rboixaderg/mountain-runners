# Playwright MCP Tooling

This isolated package pins the local Playwright MCP server without changing the
application workspace lockfile.

Install it before starting OpenCode with the project configuration:

```sh
pnpm --dir tools/playwright-mcp install --ignore-workspace --frozen-lockfile
```

The project configuration launches the local `playwright-mcp` executable in
isolated-browser mode. Do not replace the pinned dependency with an `npx` latest
command.
