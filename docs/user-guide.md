# Xcode MCP Server User Guide

This guide provides detailed instructions on how to effectively use the Xcode MCP Server with AI assistants. It covers common workflows, example prompts, and best practices.

## Getting Started

After [installing the server](../README.md#installation), you can start using it with any MCP-compatible AI assistant. This guide focuses on using it with Claude Desktop and Cursor, but the concepts apply to any MCP client.

### Basic Workflow

1. Start the server using `npm start`
2. Connect your AI assistant to the server
3. Interact with your Xcode projects through the AI

## Working with Projects

### Setting Your Projects Directory

If you didn't set a projects directory during setup, you can do it through the AI:

```
Set my Xcode projects directory to /Users/username/Documents/XcodeProjects
```

The server will acknowledge the change and attempt to detect any projects in that directory.

### Viewing Active Project

You can ask about the currently active project:

```
What's my current active project? Show me its configuration, targets, and schemes.
```

### Setting Active Project

If the automatic project detection doesn't find your project, you can set it manually:

```
Set the active project to /Users/username/Documents/XcodeProjects/MyApp.xcodeproj
```

### Listing Project Files

You can ask to see files in the project:

```
List all Swift files in the current project
```

or

```
Show me all view controllers in the project
```

## File Operations

### Reading Files

To view the content of a file:

```
Show me the contents of AppDelegate.swift
```

or

```
Let me see the implementation of the UserModel class
```

### Modifying Files

You can ask the AI to create or modify files:

```
Create a new Swift file called ProfileViewModel with a basic MVVM structure
```

or 

```
Add a function to handle user authentication in UserService.swift
```

### Finding Code

You can ask the AI to find specific code patterns:

```
Find all usages of UITableView in the project
```

or

```
Where are network requests being made in the app?
```

## Building and Testing

### Building the Project

To build your project:

```
Build the project using the 'Debug' configuration and 'MyApp' scheme
```

### Running Tests

To run tests:

```
Run the tests for the current project
```

or

```
Run the unit tests in the 'UserModelTests' test suite
```

### Static Analysis

You can use the static analyzer:

```
Analyze the NetworkManager.swift file for potential issues
```

## CocoaPods Integration

### Checking CocoaPods Status

To check if your project uses CocoaPods:

```
Check if this project uses CocoaPods and show me the installed pods
```

### Installing Pods

To install CocoaPods dependencies:

```
Run pod install for the current project
```

### Updating Pods

To update CocoaPods dependencies:

```
Update all pods in the project
```

or

```
Update only the Alamofire and SwiftyJSON pods
```

## Swift Package Manager

### Initializing a Swift Package

To create a new Swift Package:

```
Initialize a new Swift Package in the current directory as a library called "MyLibrary"
```

### Adding a Package Dependency

To add a new Swift Package dependency:

```
Add the Swift package at https://github.com/Alamofire/Alamofire.git with version from: 5.0.0
```

### Updating Packages

To update packages:

```
Update all Swift packages in this project
```

## Simulator Management

### Listing Simulators

To see available simulators:

```
Show me all available iOS simulators
```

### Working with Simulators

To boot a simulator:

```
Boot the simulator with UDID 12345678-1234-1234-1234-123456789012
```

To shut down a simulator:

```
Shut down the simulator with UDID 12345678-1234-1234-1234-123456789012
```

## Advanced Xcode Operations

### Using Xcode Tools

To run specific Xcode tools:

```
Run the actool command to compile the Assets.xcassets file
```

### Debugging

To use LLDB:

```
Run LLDB with the command 'process attach --name "MyApp"'
```

### Performance Tracing

To capture performance traces:

```
Capture a 10-second performance trace of MyApp.app
```

## Example Workflows

### Starting a New Feature

Here's an example conversation to create a new feature:

```
User: I need to add a user profile screen to my iOS app. It should display the user's name, email, profile picture, and settings.

AI: I'll help you add a user profile screen. First, let's check if you have a UserProfile model or something similar.

[AI uses tools to search the project for relevant files]

AI: I'll create the necessary files for a user profile feature using MVVM architecture:
1. A UserProfileModel
2. A UserProfileViewModel
3. A UserProfileViewController or SwiftUI View

[AI creates the files with appropriate implementations]
```

### Debugging an Issue

Here's how debugging might look:

```
User: My app crashes when I try to load user data from the API. The crash happens in UserService.swift around line 45.

AI: Let me check that file to understand what's happening.

[AI reads the UserService.swift file]

AI: I see the issue. On line 47, you're force-unwrapping an optional value from the JSON response. If that value is nil, it would cause a crash.

Let me suggest a fix:

[AI modifies the code to safely handle the optional]

User: Can you also add some unit tests to verify this won't happen again?

AI: Certainly! I'll create unit tests for the UserService that specifically test handling missing data in the response.

[AI creates or modifies test files]
```

## Best Practices

1. **Be Specific**: When asking the AI to make changes, be specific about what you want. Include file names and clear requirements.

2. **Verify Changes**: Always review the changes made by the AI before committing them to your production code.

3. **Incremental Changes**: Work with the AI in small, incremental steps rather than asking for massive changes all at once.

4. **Project Context**: When starting a new session, give the AI a brief overview of your project structure and architecture to help it make more informed decisions.

5. **Follow Up**: If the AI doesn't get something right the first time, follow up with clarifications rather than completely changing your approach.

## Troubleshooting

### Server Not Finding Projects

If the server can't find your projects:
- Make sure the projects directory path is correct
- Check that the projects have the `.xcodeproj` or `.xcworkspace` extension
- Try setting the active project path explicitly

### Build Issues

If builds fail:
- Verify that you're using a valid scheme and configuration
- Check that the project builds normally in Xcode
- Look for any dependency issues (CocoaPods, SPM)

### File Operation Errors

If file operations fail:
- Check file permissions
- Verify the path is within the active project directory
- Make sure the file exists when trying to modify it

## Advanced Configuration

For advanced users, the `.env` file supports additional configuration options:
- `DEBUG`: Enable detailed logging
- `MAX_CACHED_FILES`: Control memory usage
- Custom project detection behavior

See the [`.env.example`](../.env.example) file for more details.

## Getting Help

If you encounter issues with the Xcode MCP Server, you can:
1. Check the server logs for error messages
2. Refer to this guide and the [Tools Overview](./tools-overview.md)
3. File an issue on the GitHub repository 