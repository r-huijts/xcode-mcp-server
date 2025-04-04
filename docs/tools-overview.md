# Xcode MCP Server Tools Overview

This document provides a comprehensive overview of the tools available in the Xcode MCP Server and explains how they interact with Xcode projects.

## Server Architecture

The Xcode MCP Server is organized into the following modules:

- **Project Management**: Tools for working with Xcode projects
- **File Operations**: Tools for reading and writing files
- **Build & Testing**: Tools for building and testing projects
- **CocoaPods Integration**: Tools for managing CocoaPods dependencies
- **Swift Package Manager**: Tools for managing Swift Package Manager functionality
- **Simulator Tools**: Tools for interacting with iOS simulators
- **Xcode Utilities**: Miscellaneous Xcode-specific tools
- **Path Management**: System for secure file access and directory navigation

## Project Management Tools

| Tool | Description |
|------|-------------|
| `set_projects_base_dir` | Sets the base directory where Xcode projects are stored |
| `set_project_path` | Sets the active Xcode project (xcodeproj, xcworkspace, or SPM) |
| `get_active_project` | Retrieves detailed information about the active project |
| `find_projects` | Finds Xcode projects in the specified directory |
| `get_project_configuration` | Retrieves configuration details for the active project |
| `detect_active_project` | Attempts to automatically detect the active Xcode project |
| `change_directory` | Changes the active directory for relative path operations |
| `push_directory` | Pushes current directory to stack and changes to a new directory |
| `pop_directory` | Returns to previous directory from stack |
| `get_current_directory` | Shows the current active directory |

These tools help you navigate and manage Xcode projects. The server supports multiple project types including regular .xcodeproj files, workspaces (.xcworkspace), and Swift Package Manager projects (Package.swift).

## File Operation Tools

| Tool | Description |
|------|-------------|
| `read_file` | Reads the contents of a file within allowed directories |
| `write_file` | Writes or updates file content within allowed directories |
| `copy_file` | Copies a file or directory to a new location |
| `move_file` | Moves a file or directory to a new location |
| `delete_file` | Deletes a file or directory |
| `create_directory` | Creates a new directory |
| `list_project_files` | Lists all files within an Xcode project |
| `list_directory` | Lists directory contents with options for format and hidden files |
| `get_file_info` | Gets detailed information about a file or directory |
| `find_files` | Searches for files matching a pattern in a directory |
| `resolve_path` | Shows how a path would be resolved |
| `check_file_exists` | Checks if a file or directory exists |

File operation tools allow you to interact with files securely. All operations use the path management system for validation and security.

## Build & Testing Tools

| Tool | Description |
|------|-------------|
| `analyze_file` | Analyzes a source file for potential issues using Xcode's static analyzer |
| `build_project` | Builds the active Xcode project with specified configuration and scheme |
| `run_tests` | Executes tests for the active Xcode project, optionally with a test plan |

Build and testing tools interact with Xcode's build system to compile your projects and run tests. They use `xcodebuild` in the background.

## CocoaPods Integration

| Tool | Description |
|------|-------------|
| `pod_install` | Runs 'pod install' in the active project directory |
| `pod_update` | Runs 'pod update' in the active project directory |
| `pod_outdated` | Checks for outdated dependencies in the project |
| `pod_repo_update` | Updates the local CocoaPods spec repositories |
| `pod_deintegrate` | Removes CocoaPods from the project |
| `pod_init` | Initializes a new Podfile in the project |
| `check_cocoapods` | Checks if the active project uses CocoaPods and returns setup information |

CocoaPods tools allow you to manage CocoaPods dependencies in your iOS projects. These tools require CocoaPods to be installed on your system.

## Swift Package Manager Tools

| Tool | Description |
|------|-------------|
| `init_swift_package` | Initializes a new Swift Package Manager project with options for type and testing |
| `add_swift_package` | Adds a Swift Package dependency to the active project |
| `update_swift_package` | Updates dependencies with options for specific packages and versions |
| `swift_package_command` | Executes arbitrary Swift Package Manager commands |
| `build_swift_package` | Builds a Swift Package with configuration options |
| `test_swift_package` | Tests a Swift Package with filtering and parallel options |
| `show_swift_dependencies` | Displays dependency graphs in various formats |
| `clean_swift_package` | Cleans build artifacts with options for global cache |
| `dump_swift_package` | Dumps the Package.swift manifest as JSON |

