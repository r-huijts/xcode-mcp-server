/**
 * Mock utilities for child process testing
 */

// Mock the child_process.exec function for testing
export const createMockExec = (
  mockOutputs: Record<string, { stdout: string; stderr: string }>
) => {
  return jest.fn((command: string, callback: Function) => {
    // Find the matching command in the mockOutputs
    const matchedCommand = Object.keys(mockOutputs).find((cmd) =>
      command.match(new RegExp(cmd))
    );
    
    if (matchedCommand) {
      const { stdout, stderr } = mockOutputs[matchedCommand];
      // Call callback with mock results
      process.nextTick(() => callback(null, stdout, stderr));
    } else {
      // Command not found in mockOutputs
      process.nextTick(() => 
        callback(new Error(`Command not mocked: ${command}`), '', '')
      );
    }
    
    // Return a mock child process
    return {
      on: jest.fn(),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() }
    };
  });
};

// Sample simulator mockdata that can be used in tests
export const simulatorMockData = {
  'xcrun simctl list --json': {
    stdout: JSON.stringify({
      "devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-16-0": [
          {
            "udid": "00000000-0000-0000-0000-000000000001",
            "name": "iPhone 14",
            "state": "Shutdown",
            "isAvailable": true
          },
          {
            "udid": "00000000-0000-0000-0000-000000000002",
            "name": "iPhone 14 Pro",
            "state": "Booted",
            "isAvailable": true
          }
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-15-0": [
          {
            "udid": "00000000-0000-0000-0000-000000000003",
            "name": "iPhone 13",
            "state": "Shutdown",
            "isAvailable": true
          }
        ]
      }
    }),
    stderr: ''
  },
  'xcrun simctl boot "00000000-0000-0000-0000-000000000001"': {
    stdout: 'Device booted successfully',
    stderr: ''
  },
  'xcrun simctl boot "invalid-udid"': {
    stdout: '',
    stderr: 'Invalid device UDID'
  },
  'xcrun simctl shutdown "00000000-0000-0000-0000-000000000002"': {
    stdout: 'Device shutdown successfully',
    stderr: ''
  }
};

// Sample Xcode tools mockdata that can be used in tests
export const xcodeToolsMockData = {
  'xcrun actool': {
    stdout: 'Asset catalog compiled successfully',
    stderr: ''
  },
  'xcrun actool --compile': {
    stdout: 'Assets compiled to output directory',
    stderr: ''
  },
  'xctrace': {
    stdout: 'Trace completed successfully',
    stderr: ''
  },
  'xcrun lldb': {
    stdout: 'LLDB debugger started',
    stderr: ''
  },
  'xcrun test-tool': {
    stdout: 'Test tool executed successfully',
    stderr: ''
  },
  'xcrun invalid-tool': {
    stdout: '',
    stderr: 'Tool not found'
  }
}; 