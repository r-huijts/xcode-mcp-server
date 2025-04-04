import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, XcodeServerError, CommandExecutionError, PathAccessError } from "../../utils/errors.js";
import { getProjectInfo, getWorkspaceInfo } from "../../utils/project.js";

const execAsync = promisify(exec);

/**
 * Register build and testing tools
 */
export function registerBuildTools(server: XcodeServer) {
  // Register "analyze_file"
  server.server.tool(
    "analyze_file",
    "Analyzes a source file for potential issues using Xcode's static analyzer.",
    {
      filePath: z.string().describe("Path to the source file to analyze. Can be absolute, relative to active directory, or use ~ for home directory."),
      sdk: z.string().optional().describe("Optional SDK to use for analysis (e.g., 'iphoneos', 'iphonesimulator'). Defaults to automatic selection based on available devices."),
      scheme: z.string().optional().describe("Optional scheme to use. If not provided, will use the first available scheme.")
    },
    async ({ filePath, sdk, scheme }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(filePath);
        
        // Use the path management system to validate the file path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        const validatedPath = server.pathManager.validatePathForReading(resolvedPath);
        
        const result = await analyzeFile(server, validatedPath, { sdk, scheme });
        return {
          content: [{
            type: "text" as const,
            text: result.content[0].text
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "build_project"
  server.server.tool(
    "build_project",
    "Builds the active Xcode project using the specified configuration and scheme.",
    {
      configuration: z.string().describe("Build configuration to use (e.g., 'Debug' or 'Release')."),
      scheme: z.string().describe("Name of the build scheme to be built. Must be one of the schemes available in the project."),
      destination: z.string().optional().describe("Optional destination specifier (e.g., 'platform=iOS Simulator,name=iPhone 15'). If not provided, a suitable destination will be selected automatically."),
      sdk: z.string().optional().describe("Optional SDK to use (e.g., 'iphoneos', 'iphonesimulator'). If not provided, will use the default SDK for the project type."),
      jobs: z.number().optional().describe("Maximum number of concurrent build operations (optional, default is determined by Xcode)."),
      derivedDataPath: z.string().optional().describe("Path where build products and derived data will be stored (optional).")
    },
    async ({ configuration, scheme, destination, sdk, jobs, derivedDataPath }) => {
      if (!server.activeProject) {
        throw new ProjectNotFoundError();
      }
      
      // Validate configuration and scheme
      const info = await getProjectInfo(server.activeProject.path);
      if (!info.configurations.includes(configuration)) {
        throw new XcodeServerError(`Invalid configuration "${configuration}". Available configurations: ${info.configurations.join(", ")}`);
      }
      if (!info.schemes.includes(scheme)) {
        throw new XcodeServerError(`Invalid scheme "${scheme}". Available schemes: ${info.schemes.join(", ")}`);
      }
      
      const result = await buildProject(server, configuration, scheme, { destination, sdk, jobs, derivedDataPath });
      return {
        content: [{
          type: "text" as const,
          text: result.content[0].text
        }]
      };
    }
  );

  // Register "run_tests"
  server.server.tool(
    "run_tests",
    "Executes tests for the active Xcode project.",
    {
      testPlan: z.string().optional().describe("Optional name of the test plan to run."),
      destination: z.string().optional().describe("Optional destination specifier (e.g., 'platform=iOS Simulator,name=iPhone 15'). If not provided, a suitable simulator will be selected automatically."),
      scheme: z.string().optional().describe("Optional scheme to use for testing. If not provided, will use the active project's scheme."),
      onlyTesting: z.array(z.string()).optional().describe("Optional list of tests to include, excluding all others. Format: 'TestTarget/TestClass/testMethod'."),
      skipTesting: z.array(z.string()).optional().describe("Optional list of tests to exclude. Format: 'TestTarget/TestClass/testMethod'."),
      resultBundlePath: z.string().optional().describe("Optional path where test results bundle will be stored."),
      enableCodeCoverage: z.boolean().optional().describe("Whether to enable code coverage during testing (default: false).")
    },
    async ({ testPlan, destination, scheme, onlyTesting, skipTesting, resultBundlePath, enableCodeCoverage }) => {
      const result = await runTests(server, {
        testPlan,
        destination,
        scheme,
        onlyTesting,
        skipTesting,
        resultBundlePath,
        enableCodeCoverage
      });
      return {
        content: [{
          type: "text" as const,
          text: result.content[0].text
        }]
      };
    }
  );

  // Register "list_available_destinations"
  server.server.tool(
    "list_available_destinations",
    "Lists available build destinations for the active Xcode project or workspace.",
    {
      scheme: z.string().optional().describe("Optional scheme to show destinations for. If not provided, uses the active scheme.")
    },
    async ({ scheme }) => {
      if (!server.activeProject) {
        throw new ProjectNotFoundError();
      }

      try {
        const workingDir = server.directoryState.getActiveDirectory();
        
        // Construct the base command
        const projectFlag = server.activeProject.isWorkspace ? 
          `-workspace "${server.activeProject.path}"` : 
          `-project "${server.activeProject.path}"`;
        
        const schemeArg = scheme ? `-scheme "${scheme}"` : "";
        
        // Request destinations in a more structured format
        const cmd = `cd "${workingDir}" && xcodebuild ${projectFlag} ${schemeArg} -showdestinations -json`;
        
        const { stdout, stderr } = await execAsync(cmd);
        
        // Parse destinations from JSON output
        let destinations;
        try {
          destinations = JSON.parse(stdout);
        } catch (error) {
          // Fall back to text output if JSON parsing fails
          return {
            content: [{
              type: "text",
              text: `Available destinations:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        }
        
        return {
          content: [{
            type: "text",
            text: `Available destinations for ${scheme || 'active project'}:\n` +
                  JSON.stringify(destinations, null, 2)
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'xcodebuild -showdestinations',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
}

/**
 * Finds the best available simulator for testing
 * @param runtimePrefix Prefix of the runtime to look for (e.g., 'iOS')
 * @returns The best available simulator device or undefined if none found
 */
async function findBestAvailableSimulator(runtimePrefix = 'iOS') {
  try {
    // Get list of all simulators in JSON format
    const { stdout: simulatorList } = await execAsync('xcrun simctl list --json');
    const simulators = JSON.parse(simulatorList);
    
    // Find the latest runtime that matches our prefix
    const runtimes = Object.keys(simulators.devices)
      .filter(runtime => runtime.includes(runtimePrefix))
      .sort()
      .reverse();
    
    if (runtimes.length === 0) {
      return undefined;
    }
    
    // Get devices for latest runtime
    const latestRuntime = runtimes[0];
    const devices = simulators.devices[latestRuntime];
    
    // Define a type for the simulator device
    type SimulatorDevice = {
      udid: string;
      name: string;
      state?: string;
      availability?: string;
      isAvailable?: boolean;
    };
    
    // Find the first available (not busy or unavailable) device
    const availableDevice = devices.find((device: SimulatorDevice) => 
      device.availability === '(available)' || device.isAvailable === true
    );
    
    // If no available device, just return the first one
    return availableDevice || devices[0];
  } catch (error) {
    console.error("Error finding simulator:", error);
    return undefined;
  }
}

/**
 * Helper function to analyze a file
 */
async function analyzeFile(server: XcodeServer, filePath: string, options: { sdk?: string, scheme?: string } = {}) {
  try {
    if (!server.activeProject) throw new ProjectNotFoundError();
    
    // Get project info to find available schemes
    const info = await getProjectInfo(server.activeProject.path);
    if (!info.schemes || info.schemes.length === 0) {
      throw new XcodeServerError("No schemes found in the project");
    }
    
    // Use provided scheme or first available scheme
    const scheme = options.scheme || info.schemes[0];
    
    let destinationFlag = '';
    
    // If SDK is provided, use it directly
    if (options.sdk) {
      destinationFlag = `-sdk ${options.sdk}`;
    } else {
      // Otherwise, find a suitable simulator
      const simulator = await findBestAvailableSimulator();
      if (!simulator) {
        throw new XcodeServerError("No available iOS simulators found");
      }
      
      destinationFlag = `-destination "platform=iOS Simulator,id=${simulator.udid}"`;
    }
    
    // Build the analyze command
    const projectFlag = server.activeProject.isWorkspace ? 
      `-workspace "${server.activeProject.path}"` : 
      `-project "${server.activeProject.path}"`;
    
    // Get the active directory from ProjectDirectoryState for the working directory
    const workingDir = server.directoryState.getActiveDirectory();
    
    // Build the analyze command with more options for better analysis
    const cmd = `cd "${workingDir}" && xcodebuild ${projectFlag} -scheme "${scheme}" ${destinationFlag} analyze -quiet -analyzer-output html`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd);
      return { 
        content: [{ 
          type: "text", 
          text: `Analysis output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}` 
        }] 
      };
    } catch (error) {
      let stderr = '';
      if (error instanceof Error && 'stderr' in error) {
        stderr = (error as any).stderr;
      }
      throw new CommandExecutionError(
        'xcodebuild analyze',
        stderr || (error instanceof Error ? error.message : String(error))
      );
    }
  } catch (error) {
    console.error("Error analyzing file:", error);
    throw error;
  }
}

/**
 * Helper function to build a project
 */
async function buildProject(server: XcodeServer, configuration: string, scheme: string, options: {
  destination?: string,
  sdk?: string,
  jobs?: number,
  derivedDataPath?: string
} = {}) {
  if (!server.activeProject) throw new ProjectNotFoundError();
  
  const projectPath = server.activeProject.path;
  let projectInfo;
  
  try {
    // Different command for workspace vs project vs SPM
    if (server.activeProject.isSPMProject) {
      // For SPM projects, we use swift build
      const buildConfig = configuration.toLowerCase() === 'release' ? '--configuration release' : '';
      try {
        // Use the active directory from ProjectDirectoryState for the working directory
        const workingDir = server.directoryState.getActiveDirectory();
        
        // Add jobs parameter if specified
        const jobsArg = options.jobs ? `--jobs ${options.jobs}` : '';
        
        const cmd = `cd "${workingDir}" && swift build ${buildConfig} ${jobsArg}`;
        const { stdout, stderr } = await execAsync(cmd);
        return {
          content: [{
            type: "text",
            text: `Build output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          `swift build for ${server.activeProject.name}`,
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    } else if (server.activeProject.isWorkspace) {
      projectInfo = await getWorkspaceInfo(projectPath);
    } else {
      projectInfo = await getProjectInfo(projectPath);
    }
    
    // For Xcode projects/workspaces, validate configuration and scheme
    if (!projectInfo) {
      throw new XcodeServerError("Failed to get project information");
    }
    
    if (!projectInfo.configurations.includes(configuration)) {
      throw new XcodeServerError(`Invalid configuration "${configuration}". Available configurations: ${projectInfo.configurations.join(", ")}`);
    }
    if (!projectInfo.schemes.includes(scheme)) {
      throw new XcodeServerError(`Invalid scheme "${scheme}". Available schemes: ${projectInfo.schemes.join(", ")}`);
    }
    
    // Use -workspace for workspace projects, -project for regular projects
    const projectFlag = server.activeProject.isWorkspace ? `-workspace "${projectPath}"` : `-project "${projectPath}"`;
    
    // Handle destination or SDK specification
    let destinationOrSdkFlag = '';
    if (options.destination) {
      destinationOrSdkFlag = `-destination "${options.destination}"`;
    } else if (options.sdk) {
      destinationOrSdkFlag = `-sdk ${options.sdk}`;
    } else {
      // Try to find a suitable simulator if no destination or SDK is specified
      const simulator = await findBestAvailableSimulator();
      if (simulator) {
        destinationOrSdkFlag = `-destination "platform=iOS Simulator,id=${simulator.udid}"`;
      }
    }
    
    // Handle additional options
    const jobsFlag = options.jobs ? `-jobs ${options.jobs}` : '';
    const derivedDataFlag = options.derivedDataPath ? `-derivedDataPath "${options.derivedDataPath}"` : '';
    
    // Use the active directory from ProjectDirectoryState for the working directory
    const workingDir = server.directoryState.getActiveDirectory();
    
    // More advanced build command with enhanced options
    const cmd = `cd "${workingDir}" && xcodebuild ${projectFlag} -scheme "${scheme}" -configuration "${configuration}" ${destinationOrSdkFlag} ${jobsFlag} ${derivedDataFlag} build -quiet`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd);
      
      // Check for known error patterns
      if (stderr && (
        stderr.includes("xcodebuild: error:") || 
        stderr.includes("** BUILD FAILED **")
      )) {
        throw new CommandExecutionError(
          `xcodebuild for ${scheme} (${configuration})`,
          stderr
        );
      }
      
      return {
        content: [{
          type: "text",
          text: `Build output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
        }]
      };
    } catch (error) {
      let stderr = '';
      if (error instanceof Error && 'stderr' in error) {
        stderr = (error as any).stderr;
      }
      throw new CommandExecutionError(
        `xcodebuild for ${scheme} (${configuration})`,
        stderr || (error instanceof Error ? error.message : String(error))
      );
    }
  } catch (error) {
    console.error("Error building project:", error);
    throw error;
  }
}

/**
 * Helper function to run tests
 */
async function runTests(server: XcodeServer, options: {
  testPlan?: string,
  destination?: string,
  scheme?: string,
  onlyTesting?: string[],
  skipTesting?: string[],
  resultBundlePath?: string,
  enableCodeCoverage?: boolean
} = {}) {
  try {
    if (!server.activeProject) throw new ProjectNotFoundError();
    
    // Use the active directory from ProjectDirectoryState for the working directory
    const workingDir = server.directoryState.getActiveDirectory();
    
    // Build the command with all the provided options
    const projectFlag = server.activeProject.isWorkspace ? 
      `-workspace "${server.activeProject.path}"` : 
      `-project "${server.activeProject.path}"`;
    
    // If scheme is provided, use it, otherwise we need to figure out a scheme
    let schemeFlag = '';
    if (options.scheme) {
      schemeFlag = `-scheme "${options.scheme}"`;
    } else {
      // Try to get schemes from the project info
      try {
        const info = server.activeProject.isWorkspace ?
          await getWorkspaceInfo(server.activeProject.path) :
          await getProjectInfo(server.activeProject.path);
        
        if (info.schemes && info.schemes.length > 0) {
          schemeFlag = `-scheme "${info.schemes[0]}"`;
        } else {
          throw new XcodeServerError("No schemes found in the project. Please specify a scheme for testing.");
        }
      } catch (error) {
        throw new XcodeServerError("Failed to determine scheme for testing. Please specify a scheme.");
      }
    }
    
    // Handle testPlan option
    const testPlanFlag = options.testPlan ? `-testPlan "${options.testPlan}"` : "";
    
    // Handle destination option or find a suitable simulator
    let destinationFlag = '';
    if (options.destination) {
      destinationFlag = `-destination "${options.destination}"`;
    } else {
      // Try to find a suitable simulator
      const simulator = await findBestAvailableSimulator();
      if (simulator) {
        destinationFlag = `-destination "platform=iOS Simulator,id=${simulator.udid}"`;
      }
    }
    
    // Handle only-testing flags
    const onlyTestingFlags = options.onlyTesting && options.onlyTesting.length > 0
      ? options.onlyTesting.map(test => `-only-testing:${test}`).join(' ')
      : '';
    
    // Handle skip-testing flags
    const skipTestingFlags = options.skipTesting && options.skipTesting.length > 0
      ? options.skipTesting.map(test => `-skip-testing:${test}`).join(' ')
      : '';
    
    // Handle result bundle path
    const resultBundleFlag = options.resultBundlePath
      ? `-resultBundlePath "${options.resultBundlePath}"`
      : '';
    
    // Handle code coverage
    const codeCoverageFlag = options.enableCodeCoverage === true
      ? '-enableCodeCoverage YES'
      : '';
    
    // Build the full command
    const cmd = `cd "${workingDir}" && xcodebuild ${projectFlag} ${schemeFlag} ${destinationFlag} ${testPlanFlag} ${onlyTestingFlags} ${skipTestingFlags} ${resultBundleFlag} ${codeCoverageFlag} test`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd);
      
      // Check for test failures
      const hasFailures = stdout.includes("** TEST FAILED **") || stderr.includes("** TEST FAILED **");
      
      // Parse and structure the test results better
      let formattedOutput = `Test ${hasFailures ? 'FAILED' : 'PASSED'}\n\n`;
      
      // Try to extract a more useful summary from the output
      const testSummaryMatch = stdout.match(/Test Suite '.*?'(.*?)finished at/s);
      if (testSummaryMatch) {
        formattedOutput += `Test Summary:\n${testSummaryMatch[0]}\n\n`;
      }
      
      // Add detailed output for reference
      formattedOutput += `Full test results:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`;
      
      return { 
        content: [{ 
          type: "text", 
          text: formattedOutput
        }] 
      };
    } catch (error) {
      // Extract the stderr from the command execution error if available
      let stderr = '';
      if (error instanceof Error && 'stderr' in error) {
        stderr = (error as any).stderr;
      }
      
      // Check for specific test failure vs command failure
      if (stderr.includes("** TEST FAILED **") || (error instanceof Error && error.message.includes("** TEST FAILED **"))) {
        // Try to extract a more useful summary from the output
        let formattedOutput = `Test FAILED\n\n`;
        
        const testSummaryMatch = stderr.match(/Test Suite '.*?'(.*?)finished at/s);
        if (testSummaryMatch) {
          formattedOutput += `Test Summary:\n${testSummaryMatch[0]}\n\n`;
        }
        
        formattedOutput += `Full test results:\n${stderr}`;
        
        return { 
          content: [{ 
            type: "text", 
            text: formattedOutput
          }] 
        };
      }
      
      throw new CommandExecutionError(
        'xcodebuild test',
        stderr || (error instanceof Error ? error.message : String(error))
      );
    }
  } catch (error) {
    console.error("Error running tests:", error);
    throw error;
  }
} 