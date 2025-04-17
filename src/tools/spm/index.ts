import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, XcodeServerError, CommandExecutionError, PathAccessError, FileOperationError } from "../../utils/errors.js";

const execAsync = promisify(exec);

/**
 * Helper function to escape special characters in a string for use in a regular expression
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Interface for parsed Package.swift dependencies
 */
interface PackageDependency {
  name: string;
  url: string;
  requirement: string;
}

/**
 * Interface for parsed Package.resolved dependencies
 */
interface ResolvedDependency {
  name: string;
  url: string;
  version: string;
  state: string;
}

/**
 * Check if a directory contains a Package.swift file
 */
async function hasPackageSwift(directory: string): Promise<boolean> {
  try {
    await fs.access(path.join(directory, "Package.swift"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract dependencies from Package.swift file (enhanced parsing)
 */
async function extractDependenciesFromPackageSwift(packagePath: string): Promise<PackageDependency[]> {
  try {
    const content = await fs.readFile(packagePath, 'utf-8');
    const dependencies: PackageDependency[] = [];

    // Match dependency declarations in various formats:
    // 1. .package(url: "...", from: "...")
    // 2. .package(url: "...", .upToNextMajor(from: "..."))
    // 3. .package(url: "...", .upToNextMinor(from: "..."))
    // 4. .package(url: "...", .exact("..."))
    // 5. .package(url: "...", branch: "...")
    // 6. .package(url: "...", revision: "...")
    // 7. .package(path: "...")
    // 8. .package("...", from: "...")

    // First pattern: .package(url: "...", from: "...") and similar
    const urlPattern = /\.package\((?:url|path):\s*"([^"]+)"(?:,\s*(?:from|branch|exact|revision):\s*"([^"]+)")?\)/g;
    let match;

    while ((match = urlPattern.exec(content)) !== null) {
      const url = match[1];
      const requirement = match[2] || "latest";

      // Extract name from URL (last path component without .git extension)
      const urlPath = url.endsWith('.git') ? url.slice(0, -4) : url;
      const name = urlPath.split('/').pop() || '';

      dependencies.push({ name, url, requirement });
    }

    // Second pattern: .package(url: "...", .upToNextMajor(from: "..."))
    const versionRangePattern = /\.package\((?:url):\s*"([^"]+)"\s*,\s*\.(?:upToNextMajor|upToNextMinor)\(from:\s*"([^"]+)"\)\)/g;

    while ((match = versionRangePattern.exec(content)) !== null) {
      const url = match[1];
      const requirement = match[2] ? `from: ${match[2]}` : "latest";

      // Extract name from URL
      const urlPath = url.endsWith('.git') ? url.slice(0, -4) : url;
      const name = urlPath.split('/').pop() || '';

      dependencies.push({ name, url, requirement });
    }

    // Third pattern: .package(url: "...", .exact("..."))
    const exactPattern = /\.package\((?:url):\s*"([^"]+)"\s*,\s*\.exact\("([^"]+)"\)\)/g;

    while ((match = exactPattern.exec(content)) !== null) {
      const url = match[1];
      const requirement = match[2] ? `exact: ${match[2]}` : "latest";

      // Extract name from URL
      const urlPath = url.endsWith('.git') ? url.slice(0, -4) : url;
      const name = urlPath.split('/').pop() || '';

      dependencies.push({ name, url, requirement });
    }

    // Fourth pattern: .package("...", from: "...")
    const shorthandPattern = /\.package\("([^"]+)"\s*,\s*(?:from|branch|exact|revision):\s*"([^"]+)"\)/g;

    while ((match = shorthandPattern.exec(content)) !== null) {
      const url = match[1];
      const requirement = match[2] || "latest";

      // Extract name from URL
      const urlPath = url.endsWith('.git') ? url.slice(0, -4) : url;
      const name = urlPath.split('/').pop() || '';

      dependencies.push({ name, url, requirement });
    }

    return dependencies;
  } catch (error) {
    console.error("Error parsing Package.swift:", error);
    return [];
  }
}

/**
 * Parse Package.resolved file to get resolved dependencies information
 */
async function parsePackageResolved(resolvedPath: string): Promise<ResolvedDependency[]> {
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const json = JSON.parse(content);

    // Handle both v1 and v2 format of Package.resolved
    if (json.object && json.object.pins) {
      // v1 format
      return json.object.pins.map((pin: any) => ({
        name: pin.package || pin.repositoryURL.split('/').pop()?.replace('.git', '') || '',
        url: pin.repositoryURL,
        version: pin.state.version || pin.state.branch || pin.state.revision || 'unknown',
        state: pin.state.version ? 'version' : pin.state.branch ? 'branch' : pin.state.revision ? 'revision' : 'unknown'
      }));
    } else if (json.pins) {
      // v2 format
      return json.pins.map((pin: any) => ({
        name: pin.identity || pin.location.split('/').pop()?.replace('.git', '') || '',
        url: pin.location,
        version: pin.state.version || pin.state.branch || pin.state.revision || 'unknown',
        state: pin.state.version ? 'version' : pin.state.branch ? 'branch' : pin.state.revision ? 'revision' : 'unknown'
      }));
    }

    return [];
  } catch (error) {
    console.error("Error parsing Package.resolved:", error);
    return [];
  }
}

