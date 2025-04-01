# Xcode MCP Server Manual Test Plan

This document outlines a comprehensive test plan for manually verifying all tools in the Xcode MCP Server. Each test case includes prerequisites, steps to execute, expected results, and the natural language queries to use with the AI assistant.

## Test Environment Setup

### Required Software
- macOS Ventura or later
- Xcode 14.0 or later
- Node.js 16 or later
- CocoaPods
- Git
- An MCP-compatible AI assistant (e.g., Claude Desktop, Cursor)

### Test Projects Setup
1. Create a test directory: `~/XcodeMCPTests`
2. Create the following test projects:
   ```bash
   # Regular Xcode project
   xed --create-project ~/XcodeMCPTests/TestApp
   
   # CocoaPods project
   xed --create-project ~/XcodeMCPTests/PodTestApp
   cd ~/XcodeMCPTests/PodTestApp
   pod init
   
   # Swift Package
   mkdir ~/XcodeMCPTests/TestPackage
   cd ~/XcodeMCPTests/TestPackage
   swift package init
   ```

## Test Cases

### Project Management Tools

#### TC-PM-01: Set Projects Base Directory
**Prerequisites:**
- Fresh server installation
- Test directory created

**Query:**
```
Can you set my Xcode projects directory to ~/XcodeMCPTests? I want to manage all my test projects from there.
```

**Expected Result:**
- Server acknowledges the directory change
- Server scans and finds all test projects

#### TC-PM-02: Set Active Project
**Prerequisites:**
- Projects base directory set

**Query:**
```
Please set the TestApp project as my active project. It's located at ~/XcodeMCPTests/TestApp/TestApp.xcodeproj
```

**Expected Result:**
- Server confirms project is set as active
- Project information is displayed

#### TC-PM-03: Get Active Project
**Prerequisites:**
- Active project set

**Query:**
```
What's my current active project? Can you show me its configuration, targets, and available schemes?
```

**Expected Result:**
- Returns project path, targets, build configurations, and schemes

### File Operation Tools

#### TC-FO-01: List Project Files
**Prerequisites:**
- Active project set to TestApp

**Query:**
```
Can you list all Swift files in the current project? I want to see what source files we have.
```

**Expected Result:**
- Returns list of Swift files including AppDelegate.swift and SceneDelegate.swift

#### TC-FO-02: Read File
**Prerequisites:**
- Active project set to TestApp

**Query:**
```
Show me the contents of AppDelegate.swift. I want to see how it's implemented.
```

**Expected Result:**
- Returns complete file contents with proper formatting

#### TC-FO-03: Write File
**Prerequisites:**
- Active project set to TestApp

**Query:**
```
Can you create a new file called TestModel.swift with a basic class structure? It should have some properties and a simple initializer.
```

**Expected Result:**
- File is created with specified content
- File appears in project navigator

### Build & Testing Tools

#### TC-BT-01: Build Project
**Prerequisites:**
- Active project set to TestApp

**Query:**
```
Please build the project using the Debug configuration. Let me know if there are any issues.
```

**Expected Result:**
- Build completes successfully
- Build output is returned

#### TC-BT-02: Run Tests
**Prerequisites:**
- Active project set to TestApp
- Project has test target

**Query:**
```
Can you run all the tests in the project and show me the results?
```

**Expected Result:**
- Tests execute
- Test results are returned

#### TC-BT-03: Analyze File
**Prerequisites:**
- Active project set to TestApp

**Query:**
```
Could you analyze AppDelegate.swift for potential issues or improvements?
```

**Expected Result:**
- Static analysis results returned
- Any issues found are reported

### CocoaPods Integration

#### TC-CP-01: Check CocoaPods
**Prerequisites:**
- Active project set to PodTestApp

**Query:**
```
Can you check if this project uses CocoaPods and show me what pods are installed?
```

**Expected Result:**
- Returns CocoaPods installation status
- Lists any installed pods

#### TC-CP-02: Pod Install
**Prerequisites:**
- Active project set to PodTestApp
- Podfile contains `pod 'Alamofire'`

**Query:**
```
Please run pod install for the current project. I've added Alamofire as a dependency.
```

**Expected Result:**
- Pods are installed successfully
- Workspace is created
- Installation output is returned

