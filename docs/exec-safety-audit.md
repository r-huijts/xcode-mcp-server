# execAsync Injection Review

This document summarizes each usage of `execAsync` within `src/tools` and whether
user supplied input is passed to the shell. When a potential injection vector is
found, a mitigation strategy is noted.

| File & Line | Parameters | Status |
|-------------|-----------|--------|
| `project/index.ts` lines around 337 | `cleanedPath` from user path | Switched to `execFile` to avoid shell injection |
| `simulator/index.ts` boot/install/etc | `udid`, `bundleId`, `url` parameters | Potential injection; consider validating against `[0-9A-F-]+` and using `execFile` |
| `file/index.ts` copy/info operations | validated file paths | Quoting with `"` may allow injection if path contains quotes. Use `execFile` or sanitize path. |
| `build/index.ts` build/clean/archive commands | `scheme`, `configuration`, paths | Strings passed directly to shell; sanitize or use `execFile`. |
| `spm/index.ts` package commands | package names, options | Strings interpolated; validate or use `execFile`. |
| `cocoapods/index.ts` | boolean flags only | Low risk. |
| `xcode/index.ts` various commands | parameters like `command`, `developerDir` | Validate or use `execFile`. |

