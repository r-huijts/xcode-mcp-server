# Xcode MCP Server

An MCP (Model Context Protocol) server providing comprehensive Xcode integration for AI assistants. This server enables AI agents to interact with Xcode projects, manage iOS simulators, and perform various Xcode-related tasks with enhanced error handling and support for multiple project types.

## Features

### Project Management
- Set active projects and get detailed project information
- Create new Xcode projects from templates (iOS, macOS, watchOS, tvOS)
- Add files to Xcode projects with target and group specification
- Parse workspace documents to find associated projects
- List available schemes in projects and workspaces

### File Operations
- Read/write files with support for different encodings
- Handle binary files with base64 encoding/decoding
- Search for text content within files using patterns and regex
- Check file existence and get file metadata
- Create directory structures automatically

### Build & Testing
- Build projects with customizable options
- Run tests with detailed failure reporting
- Analyze code for potential issues
- Clean build directories
- Archive projects for distribution

### CocoaPods Integration
- Initialize CocoaPods in projects
- Install and update pods
- Add and remove pod dependencies
- Execute arbitrary pod commands

### Swift Package Manager
- Initialize new Swift packages
- Add and remove package dependencies with various version requirements
- Update packages and resolve dependencies
- Generate documentation for Swift packages using DocC
- Run tests and build Swift packages

### iOS Simulator Tools
- List available simulators with detailed information
- Boot and shut down simulators
- Install and launch apps on simulators
- Take screenshots and record videos
- Manage simulator settings and state

### Xcode Utilities
- Execute Xcode commands via xcrun
- Compile asset catalogs
- Generate app icon sets from source images
- Trace app performance
- Export and validate archives for App Store submission
- Switch between different Xcode versions

## Installation

### Prerequisites

- macOS with Xcode 14.0 or higher installed
- Node.js 16 or higher
- npm or yarn
- Swift 5.5+ for Swift Package Manager features
- CocoaPods (optional, for CocoaPods integration)

### Setup

#### Option 1: Automated Setup (Recommended)

Use the included setup script which automates the installation and configuration process:

```bash
# Make the script executable
chmod +x setup.sh

# Run the setup script
./setup.sh
```

**What the Setup Script Does:**

1. **Environment Verification**:
   - Checks that you're running on macOS
   - Verifies Xcode is installed and accessible
   - Confirms Node.js (v16+) and npm are available
   - Checks for Ruby installation
   - Verifies CocoaPods installation (offers to install if missing)

2. **Dependency Installation**:
   - Runs `npm install` to install all required Node.js packages
   - Executes `npm run build` to compile the TypeScript code

3. **Configuration Setup**:
   - Creates a `.env` file if one doesn't exist
   - Prompts for your projects base directory
   - Asks if you want to enable debug logging
   - Saves your configuration preferences

4. **Claude Desktop Integration** (Optional):
   - Offers to configure the server for Claude Desktop
   - Creates or updates the Claude Desktop configuration file
   - Sets up the proper command and arguments to launch the server

**When to Use the Setup Script:**

- First-time installation to ensure all prerequisites are met
- When you want guided configuration with interactive prompts
- If you want to quickly set up Claude Desktop integration
- To verify your environment has all necessary components

The script will guide you through the configuration process with clear prompts and helpful feedback.

#### Option 2: Manual Setup

**When to Use Manual Setup:**

- You prefer explicit control over each installation step
- You have a custom environment or non-standard configuration
- You're setting up in a CI/CD pipeline or automated environment
- You want to customize specific aspects of the installation process
- You're an experienced developer familiar with Node.js projects

Follow these steps for manual installation:

1. Clone the repository:
   ```bash
   git clone https://github.com/r-huijts/xcode-mcp-server.git
   cd xcode-mcp-server
   ```

2. Verify prerequisites (these must be installed):
   - Xcode and Xcode Command Line Tools
   - Node.js v16 or higher
   - npm
   - Ruby (for CocoaPods support)
   - CocoaPods (optional, for pod-related features)

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Create a configuration file:
   ```bash
   # Option A: Start with the example configuration
   cp .env.example .env

   # Option B: Create a minimal configuration
   echo "PROJECTS_BASE_DIR=/path/to/your/projects" > .env
   echo "DEBUG=false" >> .env
   ```

   Edit the `.env` file to set your preferred configuration.

