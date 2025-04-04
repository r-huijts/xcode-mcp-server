# Xcode MCP Server Manual Test Plan

## Test Progress Summary
✅ = Passed
❌ = Failed
⏳ = Not Yet Tested

### Progress by Section
- Project Management Tools: 0/8 Complete ⏳
- File Operation Tools: 0/10 Complete ⏳
- Path Management Tools: 0/5 Complete ⏳
- Build & Testing Tools: 0/3 Complete ⏳
- CocoaPods Integration: 0/7 Complete ⏳
- Swift Package Manager Tools: 0/9 Complete ⏳
- Simulator Tools: 0/8 Complete ⏳
- Xcode Utilities: 0/6 Complete ⏳

## Test Environment Setup

### Required Software
- macOS Ventura or later
- Xcode 14.0 or later
- Node.js 16 or later
- CocoaPods
- Swift Package Manager
- Git
- An MCP-compatible AI assistant (e.g., Claude Desktop, Cursor)

### Test Projects Setup
1. Create a test directory: `$HOME/XcodeMCPTests`
2. Create the following test projects:
   ```bash
   # Create test directory
   mkdir -p $HOME/XcodeMCPTests
   cd $HOME/XcodeMCPTests

   # Regular Xcode project
   # Using Xcode UI (Recommended):
   # 1. Open Xcode
   # 2. File > New > Project
   # 3. Choose iOS > App
   # 4. Set Product Name: "TestApp"
   # 5. Set Organization Identifier: "com.test"
   # 6. Choose $HOME/XcodeMCPTests for location
   
   # CocoaPods project
   # Using Xcode UI (Recommended):
   # 1. Open Xcode
   # 2. File > New > Project
   # 3. Choose iOS > App
   # 4. Set Product Name: "PodTestApp"
   # 5. Set Organization Identifier: "com.test"
   # 6. Choose $HOME/XcodeMCPTests for location
   cd $HOME/XcodeMCPTests/PodTestApp
   pod init
   echo "platform :ios, '15.0'\n\npod 'Alamofire'" > Podfile
   
   # Workspace project
   # Using Xcode UI (Recommended):
   # 1. Open Xcode
   # 2. File > New > Workspace
   # 3. Set Workspace Name: "TestWorkspace"
   # 4. Choose $HOME/XcodeMCPTests for location
   # 5. Add TestApp and PodTestApp to the workspace
   
   # Swift Package
   mkdir -p $HOME/XcodeMCPTests/TestPackage
   cd $HOME/XcodeMCPTests/TestPackage
   swift package init --type library
   
   # Files for testing
   mkdir -p $HOME/XcodeMCPTests/Files
   cd $HOME/XcodeMCPTests/Files
   echo "This is a test file" > test.txt
   mkdir -p TestDir
   echo "This is a nested test file" > TestDir/nested.txt
   ```

   Note: While there are command-line options for creating Xcode projects (like using templates), the most reliable method is using the Xcode UI. This ensures all project settings and files are created correctly.

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

#### TC-PM-02: Find Projects
**Prerequisites:**
- Projects base directory set

**Query:**
```
Find all Xcode projects in my projects directory, including workspaces and Swift Package Manager projects.
```

**Expected Result:**
- Returns list of projects including:
  - TestApp.xcodeproj
  - PodTestApp.xcodeproj
  - TestWorkspace.xcworkspace
  - TestPackage (Swift Package Manager project)

#### TC-PM-03: Set Active Project (Xcode Project)
**Prerequisites:**
- Projects base directory set

**Query:**
```
Please set the TestApp project as my active project. It's located at ~/XcodeMCPTests/TestApp/TestApp.xcodeproj
```

**Expected Result:**
- Server confirms project is set as active
- Project information is displayed

#### TC-PM-04: Set Active Project (Workspace)
**Prerequisites:**
- Projects base directory set

**Query:**
```
Set the active project to ~/XcodeMCPTests/TestWorkspace.xcworkspace
```

**Expected Result:**
- Server confirms workspace is set as active
- Workspace information is displayed
- Contained projects are listed

#### TC-PM-05: Set Active Project (SPM)
**Prerequisites:**
- Projects base directory set

**Query:**
```
Set the active project to ~/XcodeMCPTests/TestPackage
```

