import * as childProcess from 'child_process';
import { createMockExec, xcodeToolsMockData } from '../../utils/mock-child-process';
import { registerXcodeTools } from '../../../src/tools/xcode/index';

// Mock the child_process module
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

describe('Xcode Tools', () => {
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
    childProcess.exec = createMockExec(xcodeToolsMockData);
  });
  
  describe('registerXcodeTools', () => {
    it('should register all Xcode tools with the server', () => {
      // Call the function that registers the tools
      registerXcodeTools(mockServer as any);
      
      // Check that four tools were registered
      expect(mockServer.server.tool).toHaveBeenCalledTimes(4);
      
      // Verify tool names
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'run_xcrun',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'compile_asset_catalog',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'run_lldb',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockServer.server.tool).toHaveBeenCalledWith(
        'trace_app',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });
  
  describe('run_xcrun', () => {
    it('should execute xcrun with the specified tool', async () => {
      // Register the tools
      registerXcodeTools(mockServer as any);
      
      // Get the handler function for run_xcrun (first registered tool)
      const runXcrunHandler = mockServer.server.tool.mock.calls[0][3];
      
      // Call the handler with a valid tool
      const result = await runXcrunHandler({ 
        tool: 'test-tool',
        arguments: '--test-arg' 
      });
      
      // Check the result
      expect(result.content[0].text).toContain('xcrun Output:');
      expect(result.content[0].text).toContain('Test tool executed successfully');
    });
    
    it('should handle errors with invalid tools', async () => {
      // Register the tools
      registerXcodeTools(mockServer as any);
      
      // Get the handler function for run_xcrun (first registered tool)
      const runXcrunHandler = mockServer.server.tool.mock.calls[0][3];
      
      // Call the handler with an invalid tool
      const result = await runXcrunHandler({ 
        tool: 'invalid-tool',
        arguments: '' 
      });
      
      // Check the result
      expect(result.content[0].text).toContain('xcrun Output:');
      expect(result.content[0].text).toContain('Tool not found');
    });
  });
  
  describe('compile_asset_catalog', () => {
    it('should compile an asset catalog', async () => {
      // Register the tools
      registerXcodeTools(mockServer as any);
      
      // Get the handler function for compile_asset_catalog (second registered tool)
      const compileAssetCatalogHandler = mockServer.server.tool.mock.calls[1][3];
      
      // Call the handler
      const result = await compileAssetCatalogHandler({ 
        catalogPath: '/path/to/Assets.xcassets',
        outputDir: '/path/to/output' 
      });
      
      // Check the result
      expect(result.content[0].text).toContain('Asset Catalog Compilation Output:');
      expect(result.content[0].text).toContain('Assets compiled to output directory');
    });
  });
  
  describe('run_lldb', () => {
    it('should run LLDB with the specified arguments', async () => {
      // Register the tools
      registerXcodeTools(mockServer as any);
      
      // Get the handler function for run_lldb (third registered tool)
      const runLldbHandler = mockServer.server.tool.mock.calls[2][3];
      
      // Call the handler
      const result = await runLldbHandler({ 
        lldbArgs: 'process attach --name "TestApp"' 
      });
      
      // Check the result
      expect(result.content[0].text).toContain('LLDB Output:');
      expect(result.content[0].text).toContain('LLDB debugger started');
    });
  });
  
  describe('trace_app', () => {
    it('should trace an app for the specified duration', async () => {
      // Register the tools
      registerXcodeTools(mockServer as any);
      
      // Get the handler function for trace_app (fourth registered tool)
      const traceAppHandler = mockServer.server.tool.mock.calls[3][3];
      
      // Call the handler
      const result = await traceAppHandler({ 
        appPath: '/path/to/TestApp.app',
        duration: 10 
      });
      
      // Check the result
      expect(result.content[0].text).toContain('Trace Output:');
      expect(result.content[0].text).toContain('Trace completed successfully');
    });
  });
}); 