#### TC-CP-03: Pod Update
**Prerequisites:**
- Active project set to PodTestApp
- Pods already installed

**Query:**
```
Could you update all the pods in the project to their latest versions?
```

**Expected Result:**
- Pods are updated successfully
- Update output is returned

### Swift Package Manager Tools

#### TC-SPM-01: Initialize Package
**Prerequisites:**
- In empty directory

**Query:**
```
Can you initialize a new Swift package named "TestLib"? I want to create a basic library package.
```

**Expected Result:**
- Package.swift created
- Basic package structure created
- Success message returned

#### TC-SPM-02: Add Package Dependency
**Prerequisites:**
- Active project is Swift package

**Query:**
```
Please add Alamofire as a dependency to this package. You can use the latest version from GitHub.
```

**Expected Result:**
- Package.swift updated with dependency
- Dependency resolved
- Success message returned

#### TC-SPM-03: Update Package
**Prerequisites:**
- Package has dependencies

**Query:**
```
Could you update all the package dependencies to their latest versions?
```

**Expected Result:**
- Dependencies updated
- Update output returned

### Simulator Tools

#### TC-SIM-01: List Simulators
**Prerequisites:**
- Xcode installed with simulators

**Query:**
```
Can you show me a list of all available iOS simulators on my system?
```

**Expected Result:**
- Returns JSON list of all available simulators
- Each simulator entry includes UDID, name, and state

#### TC-SIM-02: Boot Simulator
**Prerequisites:**
- Valid simulator UDID from list

**Query:**
```
Please boot the simulator with UDID [UDID from previous list]. I need to test something on it.
```

**Expected Result:**
- Simulator boots successfully
- Success message returned

#### TC-SIM-03: Shutdown Simulator
**Prerequisites:**
- Running simulator

**Query:**
```
Can you shut down the simulator with UDID [UDID of running simulator]? I'm done testing.
```

**Expected Result:**
- Simulator shuts down
- Success message returned

### Xcode Utilities

#### TC-XU-01: Run xcrun
**Prerequisites:**
- Active project set

**Query:**
```
Could you run xcrun simctl list to show me the simulator devices in a different format?
```

**Expected Result:**
- Command executes successfully
- Output returned

#### TC-XU-02: Compile Asset Catalog
**Prerequisites:**
- Project has Assets.xcassets

**Query:**
```
Can you compile the Assets.xcassets catalog in my project? I need the processed assets for testing.
```

**Expected Result:**
- Assets compiled successfully
- Compiled assets in output directory

#### TC-XU-03: Run LLDB
**Prerequisites:**
- Running app process

**Query:**
```
I need to debug my running app. Can you attach LLDB to the process named "TestApp"?
```

**Expected Result:**
- LLDB attaches successfully
- Debug session started

#### TC-XU-04: Trace App
**Prerequisites:**
- Running app

**Query:**
```
Could you capture a 5-second performance trace of my app? I want to analyze its behavior.
```

**Expected Result:**
- Trace captured successfully
- Trace file created

## Test Results Template

For each test case, record results in the following format:

```
Test Case ID: [ID]
Date: [Date]
Tester: [Name]
Server Version: [Version]

Result: [PASS/FAIL]
Actual Behavior: [Description]
Issues Found: [List any issues]
Notes: [Additional observations]
```

## Test Execution Order

1. Start with Project Management tests (TC-PM-*)
2. Proceed to File Operations (TC-FO-*)
3. Run Build & Testing tools (TC-BT-*)
4. Test CocoaPods integration (TC-CP-*)
5. Test Swift Package Manager tools (TC-SPM-*)
6. Test Simulator tools (TC-SIM-*)
7. Finally, test Xcode utilities (TC-XU-*)

## Issue Reporting

When reporting issues:
1. Include the Test Case ID
2. Provide complete steps to reproduce
3. Include relevant logs
4. Attach screenshots if applicable
5. Note the exact environment details

## Test Environment Cleanup

After completing all tests:
1. Delete test projects
2. Shutdown any running simulators
3. Clean build directories
4. Remove any created test files

## Test Data Management

Keep the following test artifacts:
1. Test results logs
2. Screenshots of failures
3. Generated crash reports
4. Performance trace files

This allows for proper analysis and debugging of any issues found during testing. 