**Expected Result:**
- Server confirms SPM project is set as active
- Project information is displayed

#### TC-PM-06: Get Active Project (Detailed)
**Prerequisites:**
- Active project set

**Query:**
```
What's my current active project? Show me its detailed information including configurations, targets, and schemes.
```

**Expected Result:**
- Returns detailed project information including path, targets, build configurations, schemes
- For workspaces, shows contained projects
- For SPM projects, shows relevant package info

#### TC-PM-07: Get Project Configuration
**Prerequisites:**
- Active project set

**Query:**
```
Retrieve the configuration details for my active project.
```

**Expected Result:**
- For Xcode projects/workspaces: returns configurations, schemes, targets
- For SPM projects: returns available configurations

#### TC-PM-08: Detect Active Project
**Prerequisites:**
- At least one Xcode project open in Xcode

**Query:**
```
Can you detect which Xcode project I'm currently working on?
```

**Expected Result:**
- Server detects the frontmost Xcode project
- Sets it as active project
- Returns project information

### Path Management Tools

#### TC-PATH-01: Change Directory
**Prerequisites:**
- Active project set
- Valid project structure

**Query:**
```
Change directory to the project's Source directory.
```

**Expected Result:**
- Active directory changes to the Source directory
- Confirms new directory path

#### TC-PATH-02: Push Directory
**Prerequisites:**
- Active project set

**Query:**
```
Push directory to the Tests directory. I'll want to come back to where I am now later.
```

**Expected Result:**
- Current directory pushed onto stack
- Active directory changes to Tests directory
- Confirms new directory path

#### TC-PATH-03: Pop Directory
**Prerequisites:**
- Directory previously pushed

**Query:**
```
Pop directory to return to where I was before.
```

**Expected Result:**
- Returns to previous directory
- Confirms new directory path

#### TC-PATH-04: Get Current Directory
**Prerequisites:**
- Active project set

**Query:**
```
What's my current directory?
```

**Expected Result:**
- Returns current active directory path

#### TC-PATH-05: Resolve Path
**Prerequisites:**
- Active directory set

**Query:**
```
Resolve the path ../Resources/images
```

**Expected Result:**
- Returns resolved absolute path
- Indicates read/write permissions for the path
- Shows active directory and project root

### File Operation Tools

#### TC-FO-01: Read File
**Prerequisites:**
- Active project set

**Query:**
```
Show me the contents of AppDelegate.swift. I want to see how it's implemented.
```

**Expected Result:**
- Returns complete file contents with proper formatting

#### TC-FO-02: Write File
**Prerequisites:**
- Active project set

**Query:**
```
Can you create a new file called TestModel.swift with a basic class structure? It should have some properties and a simple initializer.
```

**Expected Result:**
- File is created with specified content
- File appears in project navigator
- Success message returned

#### TC-FO-03: Copy File
**Prerequisites:**
- Active project set
- Existing file to copy

**Query:**
```
Copy AppDelegate.swift to AppDelegateCopy.swift
```

**Expected Result:**
- File is copied successfully
- Success message returned

#### TC-FO-04: Move File
**Prerequisites:**
- Active project set
- Existing file to move

**Query:**
```
Create a directory called 'Models' and then move TestModel.swift into it.
```

**Expected Result:**
- Directory created
- File moved successfully
- Success message returned

#### TC-FO-05: Delete File
**Prerequisites:**
- Active project set
- File to delete exists

**Query:**
```
Delete the file AppDelegateCopy.swift that we just created.
```

**Expected Result:**
- File deleted successfully
- Success message returned

#### TC-FO-06: Create Directory
**Prerequisites:**
- Active project set

**Query:**
```
Create a new directory called Utils/Helpers.
```

**Expected Result:**
- Directories created (including parent directories)
- Success message returned

#### TC-FO-07: List Directory
**Prerequisites:**
- Active project set
- Directory to list

**Query:**
```
List files in the current directory with detailed information and include hidden files.
```

**Expected Result:**
- Returns detailed directory listing
- Includes file size, type, permissions
- Shows hidden files

#### TC-FO-08: Get File Info
**Prerequisites:**
- Active project set
- File exists

**Query:**
```
Get detailed information about AppDelegate.swift.
```

