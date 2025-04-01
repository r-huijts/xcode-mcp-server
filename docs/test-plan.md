# Xcode MCP Server Manual Test Plan

This document outlines a comprehensive test plan for manually verifying all tools in the Xcode MCP Server. Each test case includes prerequisites, steps to execute, and expected results.

## Test Environment Setup

### Required Software
- macOS Ventura or later
- Xcode 14.0 or later
- Node.js 16 or later
- CocoaPods
- Git

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

**Steps:**
1. Start the server
2. Set projects base directory to `~/XcodeMCPTests`

**Expected Result:**
- Server acknowledges the directory change
- Server scans and finds all test projects

#### TC-PM-02: Set Active Project
**Prerequisites:**
- Projects base directory set

**Steps:**
1. Set active project to `~/XcodeMCPTests/TestApp/TestApp.xcodeproj`

**Expected Result:**
- Server confirms project is set as active
- Project information is displayed

#### TC-PM-03: Get Active Project
**Prerequisites:**
- Active project set

**Steps:**
1. Request active project information

**Expected Result:**
- Returns project path, targets, build configurations, and schemes

### File Operation Tools

#### TC-FO-01: List Project Files
**Prerequisites:**
- Active project set to TestApp

**Steps:**
1. List all Swift files in the project

**Expected Result:**
- Returns list of Swift files including AppDelegate.swift and SceneDelegate.swift

#### TC-FO-02: Read File
**Prerequisites:**
- Active project set to TestApp

**Steps:**
1. Read contents of AppDelegate.swift

**Expected Result:**
- Returns complete file contents with proper formatting

#### TC-FO-03: Write File
**Prerequisites:**
- Active project set to TestApp

**Steps:**
1. Create a new file "TestModel.swift" with basic class structure
2. Verify file exists in project

**Expected Result:**
- File is created with specified content
- File appears in project navigator

### Build & Testing Tools

#### TC-BT-01: Build Project
**Prerequisites:**
- Active project set to TestApp

**Steps:**
1. Build project with Debug configuration

**Expected Result:**
- Build completes successfully
- Build output is returned

#### TC-BT-02: Run Tests
**Prerequisites:**
- Active project set to TestApp
- Project has test target

**Steps:**
1. Run all tests in project

**Expected Result:**
- Tests execute
- Test results are returned

#### TC-BT-03: Analyze File
**Prerequisites:**
- Active project set to TestApp

**Steps:**
1. Analyze AppDelegate.swift

**Expected Result:**
- Static analysis results returned
- Any issues found are reported

### CocoaPods Integration

#### TC-CP-01: Check CocoaPods
**Prerequisites:**
- Active project set to PodTestApp

**Steps:**
1. Check CocoaPods status

**Expected Result:**
- Returns CocoaPods installation status
- Lists any installed pods

#### TC-CP-02: Pod Install
**Prerequisites:**
- Active project set to PodTestApp
- Podfile contains `pod 'Alamofire'`

**Steps:**
1. Run pod install

**Expected Result:**
- Pods are installed successfully
- Workspace is created
- Installation output is returned

#### TC-CP-03: Pod Update
**Prerequisites:**
- Active project set to PodTestApp
- Pods already installed

**Steps:**
1. Run pod update

**Expected Result:**
- Pods are updated successfully
- Update output is returned

### Swift Package Manager Tools

#### TC-SPM-01: Initialize Package
**Prerequisites:**
- In empty directory

**Steps:**
1. Initialize new Swift package named "TestLib"

**Expected Result:**
- Package.swift created
- Basic package structure created
- Success message returned

#### TC-SPM-02: Add Package Dependency
**Prerequisites:**
- Active project is Swift package

**Steps:**
1. Add dependency on Alamofire package

**Expected Result:**
- Package.swift updated with dependency
- Dependency resolved
- Success message returned

#### TC-SPM-03: Update Package
**Prerequisites:**
- Package has dependencies

**Steps:**
1. Update all dependencies

**Expected Result:**
- Dependencies updated
- Update output returned

### Simulator Tools

#### TC-SIM-01: List Simulators
**Prerequisites:**
- Xcode installed with simulators

**Steps:**
1. Request list of available simulators

**Expected Result:**
- Returns JSON list of all available simulators
- Each simulator entry includes UDID, name, and state

#### TC-SIM-02: Boot Simulator
**Prerequisites:**
- Valid simulator UDID from list

**Steps:**
1. Boot simulator with specified UDID

**Expected Result:**
- Simulator boots successfully
- Success message returned

#### TC-SIM-03: Shutdown Simulator
**Prerequisites:**
- Running simulator

**Steps:**
1. Shutdown simulator with specified UDID

**Expected Result:**
- Simulator shuts down
- Success message returned

### Xcode Utilities

#### TC-XU-01: Run xcrun
**Prerequisites:**
- Active project set

**Steps:**
1. Run xcrun with simctl list command

**Expected Result:**
- Command executes successfully
- Output returned

#### TC-XU-02: Compile Asset Catalog
**Prerequisites:**
- Project has Assets.xcassets

**Steps:**
1. Compile asset catalog using actool

**Expected Result:**
- Assets compiled successfully
- Compiled assets in output directory

#### TC-XU-03: Run LLDB
**Prerequisites:**
- Running app process

**Steps:**
1. Attach LLDB to process

**Expected Result:**
- LLDB attaches successfully
- Debug session started

#### TC-XU-04: Trace App
**Prerequisites:**
- Running app

**Steps:**
1. Capture 5-second trace

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