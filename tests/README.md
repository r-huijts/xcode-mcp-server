# Xcode MCP Server Tests

This directory contains the testing suite for the Xcode MCP Server. We use Jest as our testing framework, with TypeScript support through ts-jest.

## Test Structure

```
tests/
├── utils/                        # Test utilities
│   └── mock-child-process.ts     # Utilities for mocking child processes
├── tools/                        # Tests for tool implementations
│   ├── simulator/                # Tests for simulator tools
│   │   └── simulator-tools.test.ts
│   ├── xcode/                    # Tests for Xcode tools
│   │   └── xcode-tools.test.ts
│   └── ... (other tool categories)
└── README.md                     # This file
```

## Mock Utilities

Since our server primarily interacts with external commands (like `xcrun`), we need to mock these interactions for testing. The `utils/mock-child-process.ts` file provides utilities for this purpose:

- `createMockExec()`: Creates a mock implementation of `child_process.exec` that returns predetermined outputs for specific commands.
- Mock data objects with sample responses for various commands.

## Writing Tests

### 1. Test Setup

Each test file should:

1. Import the necessary modules and mocks
2. Set up a mock for the XcodeServer object
3. Set up any other required mocks

Example:

```typescript
import * as childProcess from 'child_process';
import { createMockExec, simulatorMockData } from '../../utils/mock-child-process';
import { registerSimulatorTools } from '../../../src/tools/simulator/index';

// Mock the child_process module
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

describe('Simulator Tools', () => {
  // Mock the XcodeServer
  const mockServer = {
    server: {
      tool: jest.fn(),
    },
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-ignore - We're mocking the exec function
    childProcess.exec = createMockExec(simulatorMockData);
  });
  
  // Tests go here...
});
```

### 2. Testing Tool Registration

Test that each tool is properly registered with the server:

```typescript
it('should register all simulator tools with the server', () => {
  registerSimulatorTools(mockServer as any);
  
  // Check that the expected number of tools were registered
  expect(mockServer.server.tool).toHaveBeenCalledTimes(3);
  
  // Verify individual tool registrations
  expect(mockServer.server.tool).toHaveBeenCalledWith(
    'list_simulators',
    expect.any(String),
    expect.any(Object),
    expect.any(Function)
  );
  
  // Additional assertions for other tools...
});
```

### 3. Testing Tool Functionality

Test each tool's functionality by:
1. Getting the tool's handler function from the mock
2. Calling the handler with appropriate inputs
3. Verifying the output matches expectations

```typescript
it('should list all available simulators', async () => {
  registerSimulatorTools(mockServer as any);
  
  // Get the handler function (from the first registered tool)
  const listSimulatorsHandler = mockServer.server.tool.mock.calls[0][3];
  
  // Call the handler
  const result = await listSimulatorsHandler({});
  
  // Check the result
  expect(result.content[0].text).toContain('Simulators:');
  expect(result.content[0].text).toContain('iPhone 14');
});
```

### 4. Testing Error Handling

Ensure tools handle errors appropriately:

```typescript
it('should handle errors when booting a simulator with an invalid UDID', async () => {
  registerSimulatorTools(mockServer as any);
  
  const bootSimulatorHandler = mockServer.server.tool.mock.calls[1][3];
  
  // Call with invalid input
  const result = await bootSimulatorHandler({ udid: 'invalid-udid' });
  
  // Check that error is properly reflected in output
  expect(result.content[0].text).toContain('Invalid device UDID');
});
```

## Mock Data

When adding new tools, you may need to extend the mock data in `mock-child-process.ts`. Follow the existing pattern:

```typescript
export const newToolMockData = {
  'command pattern': {
    stdout: 'Expected standard output',
    stderr: 'Expected error output (if any)'
  },
  // Additional command patterns...
};
```

### Creating Realistic Mock Data

To create realistic mock data:

1. Run the actual command in your terminal
2. Note the output format
3. Create a simplified version for the test mock

For JSON outputs (like from `xcrun simctl list --json`), use a minimal valid JSON structure that exercises the code paths you need to test.

## Running Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run a specific test file:
```bash
npm test -- tests/tools/simulator/simulator-tools.test.ts
```

## Coverage Reports

Jest is configured to generate coverage reports. After running tests, you can find the reports in the `coverage` directory.

## Best Practices

1. **Keep tests isolated**: Each test should work independently
2. **Mock all external dependencies**: Especially filesystem and command-line tools
3. **Test error conditions**: Not just the happy path
4. **Keep mock data minimal**: Include only what's needed for the test
5. **Use descriptive test names**: Make it clear what each test is checking 