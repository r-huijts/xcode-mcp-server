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

### Finding Projects

You can ask the AI to find Xcode projects in your directory:

```
Find all Xcode projects in my projects directory, including workspaces and Swift Package Manager projects
```

### Viewing Active Project

You can ask about the currently active project:

```
What's my current active project? Show me its detailed information including configurations, targets, and schemes.
```

### Setting Active Project

If the automatic project detection doesn't find your project, you can set it manually:

```
Set the active project to /Users/username/Documents/XcodeProjects/MyApp.xcodeproj
```

The server now supports different project types:

```
Set the active project to /Users/username/Documents/XcodeProjects/MyApp.xcworkspace
```

Or for Swift Package Manager projects:

```
Set the active project to /Users/username/Documents/SwiftPackages/MyPackage
```

### Directory Navigation

The server now has improved directory navigation. You can change directories:

```
Change directory to Sources/Models
```

Push directories onto a stack for easy navigation:

```
Push directory to Tests/UnitTests
```

And return to previous directories:

```
Pop directory to return to previous location
```

Check your current location:

```
What's my current directory?
```

### Listing Project Files

You can ask to see files in the project:

```
List all Swift files in the current project
```

For more detailed information:

```
List files in the current directory with detailed information and include hidden files
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

### Getting File Information

To get detailed information about a file:

```
Get information about Package.swift
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

### File Management

You can now perform additional file operations:

Copy a file:
```
Copy the UserModel.swift file to Models/Legacy/UserModel.swift
```

Move a file:
```
Move the AppDelegate.swift file to the Application directory
```

Delete a file:
```
Delete the OldViewController.swift file
```

Create a directory:
```
Create a new directory called Networking/Services
```

### Finding Files

You can find files matching patterns:

```
Find all Swift files containing "View" in their name
```

or

```
Find all JSON files in the Resources directory
```

### Checking File Existence

Check if a file exists:

```
Does the file Configuration.json exist?
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

Or with more options:

```
Run pod install with clean cache and repo update
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

### Checking Outdated Pods

To check for outdated pods:

```
Show me which pods are outdated in my project
```

### Repo Management

To update CocoaPods repositories:

```
Update the CocoaPods spec repositories
```

### Initializing Podfile

To create a new Podfile:

```
Initialize a new Podfile in the current project
```

### Removing CocoaPods

To remove CocoaPods from a project:

```
Deintegrate CocoaPods from my project
```

## Swift Package Manager

### Initializing a Swift Package

To create a new Swift Package:

```
Initialize a new Swift Package in the current directory as a library called "MyLibrary"
```

With more options:

```
Initialize a new Swift Package called "MyTool" as an executable with XCTest support
```

### Adding a Package Dependency

To add a new Swift Package dependency:

```
Add the Swift package at https://github.com/Alamofire/Alamofire.git with version from: 5.0.0
```

Or with specific version requirements:

```
Add the Swift package at https://github.com/apple/swift-log.git with version range: 1.0.0 to 1.5.0
```

### Updating Packages

To update packages:

```
Update all Swift packages in this project
```

Or update a specific package:

```
Update the Alamofire package to the latest version
```

### Building Swift Packages

To build a Swift Package:

```
Build the Swift package in release configuration
```

### Testing Swift Packages

To run tests:

```
Test the Swift package with verbose output
```

Or with specific filters:

```
Run Swift package tests filtering for the "NetworkTests" test suite
```

### Viewing Dependencies

To see package dependencies:

```
Show me the dependencies of this Swift package as a graph
```

### Cleaning Build Artifacts

To clean up build files:

```
Clean the Swift package build artifacts
```

### Dump Package Manifest

To see the package structure:

```
Dump the Package.swift manifest as JSON
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

### App Management

To install an app:

```
Install MyApp.app on the booted simulator
```

To launch an app:

```
Launch com.mycompany.MyApp on the simulator
```

To terminate an app:

```
Terminate the running MyApp on the simulator
```

### Taking Screenshots

To capture a simulator screenshot:

```
Take a screenshot of the current simulator state
```

### Recording Video

To record simulator activity:

```
Record a 30-second video of the simulator
```

## Advanced Xcode Operations

### Using Xcode Tools

To run specific Xcode tools:

```
Run the actool command to compile the Assets.xcassets file
```

### Getting Xcode Information

To get information about the installed Xcode:

```
Show me information about my Xcode installation
```

### Generating App Icons

To generate app icons:

```
Generate app icons from my source image icon.png
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

## Path Management

The server now includes secure path management. You can:

### Check Path Resolution

To see how a path would be resolved:

```
Resolve the path ../Resources/images
```

### Navigating Directories

To change directories:

```
Change to the project's Source directory
```

To push directory for temporary navigation:

```
Push directory to Tests and then run the tests
```

To return to previous directory:

```
Pop directory to return where we were before
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

### Working with Swift Packages

Here's an example of working with Swift Package Manager:

```
User: I need to create a new networking library as a Swift Package.

AI: I'll help you create a new Swift Package for networking. Let's first initialize a new package.

[AI initializes a new Swift Package]

AI: Now let's add some dependencies that will help with networking.

[AI adds dependencies like Alamofire]

AI: Let's create the basic structure for our networking library.

[AI creates network manager, request builders, etc.]

AI: Now let's write some tests to verify the functionality.

[AI creates tests for the networking features]

AI: Finally, let's build and test the package to make sure everything works.

[AI builds and tests the package]
```

## Best Practices

1. **Be Specific**: When asking the AI to make changes, be specific about what you want. Include file names and clear requirements.

2. **Use Directory Navigation**: Use the directory navigation tools to move around your project structure efficiently.

3. **Verify Changes**: Always review the changes made by the AI before committing them to your production code.

4. **Incremental Changes**: Work with the AI in small, incremental steps rather than asking for massive changes all at once.

5. **Project Context**: When starting a new session, give the AI a brief overview of your project structure and architecture to help it make more informed decisions.

6. **Follow Up**: If the AI doesn't get something right the first time, follow up with clarifications rather than completely changing your approach.

7. **Path References**: Use relative paths based on your current directory when referring to files.

## Troubleshooting

### Server Not Finding Projects

If the server can't find your projects:
- Make sure the projects directory path is correct
- Check that the projects have the `.xcodeproj` or `.xcworkspace` extension
- Try setting the active project path explicitly
- Use the `find_projects` tool to see what projects are detected

### Path Resolution Issues

If you encounter path-related errors:
- Use `get_current_directory` to check your current location
- Use `resolve_path` to see how paths are being resolved
- Make sure paths are within allowed boundaries
- Use directory navigation tools to position yourself correctly

### Build Issues

If builds fail:
- Verify that you're using a valid scheme and configuration
- Check that the project builds normally in Xcode
- Use `get_project_configuration` to see available schemes and configurations
- Look for any dependency issues (CocoaPods, SPM)

### File Operation Errors

If file operations fail:
- Check file permissions
- Verify the path is within the active project directory
- Use `check_file_exists` to confirm file existence
- Make sure the file exists when trying to modify it

## Advanced Configuration

For advanced users, the `.env` file supports additional configuration options:
- `DEBUG`: Enable detailed logging
- `MAX_CACHED_FILES`: Control memory usage
- `PROJECTS_BASE_DIR`: Set default projects directory
- Custom project detection behavior

See the [`.env.example`](../.env.example) file for more details.

## Getting Help

If you encounter issues with the Xcode MCP Server, you can:
1. Check the server logs for error messages
2. Refer to this guide and the [Tools Overview](./tools-overview.md)
3. Use the path resolution and validation tools to debug path issues
4. File an issue on the GitHub repository 