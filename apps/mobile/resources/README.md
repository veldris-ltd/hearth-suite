# Mobile app icons (Capacitor)

These source images are generated from the Hearth Suite app-icon SVG masters in
`@hearth/design-system` (`packages/design-system/assets/app-icon/`) by:

```sh
pnpm --filter @hearth/design-system build:icons
```

- `icon.png` (1024×1024), keyhole flame on the ember gradient (the app tile).
- `icon-foreground.png` / `icon-background.png`, Android adaptive layers.

`@capacitor/assets` consumes this folder to produce the native iOS/Android icon
and splash sets. It is fetched on demand at a pinned version (`pnpm dlx
@capacitor/assets@3.0.5`) rather than installed as a devDependency, because its
dependency tree carried unpatched advisories into every install:

```sh
pnpm --filter @hearth/mobile run assets
```

Do not edit these PNGs by hand, re-run `build:icons` to regenerate from the SVG.
