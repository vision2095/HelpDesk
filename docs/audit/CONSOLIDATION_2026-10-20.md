# Shared workspace consolidation — 20 October 2026

The physical source remains `/Users/vivek/new repo/lensdesk-reviewed-1.3.6`, preserving the existing active project's path. `/Users/vivek/new repo/lensdesk` now aliases that same directory. Both source-file realpaths and Git repository roots were checked and are identical.

Physical node_modules and the original Git metadata were moved into the active project. The repository had no commits before consolidation; its metadata and untracked source remain available. The active .data directory was retained without replacement.

The prior lensdesk tree's 197 nongenerated files, including its .data, Git metadata and unique native overlay/keyboard implementations, were saved into `../../../archives/lensdesk-legacy-before-consolidation-2026-10-20.tar.gz` relative to this audit directory. Every archived file was SHA-256 verified against its source and rechecked before the redundant tree was removed. The manifest is beside the archive. This is a private recovery archive, not a runnable second project. Unique legacy implementations were preserved, not automatically merged or enabled.

Generated old release/dist directories were not archived; obsolete 1.3.5 installers were removed with the redundant tree. Dependencies were moved rather than deleted. The superseded reviewed-source ZIP was moved into archives. REA and research tool folders were retained; the configured REA executable path remains valid.

README, AGENTS.md and GEMINI.md document the single source and editor coordination rules at the workspace and project level. A shared directory prevents divergent project copies, but editors still need to coordinate simultaneous edits to the same files.

Validation:

- 146/146 regression tests passed when invoked through the lensdesk alias.
- Production TypeScript/Vite build passed from the physical project directory; existing bundle-size advisory remains.
- Electron reference workflow passed through the alias with a temporary isolated profile, including IPC, screenshot fixtures, crop, cancellation, display routing and preferences persistence.
- Windows archive CRC, single-file layout, PE x64, metadata, complete embedded runtime and ASAR identity passed. All 31 packaged runtime/frontend files match the current source.
- These checks do not execute the Windows binary on Windows and do not prove native Windows acceptance.

Evidence is in evidence-consolidation-2026-10-20/.
