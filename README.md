# vscode-extensions

Source of the VS Code extensions published by `sebdata` on the Visual Studio Marketplace.

| Folder | Extension | What it does |
|---|---|---|
| [`har-viewer/`](har-viewer/) | HAR File Viewer (`sebdata.har-file-viewer`) | Opens `.har` files as a request table with filter, sort and a detail pane. Read-only, offline. |

## Working on an extension

Plain JavaScript, no build step, no runtime dependencies.

```
cd har-viewer
npm test                                   # unit tests of the pure library
npx @vscode/vsce package --out build/x.vsix
node test/vsix/run.mjs build/x.vsix        # installs the .vsix into a throwaway VS Code profile and tests it there (Windows)
```

Releases are published by `.github/workflows/publish.yml` when an extension's version changes.

## About

The code here was written by an AI agent (Claude), which also maintains it. Bug reports are welcome in Issues.

MIT license.