**Expected Result:**
- Returns file metadata (size, permissions, type)
- Shows creation and modification dates
- For text files, shows line count and encoding

#### TC-FO-09: Find Files
**Prerequisites:**
- Active project set

**Query:**
```
Find all Swift files containing "View" in their name.
```

**Expected Result:**
- Returns matching files (like ContentView.swift)
- Shows search results with paths

#### TC-FO-10: Check File Exists
**Prerequisites:**
- Active project set

**Query:**
```
Does the file Config.json exist in my project?
```

**Expected Result:**
- Returns existence status
- If exists, shows file type
- Shows resolved path

### Build & Testing Tools

#### TC-BT-01: Build Project
**Prerequisites:**
- Active project set

**Query:**
```
Please build the project using the Debug configuration. Let me know if there are any issues.
```

**Expected Result:**
- Build completes successfully
- Build output is returned

#### TC-BT-02: Run Tests
**Prerequisites:**
- Active project set
- Project has test target

**Query:**
```
Run all the tests in the project and show me the results.
```

**Expected Result:**
- Tests execute
- Test results are returned

#### TC-BT-03: Analyze File
**Prerequisites:**
- Active project set

**Query:**
```
Analyze ContentView.swift for potential issues or improvements.
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
Check if this project uses CocoaPods and show me what pods are installed.
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
Run pod install for the current project with clean cache and repo update.
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
Update all pods in the project.
```

**Expected Result:**
- Pods are updated successfully
- Update output is returned

#### TC-CP-04: Pod Outdated
**Prerequisites:**
- Active project set to PodTestApp
- Pods already installed

**Query:**
```
Show me which pods are outdated in my project.
```

**Expected Result:**
- Returns list of outdated pods
- Shows current and latest versions
- Includes update recommendations

#### TC-CP-05: Pod Repo Update
**Prerequisites:**
- CocoaPods installed

**Query:**
```
Update the CocoaPods spec repositories.
```

**Expected Result:**
- Repos are updated
- Update output is returned

#### TC-CP-06: Pod Init
**Prerequisites:**
- Active project without Podfile

**Query:**
```
Initialize a new Podfile in the current project.
```

**Expected Result:**
- Podfile created
- Success message returned

#### TC-CP-07: Pod Deintegrate
**Prerequisites:**
- Active project with CocoaPods integrated

**Query:**
```
Deintegrate CocoaPods from my project.
```

**Expected Result:**
- CocoaPods removed from project
- Project returned to pre-CocoaPods state
- Success message returned

### Swift Package Manager Tools

#### TC-SPM-01: Initialize Swift Package
**Prerequisites:**
- In empty directory

**Query:**
```
Initialize a new Swift Package called "TestTool" as an executable with XCTest support.
```

**Expected Result:**
- Package.swift created for executable
- XCTest dependency added
- Basic package structure created
- Success message returned

#### TC-SPM-02: Add Swift Package
**Prerequisites:**
- Active project is Swift package

**Query:**
```
Add the Swift package at https://github.com/apple/swift-log.git with version range: 1.0.0 to 1.5.0
```

**Expected Result:**
- Package.swift updated with dependency
- Dependency resolved
- Success message returned

#### TC-SPM-03: Update Swift Package
**Prerequisites:**
- Package has dependencies

**Query:**
```
Update the swift-log package to the latest version.
```

**Expected Result:**
- Dependency updated
- Update output returned

#### TC-SPM-04: Build Swift Package
**Prerequisites:**
- Active project is Swift package

**Query:**
```
Build the Swift package in release configuration.
```

**Expected Result:**
- Package builds successfully
- Build output returned

#### TC-SPM-05: Test Swift Package
**Prerequisites:**
- Active project is Swift package with tests

**Query:**
```
Run Swift package tests filtering for the "LoggingTests" test suite.
```

**Expected Result:**
- Specified tests execute
- Test results returned

#### TC-SPM-06: Show Swift Dependencies
**Prerequisites:**
- Package has dependencies

**Query:**
```
Show me the dependencies of this Swift package as a graph.
```

**Expected Result:**
- Dependency graph displayed
- Shows dependency relationships

#### TC-SPM-07: Clean Swift Package
**Prerequisites:**
- Package has been built

**Query:**
```
Clean the Swift package build artifacts.
```

**Expected Result:**
- Build artifacts removed
- Success message returned