6. For Claude Desktop integration (optional):
   - Edit or create `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Add the following configuration (adjust paths as needed):
   ```json
   {
     "mcpServers": {
       "xcode": {
         "command": "node",
         "args": ["/path/to/xcode-mcp-server/dist/index.js"]
       }
     }
   }
   ```

### Setup Troubleshooting

**Common Setup Issues:**

1. **Build Errors**:
   - Ensure you have the correct Node.js version (v16+)
   - Try deleting `node_modules` and running `npm install` again
   - Check for TypeScript errors with `npx tsc --noEmit`
   - Make sure all imports in the code are properly resolved

2. **Missing Dependencies**:
   - If you see errors about missing modules, run `npm install` again
   - For native dependencies, you may need Xcode Command Line Tools: `xcode-select --install`

3. **Permission Issues**:
   - Ensure you have write permissions to the installation directory
   - For CocoaPods installation, you may need to use `sudo gem install cocoapods`

4. **Configuration Problems**:
   - Verify your `.env` file has the correct format and valid paths
   - Make sure `PROJECTS_BASE_DIR` points to an existing directory
   - Check that the path doesn't contain special characters that need escaping

5. **Claude Desktop Integration**:
   - Ensure the path in the Claude configuration points to the correct location of `index.js`
   - Restart Claude Desktop after making configuration changes
   - Check that the server is running before attempting to use it with Claude

## Usage

### Starting the Server

```bash
npm start
```

For development mode with automatic restarts:
```bash
npm run dev
```

### Configuration Options

You can configure the server in two ways:

1. Environment variables in `.env` file:
   ```
   PROJECTS_BASE_DIR=/path/to/your/projects
   DEBUG=true
   ALLOWED_PATHS=/path/to/additional/allowed/directory
   PORT=8080
   ```

2. Command line arguments:
   ```bash
   npm start -- --projects-dir=/path/to/your/projects --port=8080
   ```

### Key Configuration Parameters

- `PROJECTS_BASE_DIR` / `--projects-dir`: Base directory for projects (required)
- `ALLOWED_PATHS` / `--allowed-paths`: Additional directories to allow access to (comma-separated)
- `PORT` / `--port`: Port to run the server on (default: 3000)
- `DEBUG` / `--debug`: Enable debug logging (default: false)
- `LOG_LEVEL` / `--log-level`: Set logging level (default: info)

### Connecting to AI Assistants

The server implements the Model Context Protocol (MCP), making it compatible with various AI assistants that support this protocol. To connect:

1. Start the Xcode MCP server
2. Configure your AI assistant to use the server URL (typically `http://localhost:3000`)
3. The AI assistant will now have access to all the Xcode tools provided by the server

### Tool Documentation

For a comprehensive overview of all available tools and their usage, see [Tools Overview](docs/tools-overview.md).

For detailed usage examples and best practices, see [User Guide](docs/user-guide.md).

### Common Workflows

#### Setting Up a New Project

```javascript
// Create a new iOS app project
await tools.create_xcode_project({
  name: "MyAwesomeApp",
  template: "ios-app",
  outputDirectory: "~/Projects",
  organizationName: "My Organization",
  organizationIdentifier: "com.myorganization",
  language: "swift",
  includeTests: true,
  setAsActive: true
});

// Add a Swift Package dependency
await tools.add_swift_package({
  url: "https://github.com/Alamofire/Alamofire.git",
  version: "from: 5.0.0"
});
```

#### Working with Files

```javascript
// Read a file with specific encoding
const fileContent = await tools.read_file({
  filePath: "MyAwesomeApp/AppDelegate.swift",
  encoding: "utf-8"
});

// Write to a file
await tools.write_file({
  path: "MyAwesomeApp/NewFile.swift",
  content: "import Foundation\n\nclass NewClass {}\n",
  createIfMissing: true
});

// Search for text in files
const searchResults = await tools.search_in_files({
  directory: "MyAwesomeApp",
  pattern: "*.swift",
  searchText: "class",
  isRegex: false
});
```

#### Building and Testing

```javascript
// Build the project
await tools.build_project({
  scheme: "MyAwesomeApp",
  configuration: "Debug"
});

// Run tests
await tools.test_project({
  scheme: "MyAwesomeApp",
  testPlan: "MyAwesomeAppTests"
});
```

## Project Structure

