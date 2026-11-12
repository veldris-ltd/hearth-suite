# Desktop icons

Tauri bundles platform icons referenced by `tauri.conf.json` → `bundle.icon`:

- `32x32.png`, `128x128.png`, `128x128@2x.png`, Linux / general
- `icon.icns`, macOS
- `icon.ico`, Windows

Generate the full set from a single 1024×1024 source PNG:

```sh
pnpm --filter @hearth/desktop tauri icon path/to/hearth-1024.png
```

The CI `package` job runs this step before bundling, so the brand source image
(from `@hearth/design-system`) is the single source of truth and the binary
icons are not committed.