#### TC-SPM-08: Dump Swift Package
**Prerequisites:**
- Valid Swift package

**Query:**
```
Dump the Package.swift manifest as JSON.
```

**Expected Result:**
- JSON representation of package manifest
- Shows targets, dependencies, platforms

#### TC-SPM-09: Swift Package Command
**Prerequisites:**
- Valid Swift package

**Query:**
```
Run the swift package tools-version command.
```

**Expected Result:**
- Command executes
- Output returned

### Simulator Tools

#### TC-SIM-01: List Simulators
**Prerequisites:**
- Xcode installed with simulators

**Query:**
```
Show me all available iOS simulators.
```

**Expected Result:**
- Returns JSON list of all available simulators
- Each simulator entry includes UDID, name, and state

#### TC-SIM-02: Boot Simulator
**Prerequisites:**
- Valid simulator UDID from list

**Query:**
```
Boot the simulator with UDID [UDID from previous list].
```

**Expected Result:**
- Simulator boots successfully
- Success message returned

#### TC-SIM-03: Shutdown Simulator
**Prerequisites:**
- Running simulator

**Query:**
```
Shut down the simulator with UDID [UDID of running simulator].
```

**Expected Result:**
- Simulator shuts down
- Success message returned

#### TC-SIM-04: Install App
**Prerequisites:**
- Built app (.app bundle)
- Running simulator

**Query:**
```
Install TestApp.app on the booted simulator.
```

**Expected Result:**
- App installed on simulator
- Success message returned

#### TC-SIM-05: Launch App
**Prerequisites:**
- App installed on simulator
- Running simulator

**Query:**
```
Launch com.test.TestApp on the simulator.
```

**Expected Result:**
- App launches on simulator
- Success message returned

#### TC-SIM-06: Terminate App
**Prerequisites:**
- Running app on simulator

**Query:**
```
Terminate the running TestApp on the simulator.
```

**Expected Result:**
- App terminates
- Success message returned

#### TC-SIM-07: Take Screenshot
**Prerequisites:**
- Running simulator

**Query:**
```
Take a screenshot of the current simulator state.
```

**Expected Result:**
- Screenshot captured
- Screenshot saved
- Path to screenshot returned

#### TC-SIM-08: Record Video
**Prerequisites:**
- Running simulator

**Query:**
```
Record a 10-second video of the simulator.
```

**Expected Result:**
- Video recorded
- Video saved
- Path to video file returned

### Xcode Utilities

#### TC-XU-01: Run Xcrun
**Prerequisites:**
- Xcode installed

**Query:**
```
Run xcrun simctl list to show me the simulator devices in a different format.
```

**Expected Result:**
- Command executes successfully
- Output returned

#### TC-XU-02: Compile Asset Catalog
**Prerequisites:**
- Project has Assets.xcassets

**Query:**
```
Compile the Assets.xcassets catalog in my project.
```

**Expected Result:**
- Assets compiled successfully
- Compiled assets in output directory

#### TC-XU-03: Run LLDB
**Prerequisites:**
- Running app process

**Query:**
```
Attach LLDB to the process named "TestApp".
```

**Expected Result:**
- LLDB attaches successfully
- Debug session started

#### TC-XU-04: Trace App
**Prerequisites:**
- Running app

**Query:**
```
Capture a 5-second performance trace of my app.
```

**Expected Result:**
- Trace captured successfully
- Trace file created

#### TC-XU-05: Get Xcode Info
**Prerequisites:**
- Xcode installed

**Query:**
```
Show me information about my Xcode installation.
```

**Expected Result:**
- Returns Xcode version, path
- Shows SDK versions
- Shows other relevant Xcode information

#### TC-XU-06: Generate App Icons
**Prerequisites:**
- Source image available

**Query:**
```
Generate app icons from my source image icon.png.
```

**Expected Result:**
- Icons generated for various sizes
- Icon set created
- Success message returned

## Test Results Template

For each test case, record results in the following format:

**TC-XX-YY: Test Name**
- Date: YYYY-MM-DD
- Tester: [Name]
- AI Assistant: [Assistant Name]
- Result: ✅ PASS / ❌ FAIL
- Actual Behavior: [Description of what actually happened]
- Notes: [Any relevant observations or issues]