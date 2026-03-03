# UpCloud Explorer Multi-Extension Monorepo

This workspace now contains multiple VS Code extensions that share a common library.

## Layout

- `common`: Shared TypeScript helpers used by all extensions
- `extension-upcloud`: UpCloud Explorer extension (resource manager tree)
- `extension-example`: Minimal example extension that uses `common`

## Development

```bash
npm install
npm run compile
```

Use `npm run watch` for incremental builds across all projects.

In VS Code, run one of these launch configurations:

- **Run UpCloud Extension**
- **Run Example Extension**

## UpCloud extension requirements

- Install `upctl`: https://upcloudltd.github.io/upcloud-cli/latest/
- Authenticate with UpCloud, for example: `upctl account login --with-token`
