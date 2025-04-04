# Path Management System

This document provides a detailed explanation of the path management system used in the MCP Server. It covers the architecture, components, workflows, and security considerations.

## Overview

The path management system provides a centralized, secure, and consistent way to handle file paths and directory navigation throughout the application. It was designed to address several key challenges:

1. **Security**: Prevent access to unauthorized parts of the filesystem
2. **Consistency**: Handle diverse path formats in a uniform manner
3. **Clarity**: Provide clear error messages and path resolution
4. **Navigation**: Support intuitive directory navigation with memory of previous locations
5. **Validation**: Ensure paths meet security and format requirements

## Components

The system consists of three main components:

### 1. PathManager

`PathManager` is the core class responsible for all path-related operations. It handles:

- Path normalization and expansion
- Security boundary enforcement
- Path validation for reading and writing
- Directory change tracking
- Path joining and relation checking

```typescript
// Example: Creating and using PathManager
const pathManager = new PathManager(config);
pathManager.setProjectsBaseDir('/path/to/projects');
pathManager.setActiveProject('/path/to/projects/MyProject.xcodeproj');

// Normalize and validate paths
const normalizedPath = pathManager.normalizePath('~/projects/file.txt');
const isAllowed = pathManager.isPathAllowed(normalizedPath);
```

### 2. SafeFileOperations

`SafeFileOperations` builds on `PathManager` to provide secure file operations with consistent error handling. It includes:

- Safe file reading with validation
- Secure file writing with directory creation
- Safe directory listing
- Consistent error handling

```typescript
// Example: Using SafeFileOperations
const fileOps = new SafeFileOperations(pathManager);

// Reading a file safely
const fileContent = await fileOps.readFile('config.json');

// Writing a file with proper validation
await fileOps.writeFile('settings.json', jsonContent, true);
```

### 3. ProjectDirectoryState

`ProjectDirectoryState` manages the active directory state and navigation. It provides:

- Active directory tracking
- Directory stack for navigation history
- Path resolution relative to active directory
- State restoration

```typescript
// Example: Directory navigation
const dirState = new ProjectDirectoryState(pathManager);

// Navigate to a directory
dirState.setActiveDirectory('/path/to/project/src');

// Push current directory to stack and navigate to new directory
dirState.pushDirectory('/path/to/project/src/components');

// Return to previous directory
dirState.popDirectory();
```

## Path Resolution Workflow

The path resolution workflow follows this sequence:

1. **Input**: Path is received from user or tool (may be relative, absolute, or contain variables)
2. **Expansion**: Environment variables and tilde are expanded (`~/docs` → `/home/user/docs`)
3. **Normalization**: Path is normalized to remove redundancies (`../src/./file.js` → `src/file.js`)
4. **Resolution**: If relative, path is resolved against active directory
5. **Validation**: Path is checked against security boundaries
6. **Operation**: If valid, the requested operation is performed

See the [Path Resolution Workflow Diagram](../assets/path-resolution-workflow.md) for a visual representation of this process.

## Security Boundaries

The system enforces strict security boundaries to prevent unauthorized file access:

1. **Project Base Directory**: All operations must occur within the configured projects directory
2. **Active Project Directory**: Operations are allowed within the active project's directory
3. **Server Directory**: Read operations (but not write) may be allowed within the server's directory

Attempts to access paths outside these boundaries will result in a `PathAccessError`.

## Directory Navigation

Directory navigation follows these rules:

1. The active directory starts at the active project's root
2. `change_directory` changes the active directory
3. `push_directory` remembers the current directory and changes to a new one
4. `pop_directory` returns to the previously remembered directory
5. If no active directory is set, operations default to the project root

```
Project Root
└── src/
    ├── components/  <- push_directory here
    │   └── button.ts
    └── utils/       <- pop_directory back to src, then change_directory here
        └── helpers.ts
```

## Error Handling

The system provides detailed error handling with specific error types:

- **PathAccessError**: Thrown when a path is outside permitted boundaries
- **FileOperationError**: Thrown when a file operation fails
- **ProjectNotFoundError**: Thrown when no active project is set

Each error includes the path and a detailed message explaining the issue.

## Path Tools

The system provides several tools for users:

| Tool | Description |
|------|-------------|
| `change_directory` | Changes the active directory |
| `push_directory` | Pushes current directory to stack and changes directory |
| `pop_directory` | Returns to previous directory from stack |
| `get_current_directory` | Shows the current active directory |
| `resolve_path` | Shows how a path would be resolved |

## Best Practices

When working with the path management system:

1. **Use Relative Paths**: Prefer relative paths when appropriate
2. **Check Boundaries**: Use `resolve_path` to check if operations will be allowed
3. **Stack Navigation**: Use `push_directory`/`pop_directory` for temporary directory changes
4. **Handle Errors**: Catch and handle path-related errors appropriately
5. **Validate Input**: Validate paths before attempting operations

## Configuration

The path management system can be configured through:

1. **Environment Variables**: Set `PROJECTS_BASE_DIR` in `.env`
2. **Runtime Config**: Set `config.projectsBaseDir` when initializing the server
3. **Tools**: Use `set_projects_base_dir` tool to change at runtime

## Examples

### Example 1: Reading a File Relative to Active Directory

```typescript
// If active directory is /path/to/project/src
const fileContent = await server.fileOperations.readFile('config.json');
// Resolves to /path/to/project/src/config.json
```

### Example 2: Directory Stack Navigation

```typescript
// Starting at /path/to/project
server.directoryState.pushDirectory('src/components');
// Now at /path/to/project/src/components

// Do some operations...

server.directoryState.popDirectory();
// Back to /path/to/project
```

### Example 3: Path Resolution

```typescript
const result = await server.server.runTool(
  "resolve_path", 
  { path: "../configs/settings.json" }
);
// Shows how "../configs/settings.json" resolves from current directory
```

## Conclusion

The path management system provides a secure, consistent, and intuitive way to handle file and directory operations. By centralizing path logic, it ensures that all tools operate within safe boundaries while providing a flexible and convenient user experience. 