```
xcode-mcp-server/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server implementation
│   ├── types/                   # Type definitions
│   │   └── index.ts             # Core type definitions
│   ├── utils/                   # Utility functions
│   │   ├── errors.js            # Error handling classes
│   │   ├── pathManager.ts       # Path validation and management
│   │   ├── project.js           # Project utilities
│   │   └── simulator.js         # Simulator utilities
│   └── tools/                   # Tool implementations
│       ├── project/             # Project management tools
│       │   └── index.ts         # Project creation, detection, file adding
│       ├── file/                # File operation tools
│       │   └── index.ts         # File reading, writing, searching
│       ├── build/               # Build and testing tools
│       │   └── index.ts         # Building, testing, analyzing
│       ├── cocoapods/           # CocoaPods integration
│       │   └── index.ts         # Pod installation and management
│       ├── spm/                 # Swift Package Manager tools
│       │   └── index.ts         # Package management and documentation
│       ├── simulator/           # iOS simulator tools
│       │   └── index.ts         # Simulator control and interaction
│       └── xcode/               # Xcode utilities
│           └── index.ts         # Xcode version management, asset tools
├── docs/                        # Documentation
│   ├── tools-overview.md        # Comprehensive tool documentation
│   └── user-guide.md            # Usage examples and best practices
├── tests/                       # Tests
└── dist/                        # Compiled code (generated)
```

## How It Works

The Xcode MCP server uses the Model Context Protocol to provide a standardized interface for AI models to interact with Xcode projects. The server architecture is designed with several key components:

### Core Components

1. **Server Implementation**: The main MCP server that handles tool registration and request processing.

2. **Path Management**: Ensures secure file access by validating all paths against allowed directories.

3. **Project Management**: Detects, loads, and manages different types of Xcode projects:
   - Standard Xcode projects (.xcodeproj)
   - Xcode workspaces (.xcworkspace)
   - Swift Package Manager projects (Package.swift)

4. **Directory State**: Maintains the active directory context for relative path resolution.

5. **Tool Registry**: Organizes tools into logical categories for different Xcode operations.

### Request Flow

1. An AI assistant sends a tool execution request to the MCP server.

2. The server validates the request parameters and permissions.

3. The appropriate tool handler is invoked with the validated parameters.

4. The tool executes the requested operation, often using native Xcode commands.

5. Results are formatted and returned to the AI assistant.

6. Comprehensive error handling provides meaningful feedback for troubleshooting.

### Safety Features

- **Path Validation**: All file operations are restricted to allowed directories.
- **Error Handling**: Detailed error messages help diagnose issues.
- **Parameter Validation**: Input parameters are validated using Zod schemas.
- **Process Management**: External processes are executed safely with proper error handling.

### Project Type Support

The server intelligently handles different project types:

- **Standard Projects**: Direct .xcodeproj manipulation
- **Workspaces**: Manages multiple projects within a workspace
- **SPM Projects**: Handles Swift Package Manager specific operations

This architecture allows AI assistants to seamlessly work with any type of Xcode project while maintaining security and providing detailed feedback.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style and organization
- Add comprehensive error handling with specific error messages
- Write tests for new functionality
- Update documentation to reflect your changes
- Ensure compatibility with different project types (standard, workspace, SPM)

### Adding New Tools

To add a new tool to the server:

1. Identify the appropriate category in the `src/tools/` directory
2. Implement the tool using the existing patterns with Zod schema validation
3. Register the tool in the category's `index.ts` file
4. Add error handling with specific error messages
5. Document the tool in the appropriate documentation files

## Troubleshooting

### Common Issues

- **Path Access Errors**: Ensure the paths you're trying to access are within the allowed directories
- **Build Failures**: Check that Xcode command line tools are installed and up to date
- **Tool Not Found**: Verify that the tool name is correct and properly registered
- **Parameter Validation Errors**: Check the parameter types and requirements in the tool documentation

### Debugging

1. Start the server with debug logging enabled: `npm start -- --debug`
2. Check the console output for detailed error messages
3. Examine the server logs for request and response details
4. For tool-specific issues, try running the equivalent Xcode command directly in the terminal

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Thanks to the Model Context Protocol team for the MCP SDK
- Built with TypeScript and Node.js
- Uses Xcode command line tools and Swift Package Manager
- Special thanks to all contributors who have helped improve the server's functionality and robustness