/**
 * Register Swift Package Manager related tools
 */
export function registerSPMTools(server: XcodeServer) {
  // Register "init_swift_package"
  server.server.tool(
    "init_swift_package",
    "Initializes a new Swift Package Manager project in the current directory. Use this tool first if your project doesn't have a Package.swift file yet and you want to start using Swift packages.",
    {
      type: z.enum(['library', 'executable', 'tool', 'build-tool-plugin', 'command-plugin', 'macro', 'empty']).optional().describe("Type of package to create (library, executable, tool, build-tool-plugin, command-plugin, macro, or empty)"),
      name: z.string().optional().describe("Name for the package (defaults to directory name)"),
      enableTests: z.boolean().optional().describe("Enable test targets (default: true)"),
      testingFramework: z.enum(['xctest', 'swift-testing']).optional().describe("Testing framework to use (xctest or swift-testing)")
    },
    async ({ type = 'library', name, enableTests = true, testingFramework = 'xctest' }) => {
      try {
        // Use the active directory from the ProjectDirectoryState
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate the directory is within allowed boundaries
        server.pathManager.validatePathForWriting(activeDirectory);

        let packageDirectory = activeDirectory;

        // If a name is provided, create a subdirectory for the package
        if (name) {
          packageDirectory = path.join(activeDirectory, name);
          // Validate the path is allowed
          server.pathManager.validatePathForWriting(packageDirectory);

          // Create the directory if it doesn't exist
          try {
            await fs.mkdir(packageDirectory, { recursive: true });
          } catch (error: unknown) {
            throw new FileOperationError(`Failed to create directory for package: ${name}`, String(error));
          }
        }

        const packagePath = path.join(packageDirectory, "Package.swift");

        try {
          // Check if Package.swift already exists
          await fs.access(packagePath);
          throw new XcodeServerError(`Package.swift already exists in directory: ${packageDirectory}`);
        } catch (error) {
          // Package.swift doesn't exist, which is what we want
          if (!(error instanceof XcodeServerError)) {
            try {
              const typeArg = `--type ${type}`;
              const nameArg = name ? `--name ${name}` : '';

              // Set up testing arguments based on preferences
              let testingArgs = '';
              if (!enableTests) {
                testingArgs = '--disable-xctest --disable-swift-testing';
              } else if (testingFramework === 'swift-testing') {
                testingArgs = '--disable-xctest --enable-swift-testing';
              } else {
                testingArgs = '--enable-xctest --disable-swift-testing';
              }

              // Use absolute paths and proper directory
              const cmd = `cd "${packageDirectory}" && swift package init ${typeArg} ${nameArg} ${testingArgs}`.trim();

              const { stdout, stderr } = await execAsync(cmd);

              // If we have an active project, update its info to reflect it's now an SPM project
              if (server.activeProject) {
                server.activeProject.isSPMProject = true;
                server.activeProject.packageManifestPath = packagePath;

                // Update the path manager with the new SPM project
                server.pathManager.setActiveProject(packagePath);
              }

              return {
                content: [{
                  type: "text",
                  text: `Initialized new Swift package in ${packageDirectory}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
                }]
              };
            } catch (error) {
              let stderr = '';
              if (error instanceof Error && 'stderr' in error) {
                stderr = (error as any).stderr;
              }
              throw new CommandExecutionError(
                'swift package init',
                stderr || (error instanceof Error ? error.message : String(error))
              );
            }
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "add_swift_package"
  server.server.tool(
    "add_swift_package",
    "Adds a Swift Package dependency to the active project. Note: Your project must already be set up for Swift Package Manager (must have a Package.swift file). If you haven't initialized SPM yet, use the init_swift_package tool first.",
    {
      url: z.string().describe("The URL of the Swift package to add"),
      version: z.string().optional().describe("Version requirement (e.g., 'exact: 1.0.0', 'from: 1.0.0', 'branch: main')"),
      productName: z.string().optional().describe("Specific product name to add from the package"),
      skipUpdate: z.boolean().optional().describe("Skip running 'package update' after adding the dependency")
    },
    async ({ url, version, productName, skipUpdate = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForWriting(activeDirectory);

        // Look for Package.swift in the active directory
        const packagePath = path.join(activeDirectory, "Package.swift");

        try {
          // Check if Package.swift exists
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError(
            "No Package.swift found in the active directory. " +
            "To initialize a new Swift Package Manager project, use the init_swift_package tool first."
          );
        }

        try {
          let dependencyArg = `"${url}"`;

          // Handle version requirements
          if (version) {
            if (version.startsWith('exact:')) {
              dependencyArg += ` --exact ${version.split(':')[1].trim()}`;
            } else if (version.startsWith('from:')) {
              dependencyArg += ` --from ${version.split(':')[1].trim()}`;
            } else if (version.startsWith('branch:')) {
              dependencyArg += ` --branch ${version.split(':')[1].trim()}`;
            } else if (version.startsWith('revision:')) {
              dependencyArg += ` --revision ${version.split(':')[1].trim()}`;
            } else {
              // Assume it's a "from:" version if not specified
              dependencyArg += ` --from ${version}`;
            }
          }

          const productArg = productName ? ` --product ${productName}` : '';
          const cmd = `cd "${activeDirectory}" && swift package add-dependency ${dependencyArg}${productArg}`;

          const { stdout, stderr } = await execAsync(cmd);

          // After adding dependency, run package update unless skipped
          let updateOutput = '';
          if (!skipUpdate) {
            try {
              const { stdout: updateStdout, stderr: updateStderr } = await execAsync('swift package update', { cwd: activeDirectory });
              updateOutput = `\n\nDependencies updated:\n${updateStdout}${updateStderr ? '\nUpdate errors:\n' + updateStderr : ''}`;
            } catch (updateError) {
              updateOutput = `\n\nFailed to update dependencies: ${updateError instanceof Error ? updateError.message : String(updateError)}`;
            }
          }

          return {
            content: [{
              type: "text",
              text: `Added package dependency:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}${updateOutput}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Check for specific error patterns and provide helpful messages
          if (stderr) {
            if (stderr.includes("not found in the workspace")) {
              throw new Error("Package URL not found or is invalid. Please check the URL and try again.");
            }
            if (stderr.includes("already exists")) {
              throw new Error("This package is already added to your project. If you want to update it, use the update_swift_package tool.");
            }
          }

          throw new CommandExecutionError(
            'swift package add-dependency',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "remove_swift_package"
  server.server.tool(
    "remove_swift_package",
    "Removes a Swift Package dependency from the active project.",
    {
      url: z.string().describe("The URL of the Swift package to remove"),
      confirm: z.boolean().describe("Confirmation to remove the package. Must be set to true.")
    },
    async ({ url, confirm }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Require explicit confirmation
        if (!confirm) {
          throw new Error("You must set confirm=true to remove a package dependency. This will modify your Package.swift file.");
        }

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForWriting(activeDirectory);

        // Look for Package.swift in the active directory
        const packagePath = path.join(activeDirectory, "Package.swift");

        try {
          // Check if Package.swift exists
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError(
            "No Package.swift found in the active directory. This project doesn't use Swift Package Manager."
          );
        }

        try {
          // First, check if the package is actually in the dependencies
          const dependencies = await extractDependenciesFromPackageSwift(packagePath);
          const foundDependency = dependencies.find(dep => dep.url === url);

          if (!foundDependency) {
            throw new Error(`Package with URL "${url}" not found in the project dependencies.`);
          }

          // Read the Package.swift file
          const packageContent = await fs.readFile(packagePath, 'utf-8');

          // Create a backup of the Package.swift file
          const backupPath = path.join(activeDirectory, "Package.swift.backup");
          await fs.writeFile(backupPath, packageContent, 'utf-8');

          // Find and remove the dependency line
          let updatedContent = packageContent;

          // Look for different patterns of the dependency declaration
          const patterns = [
            new RegExp(`\.package\(url:\s*"${escapeRegExp(url)}"[^\)]*\)`, 'g'),
            new RegExp(`\.package\("${escapeRegExp(url)}"[^\)]*\)`, 'g')
          ];

          let found = false;
          for (const pattern of patterns) {
            if (pattern.test(updatedContent)) {
              updatedContent = updatedContent.replace(pattern, '');
              found = true;
              break;
            }
          }

          if (!found) {
            throw new Error(`Could not locate the dependency declaration for "${url}" in Package.swift. ` +
                          "You may need to remove it manually.");
          }

          // Clean up any empty dependency arrays
          updatedContent = updatedContent.replace(/dependencies:\s*\[\s*\]/g, 'dependencies: []');

          // Write the updated content back to Package.swift
          await fs.writeFile(packagePath, updatedContent, 'utf-8');

          // Run package update to clean up
          let updateOutput = '';
          try {
            const { stdout: updateStdout, stderr: updateStderr } = await execAsync('swift package update', { cwd: activeDirectory });
            updateOutput = `\n\nDependencies updated:\n${updateStdout}${updateStderr ? '\nUpdate errors:\n' + updateStderr : ''}`;
          } catch (updateError) {
            updateOutput = `\n\nFailed to update dependencies after removal: ${updateError instanceof Error ? updateError.message : String(updateError)}`;
          }

          return {
            content: [{
              type: "text",
              text: `Successfully removed package dependency: ${foundDependency.name} (${url})\n` +
                    `A backup of your Package.swift file was created at: ${backupPath}${updateOutput}`
            }]
          };
        } catch (error) {
          let errorMessage = error instanceof Error ? error.message : String(error);

          // If this is our own error, just pass it through
          if (error instanceof Error && !(error instanceof CommandExecutionError)) {
            throw error;
          }

          throw new Error(`Failed to remove package dependency: ${errorMessage}`);
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "edit_package_swift"
  server.server.tool(
    "edit_package_swift",
    "Directly edit the Package.swift file of the active SPM project. This is useful for making changes that aren't supported by the other SPM tools.",
    {
      content: z.string().describe("The new content for the Package.swift file"),
      packagePath: z.string().optional().describe("Optional path to the Package.swift file. If not provided, uses the active project's Package.swift."),
      createBackup: z.boolean().optional().describe("Whether to create a backup of the original file (default: true)")
    },
    async ({ content, packagePath, createBackup = true }) => {
      try {
        // Determine which Package.swift to use
        let resolvedPackagePath: string;

        if (packagePath) {
          // Use the provided package path
          const expandedPackagePath = server.pathManager.expandPath(packagePath);
          resolvedPackagePath = server.directoryState.resolvePath(expandedPackagePath);
          server.pathManager.validatePathForWriting(resolvedPackagePath);
        } else if (server.activeProject && server.activeProject.isSPMProject) {
          // Use the active project's Package.swift
          if (server.activeProject.packageManifestPath) {
            resolvedPackagePath = server.activeProject.packageManifestPath;
          } else {
            // Try to find Package.swift in the project directory
            const projectDir = path.dirname(server.activeProject.path);
            resolvedPackagePath = path.join(projectDir, "Package.swift");
          }
        } else {
          throw new Error("No active SPM project set. Please provide a package path or set an active SPM project first.");
        }

        // Validate the package path
        server.pathManager.validatePathForWriting(resolvedPackagePath);

        // Check if the Package.swift exists
        try {
          await fs.access(resolvedPackagePath);
        } catch {
          throw new Error(`Package.swift not found at: ${resolvedPackagePath}`);
        }

        // Create a backup if requested
        if (createBackup) {
          const backupPath = `${resolvedPackagePath}.backup`;
          await fs.copyFile(resolvedPackagePath, backupPath);
        }

        // Write the new content to the Package.swift file
        await fs.writeFile(resolvedPackagePath, content, 'utf-8');

        // Run swift package update to resolve dependencies
        const packageDir = path.dirname(resolvedPackagePath);
        let updateOutput = '';

        try {
          const { stdout, stderr } = await execAsync('swift package update', { cwd: packageDir });
          updateOutput = `\n\nDependencies updated:\n${stdout}${stderr ? '\nUpdate errors:\n' + stderr : ''}`;
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          updateOutput = `\n\nWarning: Failed to update dependencies: ${stderr || (error instanceof Error ? error.message : String(error))}`;
        }

        return {
          content: [{
            type: "text",
            text: `Successfully updated Package.swift at: ${resolvedPackagePath}` +
                  (createBackup ? `\nBackup created at: ${resolvedPackagePath}.backup` : '') +
                  updateOutput
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw new Error(`Failed to edit Package.swift: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "build_spm_package"
  server.server.tool(
    "build_spm_package",
    "Builds a Swift Package Manager package directly using 'swift build' instead of Xcode.",
    {
      packagePath: z.string().optional().describe("Optional path to the directory containing Package.swift. If not provided, uses the active project directory."),
      configuration: z.enum(['debug', 'release']).optional().describe("Build configuration to use (default: debug)"),
      target: z.string().optional().describe("Specific target to build. If not provided, builds all targets."),
      verbose: z.boolean().optional().describe("Whether to show verbose output (default: false)")
    },
    async ({ packagePath, configuration = 'debug', target, verbose = false }) => {
      try {
        // Determine which package directory to use
        let packageDir: string;

        if (packagePath) {
          // Use the provided package path
          const expandedPackagePath = server.pathManager.expandPath(packagePath);
          packageDir = server.directoryState.resolvePath(expandedPackagePath);
          server.pathManager.validatePathForReading(packageDir);
        } else if (server.activeProject && server.activeProject.isSPMProject) {
          // Use the active project's directory
          packageDir = path.dirname(server.activeProject.path);
        } else {
          // Use the current active directory
          packageDir = server.directoryState.getActiveDirectory();

          // Check if Package.swift exists in this directory
          const packageSwiftPath = path.join(packageDir, "Package.swift");
          try {
            await fs.access(packageSwiftPath);
          } catch {
            throw new Error(`No Package.swift found in the active directory: ${packageDir}`);
          }
        }

        // Build the command
        let cmd = `cd "${packageDir}" && swift build --configuration ${configuration}`;

        // Add target if specified
        if (target) {
          cmd += ` --target ${target}`;
        }

        // Add verbose flag if requested
        if (verbose) {
          cmd += ` --verbose`;
        }

        // Execute the command
        const { stdout, stderr } = await execAsync(cmd);

        return {
          content: [{
            type: "text",
            text: `Swift package build completed successfully:\n` +
                  `Configuration: ${configuration}\n` +
                  (target ? `Target: ${target}\n` : '') +
                  `\nOutput:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        throw new CommandExecutionError(
          'swift build',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "test_spm_package"
  server.server.tool(
    "test_spm_package",
    "Runs tests for a Swift Package Manager package directly using 'swift test' instead of Xcode.",
    {
      packagePath: z.string().optional().describe("Optional path to the directory containing Package.swift. If not provided, uses the active project directory."),
      filter: z.string().optional().describe("Filter to run a subset of tests. Format: 'TestTarget[.TestClass[.testMethod]]'."),
      parallel: z.boolean().optional().describe("Whether to run tests in parallel (default: true)"),
      verbose: z.boolean().optional().describe("Whether to show verbose output (default: false)")
    },
    async ({ packagePath, filter, parallel = true, verbose = false }) => {
      try {
        // Determine which package directory to use
        let packageDir: string;

        if (packagePath) {
          // Use the provided package path
          const expandedPackagePath = server.pathManager.expandPath(packagePath);
          packageDir = server.directoryState.resolvePath(expandedPackagePath);
          server.pathManager.validatePathForReading(packageDir);
        } else if (server.activeProject && server.activeProject.isSPMProject) {
          // Use the active project's directory
          packageDir = path.dirname(server.activeProject.path);
        } else {
          // Use the current active directory
          packageDir = server.directoryState.getActiveDirectory();

          // Check if Package.swift exists in this directory
          const packageSwiftPath = path.join(packageDir, "Package.swift");
          try {
            await fs.access(packageSwiftPath);
          } catch {
            throw new Error(`No Package.swift found in the active directory: ${packageDir}`);
          }
        }

        // Build the command
        let cmd = `cd "${packageDir}" && swift test`;

        // Add filter if specified
        if (filter) {
          cmd += ` --filter "${filter}"`;
        }

        // Add parallel flag if requested
        if (parallel) {
          cmd += ` --parallel`;
        }

        // Add verbose flag if requested
        if (verbose) {
          cmd += ` --verbose`;
        }

        // Execute the command
        const { stdout, stderr } = await execAsync(cmd);

        return {
          content: [{
            type: "text",
            text: `Swift package tests completed successfully:\n` +
                  (filter ? `Filter: ${filter}\n` : '') +
                  `\nOutput:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for test failures
        if (stderr && stderr.includes('failed')) {
          return {
            content: [{
              type: "text",
              text: `Swift package tests failed:\n${stderr}`
            }]
          };
        }

        throw new CommandExecutionError(
          'swift test',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "get_package_info"
  server.server.tool(
    "get_package_info",
    "Gets detailed information about a Swift Package Manager package.",
    {
      packagePath: z.string().optional().describe("Optional path to the directory containing Package.swift. If not provided, uses the active project directory.")
    },
    async ({ packagePath }) => {
      try {
        // Determine which package directory to use
        let packageDir: string;

        if (packagePath) {
          // Use the provided package path
          const expandedPackagePath = server.pathManager.expandPath(packagePath);
          packageDir = server.directoryState.resolvePath(expandedPackagePath);
          server.pathManager.validatePathForReading(packageDir);
        } else if (server.activeProject && server.activeProject.isSPMProject) {
          // Use the active project's directory
          packageDir = path.dirname(server.activeProject.path);
        } else {
          // Use the current active directory
          packageDir = server.directoryState.getActiveDirectory();

          // Check if Package.swift exists in this directory
          const packageSwiftPath = path.join(packageDir, "Package.swift");
          try {
            await fs.access(packageSwiftPath);
          } catch {
            throw new Error(`No Package.swift found in the active directory: ${packageDir}`);
          }
        }

        // Get the Package.swift content
        const packageSwiftPath = path.join(packageDir, "Package.swift");
        const packageSwiftContent = await fs.readFile(packageSwiftPath, 'utf-8');

        // Get the package dependencies
        const dependencies = await extractDependenciesFromPackageSwift(packageSwiftPath);

        // Check for Package.resolved
        const packageResolvedPath = path.join(packageDir, "Package.resolved");
        let resolvedDependencies: ResolvedDependency[] = [];

        try {
          await fs.access(packageResolvedPath);
          resolvedDependencies = await parsePackageResolved(packageResolvedPath);
        } catch {
          // Package.resolved doesn't exist, which is fine
        }

        // Get package targets using swift package dump-package
        let packageDump: any = {};
        try {
          const { stdout } = await execAsync(`cd "${packageDir}" && swift package dump-package`);
          packageDump = JSON.parse(stdout);
        } catch (error) {
          console.error("Error dumping package:", error);
        }

        // Get package tools version
        let toolsVersion = "unknown";
        const toolsVersionMatch = packageSwiftContent.match(/\/\/\s*swift-tools-version:\s*([\d\.]+)/);
        if (toolsVersionMatch && toolsVersionMatch[1]) {
          toolsVersion = toolsVersionMatch[1];
        }

        // Compile the package info
        const packageInfo = {
          name: packageDump.name || path.basename(packageDir),
          toolsVersion,
          packagePath: packageSwiftPath,
          dependencies,
          resolvedDependencies,
          targets: packageDump.targets || [],
          products: packageDump.products || [],
          platforms: packageDump.platforms || []
        };

        return {
          content: [{
            type: "text",
            text: `Swift Package Information:\n` +
                  `Name: ${packageInfo.name}\n` +
                  `Tools Version: ${packageInfo.toolsVersion}\n` +
                  `Package Path: ${packageInfo.packagePath}\n\n` +
                  `Dependencies (${dependencies.length}):\n` +
                  (dependencies.length > 0 ?
                    dependencies.map(dep => `- ${dep.name} (${dep.url}) @ ${dep.requirement}`).join('\n') :
                    "No dependencies") +
                  `\n\n` +
                  `Resolved Dependencies (${resolvedDependencies.length}):\n` +
                  (resolvedDependencies.length > 0 ?
                    resolvedDependencies.map(dep => `- ${dep.name} (${dep.url}) @ ${dep.version}`).join('\n') :
                    "No resolved dependencies") +
                  `\n\n` +
                  `Targets (${packageInfo.targets.length}):\n` +
                  (packageInfo.targets.length > 0 ?
                    packageInfo.targets.map((target: any) => `- ${target.name} (${target.type})`).join('\n') :
                    "No targets") +
                  `\n\n` +
                  `Products (${packageInfo.products.length}):\n` +
                  (packageInfo.products.length > 0 ?
                    packageInfo.products.map((product: any) => `- ${product.name} (${product.type})`).join('\n') :
                    "No products") +
                  `\n\n` +
                  `Platforms:\n` +
                  (packageInfo.platforms.length > 0 ?
                    packageInfo.platforms.map((platform: any) => `- ${platform.platformName} ${platform.version}`).join('\n') :
                    "No platform restrictions")
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw new Error(`Failed to get package info: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "update_swift_package"
  server.server.tool(
    "update_swift_package",
    "Updates the dependencies of your Swift project using Swift Package Manager.",
    {
      specificPackage: z.string().optional().describe("Only update this specific package (leave empty to update all)"),
      version: z.string().optional().describe("The version to resolve at (only applies when specificPackage is provided)"),
      branch: z.string().optional().describe("The branch to resolve at (only applies when specificPackage is provided)"),
      revision: z.string().optional().describe("The revision to resolve at (only applies when specificPackage is provided)")
    },
    async ({ specificPackage, version, branch, revision }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Look for Package.swift in the active directory
        const packagePath = path.join(activeDirectory, "Package.swift");

        try {
          // Check if Package.swift exists
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        try {
          let cmd: string;

          // If updating a specific package, use resolve command
          if (specificPackage) {
            cmd = `cd "${activeDirectory}" && swift package resolve`;

            if (version) {
              cmd += ` --version "${version}"`;
            }

            if (branch) {
              cmd += ` --branch "${branch}"`;
            }

            if (revision) {
              cmd += ` --revision "${revision}"`;
            }

            cmd += ` "${specificPackage}"`;
          } else {
            // Otherwise, use regular update command
            cmd = `cd "${activeDirectory}" && swift package update`;
          }

          const { stdout, stderr } = await execAsync(cmd);

          // Try to get information about current dependencies
          let dependencyInfo = '';
          try {
            const resolvedPath = path.join(activeDirectory, '.build', 'checkouts', 'Package.resolved');
            const altResolvedPath = path.join(activeDirectory, 'Package.resolved');

            // Look for Package.resolved in both locations
            let resolvedDeps: ResolvedDependency[] = [];
            try {
              resolvedDeps = await parsePackageResolved(resolvedPath);
            } catch {
              try {
                resolvedDeps = await parsePackageResolved(altResolvedPath);
              } catch {
                // If we can't parse the resolved file, just skip this part
              }
            }

            if (resolvedDeps.length > 0) {
              dependencyInfo = '\n\nResolved Dependencies:\n';
              resolvedDeps.forEach(dep => {
                dependencyInfo += `- ${dep.name}: ${dep.version} (${dep.state})\n`;
                dependencyInfo += `  URL: ${dep.url}\n`;
              });
            }
          } catch {
            // Skip dependency info if we can't parse it
          }

          return {
            content: [{
              type: "text",
              text: `Swift Package ${specificPackage ? 'Resolve' : 'Update'} Output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}${dependencyInfo}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            specificPackage ? 'swift package resolve' : 'swift package update',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "swift_package_command"
  server.server.tool(
    "swift_package_command",
    "Executes Swift Package Manager commands in the active project directory.",
    {
      command: z.string().describe("The SPM command to execute (e.g., 'build', 'test', 'clean', 'resolve')"),
      configuration: z.string().optional().describe("Build configuration ('debug' or 'release')"),
      extraArgs: z.string().optional().describe("Additional arguments to pass to the command")
    },
    async ({ command, configuration, extraArgs }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Look for Package.swift in the active directory
        const packagePath = path.join(activeDirectory, "Package.swift");

        try {
          // Check if Package.swift exists
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        const configArg = configuration ? `--configuration ${configuration}` : '';
        const extraArgsStr = extraArgs || '';

        try {
          const cmd = `cd "${activeDirectory}" && swift package ${command} ${configArg} ${extraArgsStr}`.trim();
          const { stdout, stderr } = await execAsync(cmd);
          return {
            content: [{
              type: "text",
              text: `Swift Package Manager output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            `swift package ${command}`,
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "build_swift_package"
  server.server.tool(
    "build_swift_package",
    "Builds a Swift Package using Swift Package Manager.",
    {
      configuration: z.enum(['debug', 'release']).optional().describe("Build configuration (default: debug)"),
      target: z.string().optional().describe("Build a specific target"),
      product: z.string().optional().describe("Build a specific product"),
      showBinPath: z.boolean().optional().describe("Show binary output path"),
      buildTests: z.boolean().optional().describe("Also build test targets"),
      jobs: z.number().optional().describe("Number of parallel build jobs"),
      verbose: z.boolean().optional().describe("Show verbose output")
    },
    async ({ configuration = 'debug', target, product, showBinPath = false, buildTests = false, jobs, verbose = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        // Build the command with all options
        let args = `--configuration ${configuration}`;

        if (target) {
          args += ` --target "${target}"`;
        }

        if (product) {
          args += ` --product "${product}"`;
        }

        if (showBinPath) {
          args += ` --show-bin-path`;
        }

        if (buildTests) {
          args += ` --build-tests`;
        }

        if (jobs) {
          args += ` --jobs ${jobs}`;
        }

        if (verbose) {
          args += ` --verbose`;
        }

        try {
          const { stdout, stderr } = await execAsync(`swift build ${args}`, { cwd: activeDirectory });

          // If binary path was requested, highlight it in the output
          let formattedOutput = stdout;
          if (showBinPath && stdout.trim()) {
            formattedOutput = `Binary output path: ${stdout.trim()}\n`;
          }

          return {
            content: [{
              type: "text",
              text: `Swift Build Output:\n${formattedOutput}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'swift build',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "test_swift_package"
  server.server.tool(
    "test_swift_package",
    "Tests a Swift Package using Swift Package Manager.",
    {
      configuration: z.enum(['debug', 'release']).optional().describe("Build configuration (default: debug)"),
      filter: z.string().optional().describe("Run tests matching regular expression (e.g., 'MyTests.MyTestCase/testExample')"),
      skip: z.string().optional().describe("Skip tests matching regular expression"),
      parallel: z.boolean().optional().describe("Run tests in parallel"),
      numWorkers: z.number().optional().describe("Number of parallel test workers"),
      listTests: z.boolean().optional().describe("List all available tests instead of running them"),
      codeCoverage: z.boolean().optional().describe("Enable code coverage"),
      outputPath: z.string().optional().describe("Path for XUnit test results output")
    },
    async ({ configuration = 'debug', filter, skip, parallel = false, numWorkers, listTests = false, codeCoverage = false, outputPath }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        // Build the command with all options
        let args = `--configuration ${configuration}`;

        // If list tests is requested, we use a different subcommand
        if (listTests) {
          args = `list ${args}`;
        }

        if (filter) {
          args += ` --filter "${filter}"`;
        }

        if (skip) {
          args += ` --skip "${skip}"`;
        }

        if (parallel) {
          args += ` --parallel`;

          if (numWorkers) {
            args += ` --num-workers ${numWorkers}`;
          }
        }

        if (codeCoverage) {
          args += ` --enable-code-coverage`;
        }

        if (outputPath) {
          const resolvedOutputPath = server.pathManager.normalizePath(outputPath);
          server.pathManager.validatePathForWriting(resolvedOutputPath);
          args += ` --xunit-output "${resolvedOutputPath}"`;
        }

        try {
          const { stdout, stderr } = await execAsync(`swift test ${args}`, { cwd: activeDirectory });

          return {
            content: [{
              type: "text",
              text: `Swift Test Output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Check if this is a test failure vs. a command failure
          const errorMsg = stderr || (error instanceof Error ? error.message : String(error));

          // Handle test failures with better formatting
          if (errorMsg.includes('error: terminated') || errorMsg.includes('failed in') || errorMsg.includes('failed (')) {
            // Try to extract test failure information
            let formattedOutput = "Tests failed:\n\n";

            // Extract failed test cases
            const failedTestPattern = /Test Case '([^']+)' failed \((\d+\.\d+) seconds\)/g;
            let match;
            let failedTestsFound = false;

            while ((match = failedTestPattern.exec(errorMsg)) !== null) {
              failedTestsFound = true;
              const [, testName, duration] = match;
              formattedOutput += `- ${testName} (${duration}s)\n`;

              // Try to extract the failure reason
              const failureIndex = errorMsg.indexOf(match[0]);
              if (failureIndex !== -1) {
                const nextChunk = errorMsg.substring(failureIndex + match[0].length, failureIndex + match[0].length + 500);
                const errorLines = nextChunk.split('\n').filter(line =>
                  line.includes('error:') || line.includes('failed:') || line.includes('XCTAssert')
                ).slice(0, 3);

                if (errorLines.length > 0) {
                  formattedOutput += `  Reason: ${errorLines.join('\n           ')}\n`;
                }
              }
            }

            if (!failedTestsFound) {
              formattedOutput += "Could not parse specific test failures.\n\n";
              formattedOutput += errorMsg;
            } else {
              formattedOutput += "\nFull test output:\n" + errorMsg;
            }

            return {
              content: [{
                type: "text",
                text: formattedOutput
              }]
            };
          }

          throw new CommandExecutionError(
            'swift test',
            errorMsg
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "show_swift_dependencies"
  server.server.tool(
    "show_swift_dependencies",
    "Shows the resolved dependencies of a Swift Package.",
    {
      format: z.enum(['text', 'dot', 'json', 'flatlist']).optional().describe("Output format (default: text)"),
      outputPath: z.string().optional().describe("Path to save output to a file"),
      verbose: z.boolean().optional().describe("Show verbose output")
    },
    async ({ format = 'text', outputPath, verbose = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        // Build the command
        let args = `show-dependencies --format ${format}`;

        if (verbose) {
          args += ` --verbose`;
        }

        if (outputPath) {
          const resolvedOutputPath = server.pathManager.normalizePath(outputPath);
          server.pathManager.validatePathForWriting(resolvedOutputPath);
          args += ` --output-path "${resolvedOutputPath}"`;

          // Ensure the output directory exists
          await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
        }

        try {
          const { stdout, stderr } = await execAsync(`swift package ${args}`, { cwd: activeDirectory });

          // Try to get information about the Package.swift dependencies directly
          let packageDepsInfo = '';
          if (format === 'text') {
            try {
              const deps = await extractDependenciesFromPackageSwift(packagePath);
              if (deps.length > 0) {
                packageDepsInfo = '\n\nDeclared Dependencies in Package.swift:\n';
                deps.forEach(dep => {
                  packageDepsInfo += `- ${dep.name}: ${dep.requirement}\n`;
                  packageDepsInfo += `  URL: ${dep.url}\n`;
                });
              }
            } catch {
              // Skip if we can't parse the dependencies
            }
          }

          return {
            content: [{
              type: "text",
              text: `Swift Dependencies (${format}):\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}${packageDepsInfo}${outputPath ? `\n\nOutput also saved to: ${outputPath}` : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'swift package show-dependencies',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "clean_swift_package"
  server.server.tool(
    "clean_swift_package",
    "Cleans the build artifacts of a Swift Package.",
    {
      purgeCache: z.boolean().optional().describe("Also purge the global cache"),
      reset: z.boolean().optional().describe("Reset the complete build directory")
    },
    async ({ purgeCache = false, reset = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForWriting(activeDirectory);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        let command = 'clean';
        if (reset) {
          command = 'reset';
        } else if (purgeCache) {
          command = 'purge-cache';
        }

        try {
          const { stdout, stderr } = await execAsync(`swift package ${command}`, { cwd: activeDirectory });

          return {
            content: [{
              type: "text",
              text: `Swift Package ${command}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            `swift package ${command}`,
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "dump_swift_package"
  server.server.tool(
    "dump_swift_package",
    "Dumps the Package.swift manifest as JSON.",
    {},
    async () => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        try {
          const { stdout, stderr } = await execAsync(`swift package dump-package`, { cwd: activeDirectory });

          // Try to parse and pretty print the JSON
          let formattedOutput = stdout;
          try {
            const packageData = JSON.parse(stdout);
            formattedOutput = JSON.stringify(packageData, null, 2);
          } catch {
            // If parsing fails, just use the raw output
          }

          return {
            content: [{
              type: "text",
              text: `Package Manifest:\n${formattedOutput}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'swift package dump-package',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "generate_swift_docs"
  server.server.tool(
    "generate_swift_docs",
    "Generates documentation for a Swift Package using DocC.",
    {
      outputPath: z.string().describe("Directory where the generated documentation will be saved"),
      hostingBasePath: z.string().optional().describe("Base path for hosting the documentation (e.g., '/docs')"),
      transformForStaticHosting: z.boolean().optional().describe("Transform the documentation for static hosting (default: true)"),
      openInBrowser: z.boolean().optional().describe("Open the generated documentation in a browser after generation (default: false)")
    },
    async ({ outputPath, hostingBasePath, transformForStaticHosting = true, openInBrowser = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate directory is within allowed boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Validate and resolve the output path
        const resolvedOutputPath = server.pathManager.normalizePath(outputPath);
        server.pathManager.validatePathForWriting(resolvedOutputPath);

        // Check if Package.swift exists
        const packagePath = path.join(activeDirectory, "Package.swift");
        try {
          await fs.access(packagePath);
        } catch {
          throw new XcodeServerError("No Package.swift found in the active directory. This project doesn't use Swift Package Manager.");
        }

        // Ensure the output directory exists
        await fs.mkdir(resolvedOutputPath, { recursive: true });

        try {
          // First, check if swift-docc is available
          try {
            await execAsync('which swift-docc');
          } catch {
            throw new Error(
              "swift-docc command not found. DocC is available in Swift 5.5 and later. " +
              "Make sure you have the latest version of Swift installed."
            );
          }

          // Build the command with all options
          let cmd = `cd "${activeDirectory}" && swift package --disable-sandbox generate-documentation`;

          // Add output path
          cmd += ` --output-path "${resolvedOutputPath}"`;

          // Add hosting base path if provided
          if (hostingBasePath) {
            cmd += ` --hosting-base-path "${hostingBasePath}"`;
          }

          // Add transform for static hosting if requested
          if (transformForStaticHosting) {
            cmd += ` --transform-for-static-hosting`;
          }

          const { stdout, stderr } = await execAsync(cmd);

          // Determine the index.html path for opening in browser
          const indexPath = path.join(resolvedOutputPath, 'index.html');
          let browserMessage = '';

          // Open in browser if requested
          if (openInBrowser) {
            try {
              // Check if the index.html file exists
              await fs.access(indexPath);

              // Open in browser
              const { exec } = await import('child_process');
              exec(`open "${indexPath}"`);

              browserMessage = `\n\nDocumentation opened in your default browser.`;
            } catch {
              browserMessage = `\n\nCould not open documentation in browser. Check if the file exists: ${indexPath}`;
            }
          }

          return {
            content: [{
              type: "text",
              text: `Documentation generated successfully at: ${resolvedOutputPath}\n` +
                    `You can view the documentation by opening: ${indexPath}${browserMessage}\n\n` +
                    `Generation output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Check for specific error patterns and provide helpful messages
          if (stderr) {
            if (stderr.includes("No documentation found")) {
              throw new Error(
                "No documentation comments found in the package. " +
                "Make sure you have added documentation comments using /// or /** */ syntax to your code."
              );
            }

            if (stderr.includes("Failed to build")) {
              throw new Error(
                "Failed to build the package. Make sure your package builds successfully before generating documentation.\n" +
                "Try running 'swift build' first to check for any build errors."
              );
            }
          }

          throw new CommandExecutionError(
            'swift package generate-documentation',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );
}