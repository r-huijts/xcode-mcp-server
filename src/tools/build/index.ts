import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, XcodeServerError, CommandExecutionError, PathAccessError } from "../../utils/errors.js";
import { getProjectInfo, getWorkspaceInfo } from "../../utils/project.js";
import { runExecFile } from "../../utils/execFile.js";

function xcodeBuildArgs(projectPath: string, isWorkspace: boolean): string[] {
  if (projectPath.endsWith(".xcworkspace") || isWorkspace) {
    return ["-workspace", projectPath];
  }
  return ["-project", projectPath];
}

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

      let sanitizedDerivedDataPath: string | undefined;
      if (derivedDataPath) {
        const resolvedPath = server.pathManager.normalizePath(derivedDataPath);
        server.pathManager.validatePathForWriting(resolvedPath);
        sanitizedDerivedDataPath = resolvedPath;
      }

      const result = await buildProject(server, configuration, scheme, {
        destination,
        sdk,
        jobs,
        derivedDataPath: sanitizedDerivedDataPath
      });
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
      let sanitizedResultBundlePath: string | undefined;
      if (resultBundlePath) {
        const resolvedPath = server.pathManager.normalizePath(resultBundlePath);
        server.pathManager.validatePathForWriting(resolvedPath);
        sanitizedResultBundlePath = resolvedPath;
      }

      const result = await runTests(server, {
        testPlan,
        destination,
        scheme,
        onlyTesting,
        skipTesting,
        resultBundlePath: sanitizedResultBundlePath,
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
        const projectPath = server.activeProject.path;
        const args = [...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false)];
        if (scheme) args.push("-scheme", scheme);
        args.push("-showdestinations", "-json");

        const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

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

  // Register "list_available_schemes"
  server.server.tool(
    "list_available_schemes",
    "Lists all available schemes in the active Xcode project or workspace.",
    {},
    async () => {
      if (!server.activeProject) {
        throw new ProjectNotFoundError();
      }

      try {
        const workingDir = server.directoryState.getActiveDirectory();
        const projectPath = server.activeProject.path;
        const args = [...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false), "-list", "-json"];

        const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

        // Parse schemes from JSON output
        let schemeInfo;
        try {
          schemeInfo = JSON.parse(stdout);

          // Format the output in a more readable way
          let formattedOutput = `Available schemes for ${server.activeProject.name}:\n`;

          if (schemeInfo.project && schemeInfo.project.schemes) {
            formattedOutput += `\nProject schemes:\n`;
            schemeInfo.project.schemes.forEach((scheme: string) => {
              formattedOutput += `- ${scheme}\n`;
            });
          }

          if (schemeInfo.workspace && schemeInfo.workspace.schemes) {
            formattedOutput += `\nWorkspace schemes:\n`;
            schemeInfo.workspace.schemes.forEach((scheme: string) => {
              formattedOutput += `- ${scheme}\n`;
            });
          }

          // Add configurations if available
          if (schemeInfo.project && schemeInfo.project.configurations) {
            formattedOutput += `\nAvailable configurations:\n`;
            schemeInfo.project.configurations.forEach((config: string) => {
              formattedOutput += `- ${config}\n`;
            });
          }

          // Add targets if available
          if (schemeInfo.project && schemeInfo.project.targets) {
            formattedOutput += `\nAvailable targets:\n`;
            schemeInfo.project.targets.forEach((target: string) => {
              formattedOutput += `- ${target}\n`;
            });
          }

          return {
            content: [{
              type: "text",
              text: formattedOutput
            }]
          };
        } catch (error) {
          // Fall back to text output if JSON parsing fails
          return {
            content: [{
              type: "text",
              text: `Available schemes:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        }
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'xcodebuild -list',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "clean_project"
  server.server.tool(
    "clean_project",
    "Cleans the build directory for the active Xcode project.",
    {
      scheme: z.string().optional().describe("Optional scheme to clean. If not provided, will use the first available scheme."),
      configuration: z.string().optional().describe("Optional build configuration to clean (e.g., 'Debug' or 'Release'). If not provided, cleans all configurations."),
      derivedDataPath: z.string().optional().describe("Optional path to the derived data directory to clean. If not provided, uses Xcode's default location.")
    },
    async ({ scheme, configuration, derivedDataPath }) => {
      if (!server.activeProject) {
        throw new ProjectNotFoundError();
      }

      try {
        const workingDir = server.directoryState.getActiveDirectory();

        // Get project info to find available schemes if needed
        let projectInfo;
        if (server.activeProject.isWorkspace) {
          projectInfo = await getWorkspaceInfo(server.activeProject.path);
        } else {
          projectInfo = await getProjectInfo(server.activeProject.path);
        }

        // Use provided scheme or first available scheme
        const schemeToUse = scheme || (projectInfo.schemes && projectInfo.schemes.length > 0 ? projectInfo.schemes[0] : undefined);

        if (!schemeToUse) {
          throw new XcodeServerError("No scheme specified and no schemes found in the project");
        }

        const projectPath = server.activeProject.path;
        const args = [...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false), "-scheme", schemeToUse];
        if (configuration) args.push("-configuration", configuration);
        let sanitizedDerivedDataPath: string | undefined;
        if (derivedDataPath) {
          const resolvedPath = server.pathManager.normalizePath(derivedDataPath);
          server.pathManager.validatePathForWriting(resolvedPath);
          sanitizedDerivedDataPath = resolvedPath;
        }
        if (sanitizedDerivedDataPath) args.push("-derivedDataPath", sanitizedDerivedDataPath);
        args.push("clean");

        const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

        return {
          content: [{
            type: "text",
            text: `Clean completed successfully:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("scheme not found")) {
            throw new XcodeServerError("The specified scheme was not found in the project. Use list_available_schemes to see available schemes.");
          }

          if (errorMsg.includes("does not contain a scheme")) {
            throw new XcodeServerError("The project does not contain any schemes. Make sure the project is properly configured.");
          }
        }

        throw new CommandExecutionError(
          'xcodebuild clean',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // The list_available_schemes tool is already registered above (lines 180-267)

  // Register "archive_project"
  server.server.tool(
    "archive_project",
    "Archives the active Xcode project for distribution.",
    {
      scheme: z.string().describe("The scheme to archive. Must be one of the schemes available in the project."),
      configuration: z.string().describe("Build configuration to use (e.g., 'Debug' or 'Release')."),
      archivePath: z.string().describe("Path where the .xcarchive file will be saved."),
      destination: z.string().optional().describe("Optional destination specifier (e.g., 'generic/platform=iOS'). If not provided, uses the default destination for the scheme."),
      exportOptionsPlist: z.string().optional().describe("Optional path to an export options property list file for subsequent export operations.")
    },
    async ({ scheme, configuration, archivePath, destination, exportOptionsPlist }) => {
      if (!server.activeProject) {
        throw new ProjectNotFoundError();
      }

      try {
        const workingDir = server.directoryState.getActiveDirectory();

        // Validate and resolve the archive path
        const resolvedArchivePath = server.pathManager.normalizePath(archivePath);
        server.pathManager.validatePathForWriting(resolvedArchivePath);

        // Get project info to validate scheme and configuration
        let projectInfo;
        if (server.activeProject.isWorkspace) {
          projectInfo = await getWorkspaceInfo(server.activeProject.path);
        } else {
          projectInfo = await getProjectInfo(server.activeProject.path);
        }

        // Validate scheme and configuration
        if (!projectInfo.schemes.includes(scheme)) {
          throw new XcodeServerError(`Invalid scheme "${scheme}". Available schemes: ${projectInfo.schemes.join(", ")}`);
        }

        if (!projectInfo.configurations.includes(configuration)) {
          throw new XcodeServerError(`Invalid configuration "${configuration}". Available configurations: ${projectInfo.configurations.join(", ")}`);
        }

        const projectPath = server.activeProject.path;
        const args = [
          ...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false),
          "-scheme", scheme,
          "-configuration", configuration,
        ];
        if (destination) args.push("-destination", destination);
        args.push("-archivePath", resolvedArchivePath, "archive");

        const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

        // Check if export options plist is provided for follow-up instructions
        let followUpInstructions = "";
        if (exportOptionsPlist) {
          const resolvedExportOptionsPath = server.pathManager.normalizePath(exportOptionsPlist);
          server.pathManager.validatePathForReading(resolvedExportOptionsPath);

          followUpInstructions = `\n\nTo export the archive for distribution, you can use:\n` +
            `xcodebuild -exportArchive -archivePath "${resolvedArchivePath}" -exportOptionsPlist "${resolvedExportOptionsPath}" -exportPath <export_directory>`;
        }

        return {
          content: [{
            type: "text",
            text: `Archive completed successfully at ${resolvedArchivePath}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}${followUpInstructions}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("scheme not found")) {
            throw new XcodeServerError("The specified scheme was not found in the project. Use list_available_schemes to see available schemes.");
          }

          if (errorMsg.includes("does not contain a scheme")) {
            throw new XcodeServerError("The project does not contain any schemes. Make sure the project is properly configured.");
          }

          if (errorMsg.includes("No signing certificate")) {
            throw new XcodeServerError("No signing certificate found. Make sure your project is properly configured for code signing.");
          }

          if (errorMsg.includes("requires a provisioning profile")) {
            throw new XcodeServerError("Missing provisioning profile. Make sure your project is properly configured with a valid provisioning profile.");
          }
        }

        throw new CommandExecutionError(
          'xcodebuild archive',
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
    const { stdout: simulatorList } = await runExecFile("xcrun", ["simctl", "list", "--json"]);
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

    // Check if the file exists
    try {
      await fs.access(filePath);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new XcodeServerError(`Path is not a file: ${filePath}`);
      }
    } catch (error) {
      if (error instanceof XcodeServerError) throw error;
      throw new XcodeServerError(`File not found: ${filePath}`);
    }

    // Get project info to find available schemes
    let info;
    try {
      if (server.activeProject.isWorkspace) {
        info = await getWorkspaceInfo(server.activeProject.path);
      } else {
        info = await getProjectInfo(server.activeProject.path);
      }
    } catch (error) {
      throw new XcodeServerError(`Failed to get project information: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!info.schemes || info.schemes.length === 0) {
      throw new XcodeServerError("No schemes found in the project. Please create a scheme first.");
    }

    // Use provided scheme or first available scheme
    const scheme = options.scheme || info.schemes[0];

    // Validate the scheme exists
    if (options.scheme && !info.schemes.includes(options.scheme)) {
      throw new XcodeServerError(`Scheme '${options.scheme}' not found. Available schemes: ${info.schemes.join(', ')}`);
    }

    const projectPath = server.activeProject.path;
    const workingDir = server.directoryState.getActiveDirectory();
    const relativeFilePath = path.relative(workingDir, filePath);
    if (relativeFilePath.startsWith("..")) {
      throw new XcodeServerError(`File is outside the project directory: ${filePath}`);
    }

    const args = [
      ...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false),
      "-scheme", scheme,
    ];
    if (options.sdk) {
      args.push("-sdk", options.sdk);
    } else {
      const simulator = await findBestAvailableSimulator();
      if (!simulator) {
        throw new XcodeServerError("No available iOS simulators found. Please install at least one iOS simulator or specify an SDK.");
      }
      args.push("-destination", `platform=iOS Simulator,id=${simulator.udid}`);
    }
    args.push("analyze", "-quiet", "-analyzer-output", "html", relativeFilePath);

    try {
      const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

      // Check for common warning patterns
      let formattedOutput = `Analysis of ${path.basename(filePath)} completed.\n\n`;

      // Extract warnings and errors
      const warningMatches = stdout.match(/warning: ([^\n]+)/g) || [];
      const errorMatches = stdout.match(/error: ([^\n]+)/g) || [];

      if (warningMatches.length > 0 || errorMatches.length > 0) {
        formattedOutput += `Found ${warningMatches.length} warning(s) and ${errorMatches.length} error(s):\n\n`;

        if (errorMatches.length > 0) {
          formattedOutput += "Errors:\n";
          errorMatches.forEach(error => {
            formattedOutput += `- ${error.replace('error: ', '')}\n`;
          });
          formattedOutput += "\n";
        }

        if (warningMatches.length > 0) {
          formattedOutput += "Warnings:\n";
          warningMatches.forEach(warning => {
            formattedOutput += `- ${warning.replace('warning: ', '')}\n`;
          });
          formattedOutput += "\n";
        }
      } else {
        formattedOutput += "No issues found.\n\n";
      }

      formattedOutput += `Full analysis output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`;

      return {
        content: [{
          type: "text",
          text: formattedOutput
        }]
      };
    } catch (error) {
      let stderr = '';
      if (error instanceof Error && 'stderr' in error) {
        stderr = (error as any).stderr;
      }

      // Check for specific error patterns
      if (stderr) {
        if (stderr.includes("does not contain a scheme")) {
          throw new XcodeServerError("The project does not contain any schemes. Please create a scheme first.");
        }

        if (stderr.includes("scheme not found")) {
          throw new XcodeServerError(`Scheme '${scheme}' not found. Use list_available_schemes to see available schemes.`);
        }

        if (stderr.includes("No such file or directory")) {
          throw new XcodeServerError(`File not found in the project: ${filePath}`);
        }

        if (stderr.includes("is not a member of a target")) {
          throw new XcodeServerError(`File is not part of any target in the project: ${filePath}. Add it to a target first.`);
        }
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

  let sanitizedDerivedDataPath: string | undefined;
  if (options.derivedDataPath) {
    const resolvedPath = server.pathManager.normalizePath(options.derivedDataPath);
    server.pathManager.validatePathForWriting(resolvedPath);
    sanitizedDerivedDataPath = resolvedPath;
  }

  try {
    // Different command for workspace vs project vs SPM
    if (server.activeProject.isSPMProject) {
      try {
        // Use the active directory from ProjectDirectoryState for the working directory
        const workingDir = server.directoryState.getActiveDirectory();

        const swiftArgs = ["build"];
        if (configuration.toLowerCase() === "release") swiftArgs.push("--configuration", "release");
        if (options.jobs) swiftArgs.push("--jobs", String(options.jobs));
        const { stdout, stderr } = await runExecFile("swift", swiftArgs, { cwd: workingDir });
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

    const workingDir = server.directoryState.getActiveDirectory();
    const args = [
      ...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false),
      "-scheme", scheme,
      "-configuration", configuration,
    ];
    if (options.destination) args.push("-destination", options.destination);
    else if (options.sdk) args.push("-sdk", options.sdk);
    else {
      const simulator = await findBestAvailableSimulator();
      if (simulator) args.push("-destination", `platform=iOS Simulator,id=${simulator.udid}`);
    }
    if (options.jobs) args.push("-jobs", String(options.jobs));
    if (sanitizedDerivedDataPath) args.push("-derivedDataPath", sanitizedDerivedDataPath);
    args.push("build", "-quiet");

    try {
      const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

      // Check for known error patterns
      if (stderr && (
        stderr.includes("xcodebuild: error:") ||
        stderr.includes("** BUILD FAILED **")
      )) {
        // Try to extract more specific error information
        let errorMessage = stderr;

        // Look for common error patterns and provide more helpful messages
        if (stderr.includes("No profile for team") || stderr.includes("No provisioning profile")) {
          errorMessage = "Build failed due to code signing issues. Please check your provisioning profiles and team settings.\n\n" + stderr;
        } else if (stderr.includes("linker command failed")) {
          errorMessage = "Build failed due to linker errors. This is often caused by missing frameworks or libraries.\n\n" + stderr;
        } else if (stderr.includes("No such module")) {
          errorMessage = "Build failed because a module could not be found. Make sure all dependencies are properly installed.\n\n" + stderr;
        } else if (stderr.includes("Use Legacy Build System")) {
          errorMessage = "Build failed with new build system. You may need to use the legacy build system.\n\n" + stderr;
        } else if (stderr.includes("Command CompileSwift failed")) {
          errorMessage = "Swift compilation failed. Check for syntax errors or type mismatches in your Swift code.\n\n" + stderr;
        } else if (stderr.includes("Command CompileC failed")) {
          errorMessage = "Objective-C compilation failed. Check for syntax errors in your Objective-C code.\n\n" + stderr;
        }

        throw new CommandExecutionError(
          `xcodebuild for ${scheme} (${configuration})`,
          errorMessage
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

    let sanitizedResultBundlePath: string | undefined;
    if (options.resultBundlePath) {
      const resolvedPath = server.pathManager.normalizePath(options.resultBundlePath);
      server.pathManager.validatePathForWriting(resolvedPath);
      sanitizedResultBundlePath = resolvedPath;
    }

    const projectPath = server.activeProject.path;
    let schemeToUse: string;
    if (options.scheme) {
      schemeToUse = options.scheme;
    } else {
      const info = server.activeProject.isWorkspace
        ? await getWorkspaceInfo(server.activeProject.path)
        : await getProjectInfo(server.activeProject.path);
      if (info.schemes && info.schemes.length > 0) {
        schemeToUse = info.schemes[0];
      } else {
        throw new XcodeServerError("No schemes found in the project. Please specify a scheme for testing.");
      }
    }

    const args = [
      ...xcodeBuildArgs(projectPath, server.activeProject.isWorkspace ?? false),
      "-scheme", schemeToUse,
    ];
    if (options.destination) args.push("-destination", options.destination);
    else {
      const simulator = await findBestAvailableSimulator();
      if (simulator) args.push("-destination", `platform=iOS Simulator,id=${simulator.udid}`);
    }
    if (options.testPlan) args.push("-testPlan", options.testPlan);
    if (options.onlyTesting?.length) {
      for (const t of options.onlyTesting) args.push("-only-testing:" + t);
    }
    if (options.skipTesting?.length) {
      for (const t of options.skipTesting) args.push("-skip-testing:" + t);
    }
    if (sanitizedResultBundlePath) args.push("-resultBundlePath", sanitizedResultBundlePath);
    if (options.enableCodeCoverage === true) args.push("-enableCodeCoverage", "YES");
    args.push("test");

    try {
      const { stdout, stderr } = await runExecFile("xcodebuild", args, { cwd: workingDir });

      // Check for test failures
      const hasFailures = stdout.includes("** TEST FAILED **") || stderr.includes("** TEST FAILED **");

      // Parse and structure the test results better
      let formattedOutput = `Test ${hasFailures ? 'FAILED' : 'PASSED'}\n\n`;

      // Extract test statistics
      const totalTestsMatch = stdout.match(/Test Suite.*?executed (\d+) tests/s);
      const failedTestsMatch = stdout.match(/with (\d+) failure/s);

      if (totalTestsMatch || failedTestsMatch) {
        const totalTests = totalTestsMatch ? totalTestsMatch[1] : "unknown";
        const failedTests = failedTestsMatch ? failedTestsMatch[1] : "0";
        formattedOutput += `Test Statistics: ${totalTests} tests executed, ${failedTests} failures\n\n`;
      }

      // Extract failed test cases for easier debugging
      if (hasFailures) {
        formattedOutput += "Failed Tests:\n";

        // Look for test failure patterns
        const failurePattern = /Test Case '([^']+)' failed \((\d+\.\d+) seconds\)/g;
        let match;
        let failedTestsFound = false;

        while ((match = failurePattern.exec(stdout)) !== null) {
          failedTestsFound = true;
          const [, testName, duration] = match;
          formattedOutput += `- ${testName} (${duration}s)\n`;

          // Try to extract the failure reason
          const failureIndex = stdout.indexOf(match[0]);
          if (failureIndex !== -1) {
            const nextChunk = stdout.substring(failureIndex + match[0].length, failureIndex + match[0].length + 500);
            const errorLines = nextChunk.split('\n').filter(line =>
              line.includes('error:') || line.includes('failed:') || line.includes('XCTAssert')
            ).slice(0, 3);

            if (errorLines.length > 0) {
              formattedOutput += `  Reason: ${errorLines.join('\n           ')}\n`;
            }
          }
        }

        if (!failedTestsFound) {
          formattedOutput += "  Could not parse specific test failures.\n";
        }

        formattedOutput += "\n";
      }

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

        // Extract test statistics
        const totalTestsMatch = stderr.match(/Test Suite.*?executed (\d+) tests/s);
        const failedTestsMatch = stderr.match(/with (\d+) failure/s);

        if (totalTestsMatch || failedTestsMatch) {
          const totalTests = totalTestsMatch ? totalTestsMatch[1] : "unknown";
          const failedTests = failedTestsMatch ? failedTestsMatch[1] : "0";
          formattedOutput += `Test Statistics: ${totalTests} tests executed, ${failedTests} failures\n\n`;
        }

        // Extract failed test cases for easier debugging
        formattedOutput += "Failed Tests:\n";

        // Look for test failure patterns
        const failurePattern = /Test Case '([^']+)' failed \((\d+\.\d+) seconds\)/g;
        let match;
        let failedTestsFound = false;

        while ((match = failurePattern.exec(stderr)) !== null) {
          failedTestsFound = true;
          const [, testName, duration] = match;
          formattedOutput += `- ${testName} (${duration}s)\n`;

          // Try to extract the failure reason
          const failureIndex = stderr.indexOf(match[0]);
          if (failureIndex !== -1) {
            const nextChunk = stderr.substring(failureIndex + match[0].length, failureIndex + match[0].length + 500);
            const errorLines = nextChunk.split('\n').filter(line =>
              line.includes('error:') || line.includes('failed:') || line.includes('XCTAssert')
            ).slice(0, 3);

            if (errorLines.length > 0) {
              formattedOutput += `  Reason: ${errorLines.join('\n           ')}\n`;
            }
          }
        }

        if (!failedTestsFound) {
          formattedOutput += "  Could not parse specific test failures.\n";
        }

        formattedOutput += "\n";

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