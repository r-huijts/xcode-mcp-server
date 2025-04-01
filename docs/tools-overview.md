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

## Project Management Tools

| Tool | Description |
|------|-------------|
| `set_projects_base_dir` | Sets the base directory where Xcode projects are stored |
| `set_project_path` | Sets the active Xcode project |
| `get_active_project` | Retrieves detailed information about the active project |

These tools help you navigate and manage Xcode projects. The server attempts to detect the active project automatically when it starts, but you can explicitly set a project using these tools.

## File Operation Tools

| Tool | Description |
|------|-------------|
| `read_file` | Reads the contents of a file in the active project |
| `write_file` | Writes or updates file content in the active project |
| `list_project_files` | Lists all files within an Xcode project |
| `list_directory` | Lists the contents of a directory, showing both files and subdirectories |

File operation tools allow you to interact with files in your Xcode project. For safety reasons, file paths are restricted to the project directory.

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
| `check_cocoapods` | Checks if the active project uses CocoaPods and returns setup information |

CocoaPods tools allow you to manage CocoaPods dependencies in your iOS projects. These tools require CocoaPods to be installed on your system.

## Swift Package Manager Tools

| Tool | Description |
|------|-------------|
| `init_swift_package` | Initializes a new Swift Package Manager project |
| `add_swift_package` | Adds a Swift Package dependency to the active project |
| `update_swift_package` | Updates the dependencies of your Swift project |
| `swift_package_command` | Executes arbitrary Swift Package Manager commands |

Swift Package Manager tools help you manage Swift packages and dependencies. They interact with the Swift Package Manager CLI.

## Simulator Tools

| Tool | Description |
|------|-------------|
| `list_simulators` | Lists all available iOS simulators |
| `boot_simulator` | Boots an iOS simulator identified by its UDID |
| `shutdown_simulator` | Shuts down an active iOS simulator |

Simulator tools allow you to interact with iOS simulators. They use the `simctl` command-line tool that is part of Xcode.

## Xcode Utilities

| Tool | Description |
|------|-------------|
| `run_xcrun` | Executes a specified Xcode tool via 'xcrun' |
| `compile_asset_catalog` | Compiles an asset catalog using 'actool' |
| `run_lldb` | Launches the LLDB debugger with custom arguments |
| `trace_app` | Captures a performance trace of an application using 'xctrace' |

These utilities provide access to various Xcode command-line tools and debugging functionality.

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

For workspace projects, the server attempts to find the main project inside the workspace.

### File Operations

File operations are restricted to the active project directory for safety reasons. The server validates paths before performing file operations.

### Build System Integration

Build tools interact with `xcodebuild` or Swift Package Manager's `swift build` depending on the project type:

- For regular Xcode projects, it uses `xcodebuild -project`.
- For workspace projects, it uses `xcodebuild -workspace`.
- For SPM projects, it uses `swift build`.

### Package Manager Integration

The server integrates with both CocoaPods and Swift Package Manager:

- CocoaPods tools manage dependencies in a Podfile.
- Swift Package Manager tools interact with Package.swift.

## Using the Tools

Each tool takes specific parameters and returns text-based results. All tools validate their inputs and provide clear error messages if something goes wrong.

To use the tools effectively:

1. First set the active project if not automatically detected.
2. Use the appropriate tools based on your project type (regular, workspace, or SPM).
3. Check the tool descriptions for required parameters.

For workspace and CocoaPods projects, the server will automatically detect the project structure and provide appropriate support.

## Troubleshooting

If you encounter issues:

- Check if the active project is correctly set.
- For build or test issues, ensure the configuration and scheme are valid.
- For CocoaPods or SPM issues, verify the package manager is properly set up. 