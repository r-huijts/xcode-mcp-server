import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, XcodeServerError, CommandExecutionError } from "../../utils/errors.js";

const execAsync = promisify(exec);

/**
 * Register Swift Package Manager related tools
 */
export function registerSPMTools(server: XcodeServer) {
  // Register "init_swift_package"
  server.server.tool(
    "init_swift_package",
    "Initializes a new Swift Package Manager project in the current directory. Use this tool first if your project doesn't have a Package.swift file yet and you want to start using Swift packages.",
    {
      type: z.enum(['library', 'executable', 'empty']).optional().describe("Type of package to create (library, executable, or empty)"),
      name: z.string().optional().describe("Name for the package (defaults to directory name)")
    },
    async ({ type, name }) => {
      // Get the project root - either from active project or base directory
      let projectRoot: string;
      if (server.activeProject) {
        projectRoot = path.dirname(server.activeProject.path);
      } else if (server.config.projectsBaseDir) {
        // Ensure we have an absolute path
        projectRoot = path.resolve(server.config.projectsBaseDir);
        
        // If a name is provided, create a subdirectory for the package
        if (name) {
          projectRoot = path.join(projectRoot, name);
          // Create the directory if it doesn't exist
          try {
            await fs.mkdir(projectRoot, { recursive: true });
          } catch (error: unknown) {
            throw new XcodeServerError(`Failed to create directory for package: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        throw new XcodeServerError(
          "No active project or base directory set. Please either:\n" +
          "1. Set an active project using set_project_path, or\n" +
          "2. Set a base directory using set_projects_base_dir"
        );
      }

      // Log the paths for debugging
      console.log('Project root:', projectRoot);
      
      const packagePath = path.join(projectRoot, "Package.swift");

      try {
        // Check if Package.swift already exists
        await fs.access(packagePath);
        throw new XcodeServerError(`Package.swift already exists in directory: ${projectRoot}`);
      } catch (error) {
        // Package.swift doesn't exist, which is what we want
        if (!(error instanceof XcodeServerError)) {
          try {
            const typeArg = type ? `--type ${type}` : '';
            const nameArg = name ? `--name ${name}` : '';
            
            // Use absolute paths and proper directory
            const cmd = `cd "${projectRoot}" && swift package init ${typeArg} ${nameArg}`.trim();
            console.log('Executing command:', cmd);
            
            const { stdout, stderr } = await execAsync(cmd);
            
            // If we have an active project, update its info to reflect it's now an SPM project
            if (server.activeProject) {
              server.activeProject.isSPMProject = true;
              server.activeProject.packageManifestPath = packagePath;
            }
            
            return {
              content: [{
                type: "text",
                text: `Initialized new Swift package in ${projectRoot}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
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
    }
  );

  // Register "add_swift_package"
  server.server.tool(
    "add_swift_package",
    "Adds a Swift Package dependency to the active project. Note: Your project must already be set up for Swift Package Manager (must have a Package.swift file). If you haven't initialized SPM yet, use the init_swift_package tool first.",
    {
      url: z.string().describe("The URL of the Swift package to add"),
      version: z.string().optional().describe("Optional version requirement (e.g., 'exact: 1.0.0', 'from: 1.0.0', 'branch: main')"),
      productName: z.string().optional().describe("Optional specific product name to add from the package")
    },
    async ({ url, version, productName }) => {
      if (!server.activeProject) throw new ProjectNotFoundError();
      
      const projectRoot = server.activeProject.path;
      const packagePath = server.activeProject.isSPMProject 
        ? path.join(projectRoot, "Package.swift")
        : path.join(projectRoot, "Package.swift");

      try {
        // Check if Package.swift exists
        await fs.access(packagePath);
      } catch {
        throw new XcodeServerError(
          "No Package.swift found in the project directory. " +
          "To initialize a new Swift Package Manager project, use the init_swift_package tool first."
        );
      }

      try {
        let dependencyArg = `"${url}"`;
        if (version) {
          if (version.startsWith('exact:')) {
            dependencyArg += ` --exact ${version.split(':')[1].trim()}`;
          } else if (version.startsWith('from:')) {
            dependencyArg += ` --from ${version.split(':')[1].trim()}`;
          } else if (version.startsWith('branch:')) {
            dependencyArg += ` --branch ${version.split(':')[1].trim()}`;
          } else {
            dependencyArg += ` ${version}`;
          }
        }

        const productArg = productName ? ` --product ${productName}` : '';
        const cmd = `cd "${projectRoot}" && swift package add-dependency ${dependencyArg}${productArg}`;
        
        const { stdout, stderr } = await execAsync(cmd);
        
        // After adding dependency, run package update
        await execAsync('swift package update', { cwd: projectRoot });
        
        return {
          content: [{
            type: "text",
            text: `Added package dependency:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'swift package add-dependency',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "update_swift_package"
  server.server.tool(
    "update_swift_package",
    "Updates the dependencies of your Swift project using Swift Package Manager.",
    {},
    async () => {
      if (!server.activeProject) throw new ProjectNotFoundError();
      
      const projectRoot = server.activeProject.path;
      const packagePath = server.activeProject.isSPMProject 
        ? path.join(projectRoot, "Package.swift")
        : path.join(projectRoot, "Package.swift");

      try {
        // Check if Package.swift exists
        await fs.access(packagePath);
      } catch {
        throw new XcodeServerError("No Package.swift found in the project directory. This project doesn't use Swift Package Manager.");
      }

      try {
        const { stdout, stderr } = await execAsync('swift package update', { cwd: projectRoot });
        return {
          content: [{
            type: "text",
            text: `Swift Package Update Output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'swift package update',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "swift_package_command"
  server.server.tool(
    "swift_package_command",
    "Executes Swift Package Manager commands in the active project directory.",
    {
      command: z.string().describe("The SPM command to execute (e.g., 'build', 'test', 'clean', 'resolve')"),
      configuration: z.string().optional().describe("Optional build configuration ('debug' or 'release')"),
      extraArgs: z.string().optional().describe("Additional arguments to pass to the command")
    },
    async ({ command, configuration, extraArgs }) => {
      if (!server.activeProject) throw new ProjectNotFoundError();
      
      if (!server.activeProject.isSPMProject) {
        throw new XcodeServerError("This command can only be used with Swift Package Manager projects.");
      }
      
      const configArg = configuration ? `--configuration ${configuration}` : '';
      const extraArgsStr = extraArgs || '';
      
      try {
        const cmd = `cd "${server.activeProject.path}" && swift package ${command} ${configArg} ${extraArgsStr}`.trim();
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
    }
  );
} 