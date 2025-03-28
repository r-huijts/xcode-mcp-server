# Xcode MCP Server

<img src="xcode_icon.svg" width="100" height="100" alt="Xcode MCP Server Icon">

A Model Context Protocol (MCP) server that provides Xcode integration capabilities for Large Language Models (LLMs). This server enables AI assistants to interact with Xcode projects, manage iOS simulators, and perform various Xcode-related tasks.

## Use Cases

Here are examples of natural language instructions you can give to AI assistants using this server:

### Project Setup and Analysis
- "Set my projects directory to ~/Projects/iOS"
- "What are all the build configurations and schemes in my current project?"
- "Show me all Swift files in the project that might have memory leaks"
- "List all the targets in my project and their dependencies"
- "Check if there are any unused assets in my asset catalog"

### Build and Test Management
- "Build my project using the Debug configuration and MyApp scheme"
- "Run all unit tests in the Authentication module"
- "Execute the UI test plan for the checkout flow"
- "Build the project for release and show me any warnings"
- "Run the static analyzer on the NetworkManager class"

### Simulator and Device Testing
- "Show me all available iOS 17 simulators"
- "Boot up an iPhone 15 Pro simulator for testing"
- "Capture a 30-second performance trace while running my app"
- "Shut down all running simulators"
- "Launch my app in the simulator and start the debugger"

### File Operations and Code Management
- "Show me the contents of AppDelegate.swift"
- "Update the app's Info.plist with new privacy descriptions"
- "Create a new Swift file for a UserProfile model"
- "Find all files containing API endpoint definitions"
- "Update the build number in all target plists"

### Development Workflow
- "Update all Swift package dependencies to their latest versions"
- "Compile the asset catalog and optimize all images"
- "Start a debugging session for the current build"
- "Show me the build settings for the Release configuration"
- "Generate a performance report for the last test run"

### Common Troubleshooting
- "Why did my last build fail? Show me the error logs"
- "Check if all required certificates are properly configured"
- "Verify that all required simulator runtimes are installed"
- "Show me any conflicts in the project.pbxproj file"
- "List any missing file references in the project"


## Installation


### 1. From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/r-huijts/xcode-mcp-server.git
   cd xcode-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `PROJECTS_BASE_DIR` to your Xcode projects directory.

4. Build the project:
   ```bash
   npm run build
   ```

Then update your Claude configuration:

```json
{
  "mcpServers": {
    "xcode": {
      "command": "node",
      "args": [
        "/absolute/path/to/xcode-mcp-server/dist/index.js"
      ],
      "env": {
        "PROJECTS_BASE_DIR": "/path/to/your/xcode/projects"
      }
    }
  }
}
```

> **Note**: Replace `/path/to/your/xcode/projects` with the actual path to your Xcode projects directory.

After updating the configuration, restart Claude Desktop for the changes to take effect.

## Available Tools

### Project Management
- `set_projects_base_dir` - Set the base directory for Xcode projects
- `set_project_path` - Set the active Xcode project
- `get_active_project` - Get information about the current project

### File Operations
- `read_file` - Read contents of project files
- `write_file` - Write or update project files
- `list_project_files` - List all files in the project

### Build and Analysis
- `analyze_file` - Run static analysis on source files
- `build_project` - Build the project with specified configuration
- `run_tests` - Execute project tests

### Xcode Tools
- `run_xcrun` - Execute Xcode command-line tools
- `compile_asset_catalog` - Compile asset catalogs
- `swift_package_update` - Update Swift package dependencies

### Simulator Management
- `list_simulators` - Get available iOS simulators
- `boot_simulator` - Start a simulator by UDID
- `shutdown_simulator` - Stop a running simulator

### Debugging and Profiling
- `run_lldb` - Launch the LLDB debugger
- `trace_app` - Capture app performance traces

## Environment Variables

- `PROJECTS_BASE_DIR` - Set the default directory for Xcode projects

## Development

### Prerequisites
- Node.js 16 or later
- Xcode and Xcode Command Line Tools
- macOS (required for Xcode integration)

### Building
```bash
npm run build
```

### Testing with Inspector
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Error Handling

The server handles various error cases gracefully:
- No active Xcode project (server runs in limited mode)
- Invalid project paths
- File access permissions
- Build and test failures

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with the Model Context Protocol SDK
- Integrates with Xcode and iOS development tools
- Inspired by the need for AI-assisted iOS development