Swift Package Manager tools provide comprehensive support for Swift packages and dependencies. They interact with the Swift Package Manager CLI and provide enhanced error reporting.

## Simulator Tools

| Tool | Description |
|------|-------------|
| `list_simulators` | Lists all available iOS simulators |
| `boot_simulator` | Boots an iOS simulator identified by its UDID |
| `shutdown_simulator` | Shuts down an active iOS simulator |
| `install_app` | Installs an app on a simulator |
| `uninstall_app` | Removes an app from a simulator |
| `launch_app` | Launches an app on a simulator |
| `terminate_app` | Terminates a running app on a simulator |
| `take_screenshot` | Captures a screenshot of a simulator |
| `record_video` | Records video of simulator activity |

Simulator tools allow you to interact with iOS simulators. They use the `simctl` command-line tool that is part of Xcode.

## Xcode Utilities

| Tool | Description |
|------|-------------|
| `run_xcrun` | Executes a specified Xcode tool via 'xcrun' |
| `compile_asset_catalog` | Compiles an asset catalog using 'actool' |
| `run_lldb` | Launches the LLDB debugger with custom arguments |
| `trace_app` | Captures a performance trace of an application using 'xctrace' |
| `get_xcode_info` | Retrieves information about the installed Xcode |
| `generate_app_icons` | Generates an app icon set from a source image |

These utilities provide access to various Xcode command-line tools and debugging functionality.

## Path Management

The server includes a comprehensive path management system that provides:

1. **Security**: File operations are restricted to allowed directories
2. **Validation**: Paths are validated for reading and writing
3. **Resolution**: Relative paths are resolved against active directory
4. **Navigation**: Directory stack for easy navigation
5. **Boundaries**: Project boundaries are enforced for security

Path management tools include:

| Tool | Description |
|------|-------------|
| `change_directory` | Changes the active directory |
| `push_directory` | Remembers current directory and changes to a new one |
| `pop_directory` | Returns to previously remembered directory |
| `get_current_directory` | Shows current active directory |
| `resolve_path` | Shows how a path would be resolved |

## How the Tools Interact with Xcode Projects

### Project Detection

The server attempts to detect the active Xcode project using the following methods:

1. **AppleScript**: Attempts to get the frontmost Xcode project via AppleScript.
2. **Base Directory Scan**: If a base directory is set, scans for projects there.
3. **Recent Projects**: Reads recent projects from Xcode defaults.

### Project Types Support

The server supports different project types:

- **Regular `.xcodeproj` projects**: Standard Xcode projects.
- **Workspace projects (`.xcworkspace`)**: For CocoaPods or multi-project setups.
- **Swift Package Manager projects**: Identified by `Package.swift` files.

For workspace projects, the server extracts contained projects and identifies the main project inside the workspace.

### File Operations

All file operations use the path management system:

1. Paths are resolved against the active directory
2. Paths are validated for security boundaries
3. Operations are only performed on allowed paths
4. Detailed error messages are provided for failures

### Build System Integration

Build tools interact with `xcodebuild` or Swift Package Manager's `swift build` depending on the project type:

- For regular Xcode projects, it uses `xcodebuild -project`.
- For workspace projects, it uses `xcodebuild -workspace`.
- For SPM projects, it uses `swift build`.

### Package Manager Integration

The server integrates with both CocoaPods and Swift Package Manager:

- CocoaPods tools manage dependencies in a Podfile, with support for repo management and outdated dependencies.
- Swift Package Manager tools provide comprehensive support for Swift packages, including dependency analysis and visualization.

## Using the Tools

Each tool takes specific parameters and returns text-based results. All tools validate their inputs and provide clear error messages if something goes wrong.

To use the tools effectively:

1. First set the active project if not automatically detected using `set_project_path`.
2. Navigate to relevant directories using `change_directory`, `push_directory`, and `pop_directory`.
3. Use the appropriate tools based on your project type (regular, workspace, or SPM).
4. Check the tool descriptions for required parameters.

For workspace and CocoaPods projects, the server will automatically detect the project structure and provide appropriate support.

## Troubleshooting

If you encounter issues:

- Check if the active project is correctly set with `get_active_project`.
- Verify current directory with `get_current_directory`.
- For path issues, use `resolve_path` to debug path resolution.
- For build or test issues, ensure the configuration and scheme are valid.
- For CocoaPods or SPM issues, verify the package manager is properly set up. 