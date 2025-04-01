# Xcode MCP Server

An MCP (Model Context Protocol) server providing Xcode integration for AI assistants. This server enables AI agents to interact with Xcode projects, manage iOS simulators, and perform various Xcode-related tasks.

## Features

- **Project Management**: Set active projects, get project information
- **File Operations**: Read/write files within Xcode projects
- **Build & Testing**: Build projects, run tests, analyze code
- **CocoaPods Integration**: Manage CocoaPods dependencies
- **Swift Package Manager**: Initialize and manage Swift packages
- **iOS Simulator Tools**: List, boot, and shut down iOS simulators
- **Xcode Utilities**: Execute Xcode commands, compile asset catalogs, trace apps

## Installation

### Prerequisites

- macOS with Xcode installed
- Node.js 16 or higher
- npm or yarn

### Setup

#### Option 1: Automated Setup (Recommended)

Use the included setup script which will check prerequisites, install dependencies, build the project, and help you configure the server:

```bash
# Make the script executable
chmod +x setup.sh

# Run the setup script
./setup.sh
```

The script will guide you through the configuration process and can even set up Claude Desktop integration if desired.

#### Option 2: Manual Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/xcode-mcp-server.git
   cd xcode-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Create a configuration file (optional):
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file to set your preferred configuration.

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
   ```

2. Command line arguments:
   ```bash
   npm start -- --projects-dir=/path/to/your/projects
   ```

### Tool Documentation

For a comprehensive overview of all available tools and their usage, see [Tools Overview](docs/tools-overview.md).

For detailed usage examples and best practices, see [User Guide](docs/user-guide.md).

## Testing

The project includes a comprehensive testing suite built with Jest. The tests focus on ensuring that tools work as expected by mocking external dependencies like Xcode commands.

### Running Tests

To run all tests:
```bash
npm test
```

To run tests in watch mode during development:
```bash
npm run test:watch
```

### Test Structure

- `tests/utils/`: Test utilities including mocks for child processes and other dependencies
- `tests/tools/`: Tests for all tool implementations, organized by category
  - `simulator/`: Tests for simulator tools
  - `xcode/`: Tests for Xcode tools

### Adding New Tests

When adding new tools, please include corresponding test cases that:
1. Mock any external dependencies (especially command-line tools)
2. Verify that the tool is registered correctly
3. Test the tool's functionality with various inputs
4. Test error handling

## Project Structure

```
xcode-mcp-server/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server implementation
│   ├── types/                   # Type definitions
│   ├── utils/                   # Utility functions
│   └── tools/                   # Tool implementations
│       ├── project/             # Project management tools
│       ├── file/                # File operation tools
│       ├── build/               # Build and testing tools
│       ├── cocoapods/           # CocoaPods integration
│       ├── spm/                 # Swift Package Manager tools
│       ├── simulator/           # iOS simulator tools
│       └── xcode/               # Xcode utilities
├── docs/                        # Documentation
├── tests/                       # Tests
└── dist/                        # Compiled code (generated)
```

## How It Works

The Xcode MCP server uses the Model Context Protocol to provide a standardized interface for AI models to interact with Xcode projects. The server:

1. Detects and manages Xcode projects
2. Provides tools for common Xcode operations
3. Ensures safe file access within project boundaries
4. Handles different project types (standard, workspace, SPM)

When an AI assistant needs to perform an action on an Xcode project, it sends a request to the MCP server, which executes the appropriate command and returns the results.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

When contributing new features, please include:
- Implementation code in the appropriate directory under `src/tools/`
- Tests for the new functionality
- Documentation updates as needed

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Thanks to the Model Context Protocol team for the MCP SDK
- Built with TypeScript and Node.js
