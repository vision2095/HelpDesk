# LensDesk 1.3.6 — Windows and macOS

This is now the single shared source directory. The sibling `lensdesk/` path is an alias to this directory; dependencies and Git metadata live here. Legacy unique source and data are preserved under `../archives/`. See `../AGENTS.md` for coordination between editors. Linux is excluded at the user's request.

Windows distribution includes the MSI installer (LensDesk product metadata, RuntimeHost.exe application executable) and a portable ZIP fallback containing LensDesk.exe with its complete Electron runtime. Extract the whole ZIP; keep all runtime files together. Mac installers are built separately for Apple Silicon and Intel. Local Mac builds are ad-hoc signed, without Apple notarization. Windows publisher signing is not configured.

The local Mac application is updated at /Applications/LensDesk.app. Existing workspace data remains in its original application-support directory. Desktop screenshots and capture/typing permissions still depend on the OS. Do not interpret package checks or fixtures as full acceptance in every external app.

See docs/audit/TEST_REPORT.md for actual verification and docs/audit/KNOWN_LIMITATIONS.md for remaining functionality and deployment requirements. Hosted production deployment, live payments, real email delivery and live AI verification remain outside the completed local release checks.

## Development

```sh
npm ci
npm test
npm run build
npm run test:reference
npm run test:settings
npm run test:hosted-browser
npm run test:stream-browser
```

## Packaging

```sh
npm run dist:win:msi
npm run dist:mac:arm64
npm run dist:mac:x64
```

Configure your own publisher identity for public distribution. For a local Mac development package, the command used here is electron-builder --mac dmg --arm64 (or --x64) --publish never --config.mac.identity=- --config.mac.hardenedRuntime=false. This changes this development app's signing configuration; it does not change system security settings.
