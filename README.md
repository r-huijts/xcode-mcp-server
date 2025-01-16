# Xcode MCP Server

A Model Context Protocol (MCP) server for interacting with Xcode projects. This server provides a bridge between Claude and Xcode projects, allowing Claude to read, write, and manage Xcode project files.

## Features

- **Project Detection**: Automatically detects active Xcode projects or allows manual project selection
- **File Operations**:
  - Read files from Xcode projects
  - Write/update project files
  - List project files with optional file type filtering
- **Project Information**:
  - Get project targets, configurations, and schemes
  - Analyze source files
  - Build projects with specified configurations
  - Run tests with optional test plans

## Setup

1. **Prerequisites**:
   - Node.js (v14 or later)
   - Xcode Command Line Tools
   - TypeScript

2. **Installation**:
   ```bash
   # Clone the repository
   git clone [repository-url]
   cd xcode-server

   # Install dependencies
   npm install

   # Build the project
   npm run build
   ```

3. **Configuration**:
   Add the server configuration to your Claude Desktop config file (typically located at `~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "xcode-server": {
         "command": "node",
         "args": [
           "/path/to/xcode-server/build/index.js"
         ],
         "env": {
           "PROJECTS_BASE_DIR": "/path/to/your/xcode/projects"
         }
       }
     }
   }
   ```

   Replace `/path/to/xcode-server` with the actual path to your installation, and `/path/to/your/xcode/projects` with the directory where you keep your Xcode projects.

## Usage

The server provides several tools that Claude can use to interact with Xcode projects:

### Project Management
- `set_projects_base_dir`: Set the base directory where Xcode projects are stored
- `set_project_path`: Explicitly set the active Xcode project
- `get_active_project`: Get information about the currently active project

### File Operations
- `read_file`: Read contents of a file in the Xcode project
- `write_file`: Write or update contents of a file in the project
- `list_project_files`: List all files in the project with optional file type filtering

### Project Operations
- `analyze_file`: Analyze source files for issues
- `build_project`: Build the project with specified configuration and scheme
- `run_tests`: Run project tests with optional test plan

### Example Interactions

Here are some example requests you can make to Claude when using this server:

#### Project Management
- "Please set my Xcode projects directory to `/Users/username/Documents/XcodeProjects`"
- "What's my current active Xcode project?"
- "Switch to the MyApp.xcodeproj project"
- "List all Swift files in my current project"

#### File Operations
- "Show me the contents of App.swift"
- "Create a new view called ProfileView"
- "Update the UserModel.swift file to add a new @Published property called 'email'"
- "Find all files that contain API calls"
- "Show me all Swift files that use the ViewModifier protocol"

#### Project Analysis and Building
- "Analyze the NetworkManager.swift file for potential issues"
- "Build my project using the Debug configuration"
- "Run the unit tests for the UserModel module"
- "What are the available build schemes in my project?"
- "Show me the build configurations available"

#### Common Tasks
- "Add a new custom SwiftUI view modifier"
- "Create an async/await networking layer using URLSession"
- "Implement Core Data model classes with SwiftUI @FetchRequest support"
- "Add preview provider for my ProfileView"
- "Set up environment objects for dependency injection"

These are just examples - you can phrase your requests naturally, and Claude will understand how to use the server's capabilities to help you.

## Development

1. **Building**:
   ```bash
   npm run build
   ```

2. **Testing**:
   ```bash
   npm test
   ```

3. **Debugging**:
   The server logs errors and warnings to stderr, which can be helpful for troubleshooting.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Add your chosen license here]
