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
  
  // Setup before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up mock exec implementation
    // @ts-ignore - We're mocking the exec function
    childProcess.exec = createMockExec(simulatorMockData);
  });
  
  describe('registerSimulatorTools', () => {
    it('should register all simulator tools with the server', () => {
      // Call the function that registers the tools
      registerSimulatorTools(mockServer as any);
      
      // Check that three tools were registered
      expect(mockServer.server.tool).toHaveBeenCalledTimes(3);
      
      // Verify tool names
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'list_simulators',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'boot_simulator',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'shutdown_simulator',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });
  
  describe('list_simulators', () => {
    it('should list all available simulators', async () => {
      // Register the tools
      registerSimulatorTools(mockServer as any);
      
      // Get the handler function for list_simulators (first registered tool)
      const listSimulatorsHandler = mockServer.server.tool.mock.calls[0][3];
      
      // Call the handler
      const result = await listSimulatorsHandler({});
      
      // Check the result
      expect(result.content[0].text).toContain('Simulators:');
      expect(result.content[0].text).toContain('iPhone 14');
      expect(result.content[0].text).toContain('iPhone 14 Pro');
      expect(result.content[0].text).toContain('iPhone 13');
    });
  });
  
  describe('boot_simulator', () => {
    it('should boot a simulator with the provided UDID', async () => {
      // Register the tools
      registerSimulatorTools(mockServer as any);
      
      // Get the handler function for boot_simulator (second registered tool)
      const bootSimulatorHandler = mockServer.server.tool.mock.calls[1][3];
      
      // Call the handler with a valid UDID
      const result = await bootSimulatorHandler({ udid: '00000000-0000-0000-0000-000000000001' });
      
      // Check the result
      expect(result.content[0].text).toContain('Boot Simulator Output:');
      expect(result.content[0].text).toContain('Device booted successfully');
    });
    
    it('should handle errors when booting a simulator with an invalid UDID', async () => {
      // Register the tools
      registerSimulatorTools(mockServer as any);
      
      // Get the handler function for boot_simulator (second registered tool)
      const bootSimulatorHandler = mockServer.server.tool.mock.calls[1][3];
      
      // Call the handler with an invalid UDID
      const result = await bootSimulatorHandler({ udid: 'invalid-udid' });
      
      // Check the result
      expect(result.content[0].text).toContain('Boot Simulator Output:');
      expect(result.content[0].text).toContain('Invalid device UDID');
    });
  });
  
  describe('shutdown_simulator', () => {
    it('should shutdown a simulator with the provided UDID', async () => {
      // Register the tools
      registerSimulatorTools(mockServer as any);
      
      // Get the handler function for shutdown_simulator (third registered tool)
      const shutdownSimulatorHandler = mockServer.server.tool.mock.calls[2][3];
      
      // Call the handler with a valid UDID
      const result = await shutdownSimulatorHandler({ udid: '00000000-0000-0000-0000-000000000002' });
      
      // Check the result
      expect(result.content[0].text).toContain('Shutdown Simulator Output:');
      expect(result.content[0].text).toContain('Device shutdown successfully');
    });
  });
}); 