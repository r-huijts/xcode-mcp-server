# execAsync Injection Review (CWE-78 Remediation)

## Policy

**All subprocess invocations must use `runExecFile` (from `src/utils/execFile.js`) with an argument array.** Do not use `child_process.exec()` or interpolate user-controlled or path-derived strings into a shell command string. This prevents CWE-78 OS Command Injection.

- **Safe:** `runExecFile("xcrun", ["lldb", "-o", userCommand, "-b"])` — arguments are passed literally to the process; no shell is invoked.
- **Unsafe:** `exec(\`xcrun lldb ${userArgs}\`)` — a shell parses `userArgs`, so e.g. `& ping -c 2 evil.com &` runs arbitrary commands.

Use `options.cwd` for working directory instead of `cd "${dir}" && ...`.

## Remediation Status (2026)

All previously identified injection vectors have been addressed:

| Module | Change |
|--------|--------|
| **xcode/index.ts** | `run_xcrun`, `run_lldb`, `validate_app`, `compile_asset_catalog`, `trace_app`, `switch_xcode`, `export_archive`, `generate_icon_set`, and internal helpers now use `runExecFile` with argument arrays. Credentials and user args are never passed through a shell. |
| **build/index.ts** | All `xcodebuild` and `swift build` invocations use `runExecFile("xcodebuild", args, { cwd })` or `runExecFile("swift", args, { cwd })` with args built as arrays. |
| **simulator/index.ts** | All `xcrun simctl` calls use `runExecFile("xcrun", ["simctl", subcommand, ...args])`. UDID format is validated with a strict regex before use. |
| **file/index.ts** | `cp`, `ls`, `wc`, `file`, `find`, `pgrep` use `runExecFile` with argument arrays; no shell interpolation. |
| **spm/index.ts** | All `swift` package/build/test and `which`/`open` calls use `runExecFile` with argument arrays. |
| **cocoapods/index.ts** | All `pod` and helper commands (`which`, `ruby`, `gem`) use `runExecFile` with argument arrays. |
| **project/index.ts** | `xcodebuild -list`, `find`, `osascript`, and `xcrun swift package` invocations use `runExecFile` or existing `execFile` with arrays. |
| **server.ts** | Project detection uses `runExecFile("osascript", ["-e", script])` and `runExecFile("defaults", ["read", ...])`. |
| **utils/project.ts** | `getProjectInfo` / `getWorkspaceInfo` use `runExecFile("xcodebuild", args)`. `find` uses `runExecFile`. |

## Adding New Tools

When adding or modifying code that runs external commands:

1. Use `runExecFile(binary, argsArray, options?)` from `src/utils/execFile.js`.
2. Build `argsArray` by appending literal strings (e.g. `args.push("-scheme", scheme)`). Never concatenate user input into a single string that is then passed to a shell.
3. For working directory, pass `{ cwd: resolvedPath }` in options.
4. Do not use `child_process.exec` or construct shell command strings with user or path-derived input.
