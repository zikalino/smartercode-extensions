# UpCloud Explorer Multi-Extension Monorepo

This workspace now contains multiple VS Code extensions that share a common library.

## Layout

- `common`: Shared TypeScript helpers used by all extensions
- `extension-map-designer`: UpCloud Explorer extension (resource manager tree)
- `extension-example`: Minimal example extension that uses `common`
- `extension-river-raid`: River Raid-style game in a webview
- `extension-boulder-dash`: Boulder Dash-style game in a webview
- `extension-dungeon-crawler`: 3D dungeon crawler (Eye of the Beholder inspired) in a webview
- `extension-pitfall-adventure`: Pitfall II-style jungle platform adventure in a webview
- `extension-docker-runner`: Docker Runner explorer extension

## Development

```bash
npm install
npm run compile
```

Use `npm run watch` for incremental builds across all projects.

In VS Code, run one of these launch configurations:

- **Run UpCloud Extension**
- **Run Example Extension**
- **Run River Raid Extension**
- **Run Boulder Dash Extension**
- **Run Dungeon Crawler Extension**
- **Run Pitfall Adventure Extension**
- **Run Docker Runner Extension**

## UpCloud extension requirements

- Install `upctl`: https://upcloudltd.github.io/upcloud-cli/latest/
- Authenticate with UpCloud, for example: `upctl account login --with-token`
