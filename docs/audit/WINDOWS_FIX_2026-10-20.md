# Windows request-denied repair — 20 October 2026

Reported error: `Error invoking remote method 'lens:request': Error: Request denied.`

The error is thrown by the main-process IPC sender guard, before the requested action reaches the workspace service. The previous guard compared raw file URL strings and frame object references. Windows paths with equivalent casing or URL encoding could fail that comparison. The user's actual sender URL/frame was not available, so the exact failing comparison on their computer is not proven.

The new request policy compares decoded local file paths using Windows path rules and checks the sender's webContents, frame process ID and routing ID. It continues to reject other windows, subframes, remote pages, different local files and malformed URLs. macOS paths remain case sensitive. Main-process startup promise failures now show an error dialog and write startup-error.log in the existing user-data directory.

A separate confirmed release defect was found: the old Windows ZIP had stale desktop/main.cjs, desktop/capture.cjs, several server files and frontend assets despite having the same 1.3.6 version. The production release script reused an existing ZIP instead of rebuilding it. It now always rebuilds and verifies Windows. The archive checker now compares every desktop, server and frontend file against current source. It correctly rejected the previous ZIP.

The latest capture source also had an opacity variable scoped inside try but read in finally; its ReferenceError was swallowed, leaving the application transparent after capture. That variable now spans both blocks. Windows success/failure regressions verify that the original opacity and visibility return.

Validation: 146 Node tests passed, including Windows URL/frame authorization and capture opacity regressions. The actual Electron reference workflow passed with an isolated temporary workspace, exercising IPC, settings persistence, capture, region crop, cancellation and display routing. Screenshot inputs were synthetic. Windows binary execution is unavailable on this Mac; these checks do not establish native Windows acceptance or reproduce the user's exact runtime state.

Version stays 1.3.6. The rebuilt Windows ZIP replaces the stale release; existing macOS artifacts are not rebuilt by this repair. Use the explicitly named Windows fixed ZIP when transferring this repair. The root reviewed-source ZIP predates this repair; current maintained source is this project directory.

Final archive checks passed: ZIP CRC, single-file contents, x64 PE, LensDesk metadata, complete embedded runtime and ASAR identity. All 31 packaged runtime/frontend files match the maintained source byte for byte.

Deliverable: `../LensDesk-1.3.6-Windows-x64-fixed.zip` (identical to `release/LensDesk-1.3.6-Windows-x64.zip`). Size: 103,519,767 bytes. SHA-256: `444aa88463b62496de0ff893254b1829f1376b1cc7f8cc05dfe3c9e2f2905eb4`.

Close the previous LensDesk instance, extract the fixed ZIP into a fresh folder and launch LensDesk.exe. The existing user-data directory is retained. If the same request-denied error persists, native Windows diagnostics are needed to identify the failing sender condition on that machine.
