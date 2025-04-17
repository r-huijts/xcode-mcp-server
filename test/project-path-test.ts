// Simple test script to validate our path handling fixes

import * as path from 'path';
import { getProjectInfo, getWorkspaceInfo } from '../src/utils/project.js';

/**
 * Test various project path formats
 */
async function testProjectPaths() {
  console.error('Testing project path handling...');
  
  // Test cases with various path formats
  const testCases = [
    {
      description: 'Standard .xcodeproj path',
      path: '/path/to/TestProject.xcodeproj'
    },
    {
      description: 'Standard .xcworkspace path',
      path: '/path/to/TestProject.xcworkspace'
    },
    {
      description: 'project.xcworkspace inside .xcodeproj',
      path: '/path/to/TestProject.xcodeproj/project.xcworkspace'
    }
  ];
  
  // Mock the execAsync function to verify command construction
  const originalExecAsync = (global as any).execAsync;
  
  (global as any).execAsync = async (cmd: string) => {
    console.error(`Command that would be executed: ${cmd}`);
    // Return mock data so the function can continue
    return {
      stdout: 'Mock stdout\nTargets:\nMockTarget\nBuild Configurations:\nDebug\nRelease\nSchemes:\nMockScheme'
    };
  };
  
  // Test getProjectInfo with each case
  console.error('\n--- Testing getProjectInfo ---');
  for (const testCase of testCases) {
    console.error(`\nTesting: ${testCase.description}`);
    try {
      // We don't need the actual result, we just want to see what command is constructed
      await getProjectInfo(testCase.path);
    } catch (error) {
      console.error(`Error: ${(error as any).message}`);
    }
  }
  
  // Test getWorkspaceInfo with each case
  console.error('\n--- Testing getWorkspaceInfo ---');
  for (const testCase of testCases) {
    console.error(`\nTesting: ${testCase.description}`);
    try {
      // We don't need the actual result, we just want to see what command is constructed
      await getWorkspaceInfo(testCase.path);
    } catch (error) {
      console.error(`Error: ${(error as any).message}`);
    }
  }
  
  // Restore original execAsync
  (global as any).execAsync = originalExecAsync;
}

// Run the tests
testProjectPaths()
  .then(() => console.error('\nTests completed'))
  .catch(error => console.error(`Test failed: ${error.message}`)); 