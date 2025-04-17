import { z } from "zod";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { XcodeServer } from "../../server.js";
import { getProjectInfo } from "../../utils/project.js";
import { ProjectNotFoundError, PathAccessError, FileOperationError, CommandExecutionError } from "../../utils/errors.js";

const execAsync = promisify(exec);

/**
 * Interface for workspace document
 */
interface WorkspaceDocument {
  FileRef: string[];
  Group: WorkspaceGroup[];
}

/**
 * Interface for workspace group
 */
interface WorkspaceGroup {
  name?: string;
  FileRef?: string[];
  Group?: WorkspaceGroup[];
}

/**
 * Interface for project configuration
 */
interface ProjectConfiguration {
  configurations: string[];
  schemes: string[];
  targets: string[];
  buildSettings?: Record<string, any>;
  defaultConfiguration?: string;
  workspaceProjects?: string[]; // Projects within a workspace
}

/**
 * Check if a file or directory exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a Swift Package Manager project
 */
async function isSPMProject(directoryPath: string): Promise<boolean> {
  try {
    const packageSwiftPath = path.join(directoryPath, "Package.swift");
    return await fileExists(packageSwiftPath);
  } catch {
    return false;
  }
}

/**
 * Find Xcode projects in a directory
 */
async function findXcodeProjects(directoryPath: string, includeWorkspaces = true): Promise<string[]> {
  try {
    const results: string[] = [];
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(directoryPath, entry.name);

        if (entry.name.endsWith(".xcodeproj")) {
          results.push(fullPath);
        } else if (includeWorkspaces && entry.name.endsWith(".xcworkspace")) {
          results.push(fullPath);
        } else if (!entry.name.startsWith(".")) {
          // Recursively search subdirectories, but avoid hidden dirs
          try {
            const subResults = await findXcodeProjects(fullPath, includeWorkspaces);
            results.push(...subResults);
          } catch {
            // Ignore errors from subdirectories we can't access
          }
        }
      }
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to find Xcode projects: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a workspace document to find projects
 */
async function parseWorkspaceDocument(workspacePath: string): Promise<string[]> {
  try {
    const contentsPath = path.join(workspacePath, "contents.xcworkspacedata");
    const xmlContent = await fs.readFile(contentsPath, "utf-8");

    const projects: string[] = [];

    // Handle different location tag formats:
    // 1. Standard format: location group:="path/to/project.xcodeproj"
    // 2. Alternate format: location group="path/to/project.xcodeproj"
    // 3. Self-closing format: <FileRef location="group:path/to/project.xcodeproj"/>
    // 4. Container format: <FileRef location="container:path/to/project.xcodeproj"/>

    // Pattern 1 & 2: location group attribute
    const locationRegex = /location\s+group:?=?"([^"]+)"/g;
    let match;

    while ((match = locationRegex.exec(xmlContent)) !== null) {
      const relativePath = match[1];
      if (relativePath.endsWith(".xcodeproj")) {
        // Resolve the path relative to the workspace
        const absolutePath = path.resolve(path.dirname(workspacePath), relativePath);
        if (!projects.includes(absolutePath)) {
          projects.push(absolutePath);
        }
      }
    }

    // Pattern 3 & 4: FileRef with location attribute
    const fileRefRegex = /<FileRef\s+location="(group|container):([^"]+)"\/>/g;

    while ((match = fileRefRegex.exec(xmlContent)) !== null) {
      const relativePath = match[2];
      if (relativePath.endsWith(".xcodeproj")) {
        // Resolve the path relative to the workspace
        const absolutePath = path.resolve(path.dirname(workspacePath), relativePath);
        if (!projects.includes(absolutePath)) {
          projects.push(absolutePath);
        }
      }
    }

    // Pattern 5: Full XML format with FileRef element
    const fileRefXmlRegex = /<FileRef\s+location="(group|container):([^"]+)"\s*>[\s\S]*?<\/FileRef>/g;

    while ((match = fileRefXmlRegex.exec(xmlContent)) !== null) {
      const relativePath = match[2];
      if (relativePath.endsWith(".xcodeproj")) {
        // Resolve the path relative to the workspace
        const absolutePath = path.resolve(path.dirname(workspacePath), relativePath);
        if (!projects.includes(absolutePath)) {
          projects.push(absolutePath);
        }
      }
    }

    return projects;
  } catch (error) {
    throw new Error(`Failed to parse workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a project's configuration (schemes, targets, configurations)
 */
async function getProjectConfiguration(projectPath: string): Promise<ProjectConfiguration> {
  try {
    const result: ProjectConfiguration = {
      configurations: [],
      schemes: [],
      targets: []
    };

    // Get project schemes
    try {
      // Determine if this is a workspace or regular project
      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const flag = isWorkspace ? '-workspace' : '-project';

      const { stdout: schemesOutput } = await execAsync(`xcodebuild ${flag} "${projectPath}" -list`);

      // Parse schemes
      const schemesMatch = schemesOutput.match(/Schemes:\s+((?:.+\s*)+)/);
      if (schemesMatch && schemesMatch[1]) {
        result.schemes = schemesMatch[1].trim().split(/\s+/);
      }

      // Parse targets
      const targetsMatch = schemesOutput.match(/Targets:\s+((?:.+\s*)+)/);
      if (targetsMatch && targetsMatch[1]) {
        result.targets = targetsMatch[1].trim().split(/\s+/);
      }

      // Parse configurations
      const configsMatch = schemesOutput.match(/Build Configurations:\s+((?:.+\s*)+)/);
      if (configsMatch && configsMatch[1]) {
        result.configurations = configsMatch[1].trim().split(/\s+/);
      }

      // Get default configuration
      const defaultConfigMatch = schemesOutput.match(/If no build configuration is specified and -scheme is not passed then "([^"]+)" is used/);
      if (defaultConfigMatch && defaultConfigMatch[1]) {
        result.defaultConfiguration = defaultConfigMatch[1];
      }
    } catch (error) {
      console.warn(`Failed to get project schemes: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to get project configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Register project management tools
 */
export function registerProjectTools(server: XcodeServer) {
  // Register "set_projects_base_dir"
  server.server.tool(
    "set_projects_base_dir",
    "Sets the base directory where your Xcode projects are stored.",
    {
      baseDir: z.string().describe("Path to the directory containing your Xcode projects. Supports ~ for home directory and environment variables.")
    },
    async ({ baseDir }, _extra) => {
      try {
        // Use our PathManager to expand and validate the path
        const expandedPath = server.pathManager.expandPath(baseDir);
      const stats = await fs.stat(expandedPath);

      if (!stats.isDirectory()) {
        throw new Error("Provided baseDir is not a directory");
      }

        // Update both the server config and PathManager
      server.config.projectsBaseDir = expandedPath;
        server.pathManager.setProjectsBaseDir(expandedPath);

      await server.detectActiveProject().catch(console.error);

      return {
        content: [{
          type: "text" as const,
          text: `Projects base directory set to: ${expandedPath}`
        }]
      };
      } catch (error) {
        throw new Error(`Failed to set projects base directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "set_project_path"
  server.server.tool(
    "set_project_path",
    "Sets the active Xcode project by specifying the path to its .xcodeproj directory.",
    {
      projectPath: z.string().describe("Path to the .xcodeproj directory for the desired project. Supports ~ for home directory and environment variables."),
      setActiveDirectory: z.boolean().optional().describe("If true, also set the active directory to the project directory"),
      openInXcode: z.boolean().optional().describe("If true, also open the project in Xcode (default: false)")
    },
    async ({ projectPath, setActiveDirectory = true, openInXcode = false }, _extra) => {
      try {
        // IMPORTANT: Always expand the tilde first, before any other path operations
        const expandedPath = server.pathManager.expandPath(projectPath);

        // Then handle relative paths if needed
        const fullPath = path.isAbsolute(expandedPath)
          ? expandedPath
          : server.directoryState.resolvePath(expandedPath);

        // Now validate the path
        const validatedPath = server.pathManager.validatePathForReading(fullPath);

        // Clean up the path if it ends with project.xcworkspace
        let cleanedPath = validatedPath;
        if (cleanedPath.endsWith('/project.xcworkspace')) {
          cleanedPath = cleanedPath.replace('/project.xcworkspace', '');
        }

        // Check if the path exists
        const stats = await fs.stat(cleanedPath);

        let isWorkspace = false;
        let isSPMProject = false;
        let projectType = "standard";

        // Check project type
        if (cleanedPath.endsWith(".xcworkspace")) {
          isWorkspace = true;
          projectType = "workspace";
        } else if (cleanedPath.endsWith(".xcodeproj")) {
          // Standard Xcode project
        } else {
          // Check if it's a SPM project with Package.swift
          const packageSwiftPath = path.join(cleanedPath, "Package.swift");
          const isSPM = await fileExists(packageSwiftPath);
          if (isSPM) {
            isSPMProject = true;
            projectType = "spm";
          } else {
            throw new Error("Invalid project path; must be a .xcodeproj directory, .xcworkspace, or a directory with Package.swift");
          }
        }

        // Create the project object
        const projectObj = {
          path: cleanedPath,
          name: path.basename(cleanedPath, path.extname(cleanedPath)),
          isWorkspace,
          isSPMProject,
          type: projectType as 'standard' | 'workspace' | 'spm'
        };

        // Use our setActiveProject method which updates PathManager
        server.setActiveProject(projectObj);

        // Set active directory to project directory if requested
        if (setActiveDirectory) {
          const projectDir = path.dirname(cleanedPath);
          server.directoryState.setActiveDirectory(projectDir);
        }

        // Open the project in Xcode if requested
        let xcodeOpenStatus = "";
        if (openInXcode) {
          try {
            // Use AppleScript to tell Xcode to open the project
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsyncFn = promisify(exec);

            await execAsyncFn(`
              osascript -e '
                tell application "Xcode"
                  open "${cleanedPath}"
                  activate
                end tell
              '
            `);
            xcodeOpenStatus = " and opened in Xcode";
          } catch (openError) {
            console.error("Failed to open project in Xcode:", openError);
            xcodeOpenStatus = " (failed to open in Xcode)";
          }
        }

      return {
        content: [{
          type: "text",
            text: `Active project set to: ${cleanedPath} (${projectType})${xcodeOpenStatus}`
        }]
      };
      } catch (error) {
        console.error("Failed to set project path:", error);

        // Provide more specific error messages based on the error type
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: The specified project path is outside the allowed directories. ${error.message}`);
        } else if (error instanceof Error && error.message.includes("Invalid project path")) {
          throw new Error(`Invalid project path: The path must point to a .xcodeproj directory, .xcworkspace, or a directory with Package.swift. ` +
                         `Please check the path and try again.`);
        } else if (error instanceof Error && error.message.includes("ENOENT")) {
          throw new Error(`Project not found: The specified path does not exist. Please check the path and try again.`);
        } else {
          throw new Error(`Failed to set project path: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "get_active_project"
  server.server.tool(
    "get_active_project",
    "Retrieves detailed information about the currently active Xcode project.",
    {
      detailed: z.boolean().optional().describe("If true, include additional detailed project information")
    },
    async ({ detailed = false }) => {
      try {
      if (!server.activeProject) {
        await server.detectActiveProject();
      }

      if (!server.activeProject) {
        return {
          content: [{
            type: "text" as const,
            text: "No active Xcode project detected."
          }]
        };
      }

        // Get basic project info
        const projectInfo = await getProjectInfo(server.activeProject.path);

        // Include current active directory from ProjectDirectoryState
        const activeDirectory = server.directoryState.getActiveDirectory();

        let infoWithActiveDir: any = {
          ...server.activeProject,
          ...projectInfo,
          activeDirectory
        };

        // If detailed is requested, get additional project information
        if (detailed) {
          try {
            // Add configuration, schemes, and targets
            if (server.activeProject.isWorkspace) {
              // For workspaces, try to find the main project
              const projects = await parseWorkspaceDocument(server.activeProject.path);
              if (projects.length > 0) {
                const mainProject = projects[0]; // Use the first project as main
                infoWithActiveDir.projects = projects;
                infoWithActiveDir.mainProject = mainProject;

                // Get configurations for the main project
                const config = await getProjectConfiguration(mainProject);
                infoWithActiveDir.configurations = config.configurations;
                infoWithActiveDir.schemes = config.schemes;
                infoWithActiveDir.targets = config.targets;
                infoWithActiveDir.defaultConfiguration = config.defaultConfiguration;
              }
            } else if (server.activeProject.isSPMProject) {
              // For SPM projects, we don't have traditional Xcode schemes
              infoWithActiveDir.configurations = ["debug", "release"];
            } else {
              // For standard Xcode projects
              const config = await getProjectConfiguration(server.activeProject.path);
              infoWithActiveDir.configurations = config.configurations;
              infoWithActiveDir.schemes = config.schemes;
              infoWithActiveDir.targets = config.targets;
              infoWithActiveDir.defaultConfiguration = config.defaultConfiguration;
            }
          } catch (error) {
            console.warn(`Error getting detailed project info: ${error instanceof Error ? error.message : String(error)}`);
            infoWithActiveDir.detailedInfoError = String(error);
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(infoWithActiveDir, null, 2)
          }]
        };
      } catch (error) {
        throw new Error(`Failed to get active project: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "find_projects"
  server.server.tool(
    "find_projects",
    "Finds Xcode projects in the specified directory.",
    {
      directory: z.string().optional().describe("Directory to search in. Defaults to projects base directory."),
      includeWorkspaces: z.boolean().optional().describe("If true, include .xcworkspace files"),
      includeSPM: z.boolean().optional().describe("If true, include Swift Package Manager projects")
    },
    async ({ directory, includeWorkspaces = true, includeSPM = false }) => {
      try {
        // Use projects base dir if no directory specified
        let searchDir: string;
        if (directory) {
          // First, expand any tilde in the path
          const expandedDir = server.pathManager.expandPath(directory);
          // Then resolve relative to active directory if needed
          searchDir = server.directoryState.resolvePath(expandedDir);
        } else {
          const baseDir = server.pathManager.getProjectsBaseDir();
          if (!baseDir) {
            throw new Error("No projects base directory set");
          }
          searchDir = baseDir;
        }

        server.pathManager.validatePathForReading(searchDir);

        // Find Xcode projects
        const projects = await findXcodeProjects(searchDir, includeWorkspaces);

        // Find Swift Package Manager projects if requested
        let spmProjects: string[] = [];
        if (includeSPM) {
          try {
            // Find directories containing Package.swift
            const findCmd = `find "${searchDir}" -name "Package.swift" -type f -not -path "*/\\.*/"`;
            const { stdout: spmOutput } = await execAsync(findCmd);

            if (spmOutput.trim()) {
              spmProjects = spmOutput.trim().split('\n')
                .filter(Boolean)
                .map(packagePath => path.dirname(packagePath));
            }
          } catch (error) {
            console.warn(`Error finding SPM projects: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // Format results
        const projectInfos = await Promise.all(
          projects.map(async projectPath => {
            try {
              const isWorkspace = projectPath.endsWith(".xcworkspace");
              let containedProjects: string[] = [];

              if (isWorkspace) {
                try {
                  containedProjects = await parseWorkspaceDocument(projectPath);
                } catch {
                  // Ignore errors parsing workspace
                }
              }

              return {
                path: projectPath,
                name: path.basename(projectPath, path.extname(projectPath)),
                type: isWorkspace ? "workspace" : "xcodeproj",
                containedProjects: isWorkspace ? containedProjects : []
              };
            } catch {
              // Return minimal info if error
              return {
                path: projectPath,
                name: path.basename(projectPath, path.extname(projectPath)),
                type: projectPath.endsWith(".xcworkspace") ? "workspace" : "xcodeproj"
              };
            }
          })
        );

        // Add SPM projects if any
        const spmInfos = spmProjects.map(spmPath => ({
          path: spmPath,
          name: path.basename(spmPath),
          type: "spm"
        }));

        const allProjects = [...projectInfos, ...spmInfos];

        return {
          content: [{
            type: "text",
            text: JSON.stringify(allProjects, null, 2)
          }]
        };
      } catch (error) {
        throw new Error(`Failed to find projects: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "change_directory"
  server.server.tool(
    "change_directory",
    "Changes the active directory for relative path operations.",
    {
      directoryPath: z.string().describe("Path to the directory to set as active. Supports absolute paths, paths relative to the current active directory, and ~ for home directory.")
    },
    async ({ directoryPath }, _extra) => {
      try {
        // Expand tilde first, then resolve the path
        const expandedPath = server.pathManager.expandPath(directoryPath);
        const resolvedPath = server.directoryState.resolvePath(expandedPath);

        // Validate the path is within allowed boundaries
        server.pathManager.validatePathForReading(resolvedPath);

        // Validate the directory exists
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error("Path is not a directory");
        }

        // Set as active directory
        server.directoryState.setActiveDirectory(resolvedPath);

        return {
          content: [{
            type: "text" as const,
            text: `Active directory changed to: ${resolvedPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Failed to change directory: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "push_directory"
  server.server.tool(
    "push_directory",
    "Pushes the current directory onto a stack and changes to a new directory.",
    {
      directoryPath: z.string().describe("Path to the directory to set as active. Supports absolute paths, paths relative to the current active directory, and ~ for home directory.")
    },
    async ({ directoryPath }, _extra) => {
      try {
        // Expand tilde first, then resolve the path
        const expandedPath = server.pathManager.expandPath(directoryPath);
        const resolvedPath = server.directoryState.resolvePath(expandedPath);

        // Validate the path is within allowed boundaries
        server.pathManager.validatePathForReading(resolvedPath);

        // Validate the directory exists
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error("Path is not a directory");
        }

        // Push onto stack and change
        server.directoryState.pushDirectory(resolvedPath);

      return {
        content: [{
          type: "text" as const,
            text: `Directory stack pushed, active directory changed to: ${resolvedPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Failed to push directory: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "pop_directory"
  server.server.tool(
    "pop_directory",
    "Pops a directory from the stack and changes to it.",
    {},
    async () => {
      try {
        const previousDir = server.directoryState.popDirectory();

        if (!previousDir) {
          return {
            content: [{
              type: "text" as const,
              text: "Directory stack is empty, no directory to pop."
            }]
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Directory popped, active directory changed to: ${previousDir}`
          }]
        };
      } catch (error) {
        throw new Error(`Failed to pop directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "get_current_directory"
  server.server.tool(
    "get_current_directory",
    "Returns the current active directory.",
    {},
    async () => {
      try {
        const activeDirectory = server.directoryState.getActiveDirectory();

        return {
          content: [{
            type: "text" as const,
            text: activeDirectory
          }]
        };
      } catch (error) {
        throw new Error(`Failed to get current directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "get_project_configuration"
  server.server.tool(
    "get_project_configuration",
    "Retrieves configuration details for the active project, including schemes and targets.",
    {},
    async () => {
      try {
        if (!server.activeProject) {
          throw new ProjectNotFoundError();
        }

        const projectPath = server.activeProject.path;

        let configuration: ProjectConfiguration;

        if (server.activeProject.isWorkspace) {
          // For workspaces, try to find the main project
          const projects = await parseWorkspaceDocument(projectPath);
          if (projects.length === 0) {
            throw new Error("No projects found in workspace");
          }

          const mainProject = projects[0]; // Use the first project as main
          configuration = await getProjectConfiguration(mainProject);
          configuration.workspaceProjects = projects;
        } else if (server.activeProject.isSPMProject) {
          // For SPM projects, provide basic configuration
          configuration = {
            configurations: ["debug", "release"],
            schemes: ["all"],
            targets: ["all"],
            defaultConfiguration: "debug"
          };
        } else {
          // Standard Xcode project
          configuration = await getProjectConfiguration(projectPath);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(configuration, null, 2)
          }]
        };
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new Error("No active project set.");
        } else {
          throw new Error(`Failed to get project configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "detect_active_project"
  server.server.tool(
    "detect_active_project",
    "Attempts to automatically detect the active Xcode project.",
    {
      forceRedetect: z.boolean().optional().describe("If true, always try to detect the project even if one is already set (default: false)")
    },
    async ({ forceRedetect = false }, _extra) => {
      try {
        // If we already have an active project and aren't forcing a redetect, just return it
        if (server.activeProject && !forceRedetect) {
          const projectInfo = await getProjectInfo(server.activeProject.path);

          return {
            content: [{
              type: "text",
              text: `Using existing active project: ${server.activeProject.path}\n\n${JSON.stringify({ ...server.activeProject, ...projectInfo }, null, 2)}`
            }]
          };
        }

        // Otherwise, try to detect the active project
        await server.detectActiveProject();

        if (!server.activeProject) {
          return {
            content: [{
              type: "text",
              text: "Could not detect an active Xcode project. Please set one manually with set_project_path."
            }]
          };
        }

        const projectInfo = await getProjectInfo(server.activeProject.path);

        return {
          content: [{
            type: "text",
            text: `Detected active project: ${server.activeProject.path}\n\n${JSON.stringify({ ...server.activeProject, ...projectInfo }, null, 2)}`
          }]
        };
      } catch (error) {
        throw new Error(`Failed to detect active project: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register "add_file_to_project"
  server.server.tool(
    "add_file_to_project",
    "Adds a file to the active Xcode project.",
    {
      filePath: z.string().describe("Path to the file to add to the project"),
      targetName: z.string().optional().describe("Name of the target to add the file to. If not provided, will try to add to the first target."),
      group: z.string().optional().describe("Group path within the project to add the file to (e.g., 'MyApp/Models'). If not provided, will add to the root group."),
      createGroups: z.boolean().optional().describe("Whether to create intermediate groups if they don't exist (default: true)")
    },
    async ({ filePath, targetName, group, createGroups = true }) => {
      try {
        if (!server.activeProject) {
          throw new ProjectNotFoundError();
        }

        // Validate and resolve the file path
        const expandedFilePath = server.pathManager.expandPath(filePath);
        const resolvedFilePath = server.directoryState.resolvePath(expandedFilePath);
        server.pathManager.validatePathForReading(resolvedFilePath);

        // Check if the file exists
        try {
          const stats = await fs.stat(resolvedFilePath);
          if (!stats.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
          }
        } catch (error) {
          throw new Error(`File not found: ${filePath}`);
        }

        // Check if the active project is a workspace or a standard project
        if (server.activeProject.isWorkspace) {
          throw new Error("Adding files directly to a workspace is not supported. Please set a specific project as active.");
        }

        // Check if the active project is an SPM project
        if (server.activeProject.isSPMProject) {
          throw new Error("Adding files directly to a Swift Package Manager project is not supported. Please modify the Package.swift file instead.");
        }

        // Get the project directory
        const projectDir = path.dirname(server.activeProject.path);

        // Make the file path relative to the project directory if it's not already
        const relativeFilePath = path.isAbsolute(resolvedFilePath) && resolvedFilePath.startsWith(projectDir)
          ? path.relative(projectDir, resolvedFilePath)
          : resolvedFilePath;

        // Build the command to add the file to the project
        let cmd = `cd "${projectDir}" && xcrun swift package generate-xcodeproj`;

        // For standard Xcode projects, we need to use a different approach
        // Since there's no direct CLI for adding files to Xcode projects, we'll use a script

        // Create a temporary AppleScript file to add the file to the project
        const tempScriptPath = path.join(projectDir, "temp_add_file.scpt");

        // Build the AppleScript content
        let scriptContent = `
          tell application "Xcode"
            open "${server.activeProject.path}"
            set mainWindow to window 1

            -- Wait for the project to load
            delay 1

            -- Get the project document
            set projectDocument to document 1

            -- Add the file to the project
            tell projectDocument
              -- Add the file
              set theFile to POSIX file "${resolvedFilePath}"
        `;

        // Add target specification if provided
        if (targetName) {
          scriptContent += `
              -- Add to specific target
              set targetList to targets of projectDocument
              set foundTarget to false

              repeat with aTarget in targetList
                if name of aTarget is "${targetName}" then
                  add files theFile to aTarget
                  set foundTarget to true
                  exit repeat
                end if
              end repeat

              if not foundTarget then
                error "Target '${targetName}' not found in project"
              end if
          `;
        } else {
          scriptContent += `
              -- Add to first target
              set targetList to targets of projectDocument
              if (count of targetList) > 0 then
                add files theFile to item 1 of targetList
              end if
          `;
        }

        // Add group specification if provided
        if (group) {
          scriptContent += `
              -- Add to specific group
              set groupPath to "${group}"
              set groupComponents to my splitString(groupPath, "/")
              set currentGroup to main group of projectDocument

              repeat with groupName in groupComponents
                set foundGroup to false
                set childGroups to groups of currentGroup

                repeat with childGroup in childGroups
                  if name of childGroup is groupName then
                    set currentGroup to childGroup
                    set foundGroup to true
                    exit repeat
                  end if
                end repeat

                if not foundGroup then
                  if ${createGroups} then
                    -- Create the group if it doesn't exist
                    set currentGroup to make new group with properties {name:groupName} at end of groups of currentGroup
                  else
                    error "Group '" & groupName & "' not found in path '" & groupPath & "'"
                  end if
                end if
              end repeat

              -- Move the file to the target group
              move item 1 of files of main group of projectDocument to end of files of currentGroup
          `;
        }

        // Close the script
        scriptContent += `
              -- Save the project
              save projectDocument
            end tell
          end tell

          -- Helper function to split a string
          on splitString(theString, theDelimiter)
            set oldDelimiters to AppleScript's text item delimiters
            set AppleScript's text item delimiters to theDelimiter
            set theArray to every text item of theString
            set AppleScript's text item delimiters to oldDelimiters
            return theArray
          end splitString
        `;

        // Write the script to a temporary file
        await fs.writeFile(tempScriptPath, scriptContent, "utf-8");

        try {
          // Execute the AppleScript
          const { stdout, stderr } = await execAsync(`osascript "${tempScriptPath}"`);

          // Clean up the temporary script file
          await fs.unlink(tempScriptPath).catch(() => {});

          return {
            content: [{
              type: "text",
              text: `Successfully added file to project:\n` +
                    `File: ${resolvedFilePath}\n` +
                    `Project: ${server.activeProject.path}\n` +
                    (targetName ? `Target: ${targetName}\n` : "") +
                    (group ? `Group: ${group}\n` : "") +
                    `\n${stdout}${stderr ? '\nError output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          // Clean up the temporary script file
          await fs.unlink(tempScriptPath).catch(() => {});

          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          throw new Error(
            `Failed to add file to project: ${stderr || (error instanceof Error ? error.message : String(error))}`
          );
        }
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new Error("No active project set. Use set_project_path to set an active project first.");
        } else if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw new Error(`Failed to add file to project: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "create_xcode_project"
  server.server.tool(
    "create_xcode_project",
    "Creates a new Xcode project using a template.",
    {
      name: z.string().describe("Name of the project to create"),
      template: z.enum([
        "ios-app",
        "macos-app",
        "ios-framework",
        "macos-framework",
        "watchos-app",
        "tvos-app",
        "ios-game",
        "macos-game",
        "cross-platform-framework",
        "cross-platform-library"
      ]).describe("Template to use for the project"),
      outputDirectory: z.string().describe("Directory where the project will be created"),
      organizationName: z.string().optional().describe("Organization name to use in the project"),
      organizationIdentifier: z.string().optional().describe("Organization identifier (e.g., 'com.example') to use in the project"),
      language: z.enum(["swift", "objc"]).optional().describe("Programming language to use (default: swift)"),
      includeTests: z.boolean().optional().describe("Whether to include unit tests (default: true)"),
      includeUITests: z.boolean().optional().describe("Whether to include UI tests (default: false)"),
      setAsActive: z.boolean().optional().describe("Whether to set the new project as the active project (default: true)")
    },
    async ({
      name,
      template,
      outputDirectory,
      organizationName,
      organizationIdentifier,
      language = "swift",
      includeTests = true,
      includeUITests = false,
      setAsActive = true
    }) => {
      try {
        // Validate and resolve the output directory
        const expandedOutputDir = server.pathManager.expandPath(outputDirectory);
        const resolvedOutputDir = server.directoryState.resolvePath(expandedOutputDir);
        server.pathManager.validatePathForWriting(resolvedOutputDir);

        // Create the output directory if it doesn't exist
        await fs.mkdir(resolvedOutputDir, { recursive: true });

        // Determine the Xcode template to use
        let xcodeTemplate: string;
        let platformIdentifier: string;

        switch (template) {
          case "ios-app":
            xcodeTemplate = "Single View App";
            platformIdentifier = "com.apple.platform.iphoneos";
            break;
          case "macos-app":
            xcodeTemplate = "Cocoa App";
            platformIdentifier = "com.apple.platform.macosx";
            break;
          case "ios-framework":
            xcodeTemplate = "Framework";
            platformIdentifier = "com.apple.platform.iphoneos";
            break;
          case "macos-framework":
            xcodeTemplate = "Framework";
            platformIdentifier = "com.apple.platform.macosx";
            break;
          case "watchos-app":
            xcodeTemplate = "Watch App";
            platformIdentifier = "com.apple.platform.watchos";
            break;
          case "tvos-app":
            xcodeTemplate = "TV App";
            platformIdentifier = "com.apple.platform.appletvos";
            break;
          case "ios-game":
            xcodeTemplate = "Game";
            platformIdentifier = "com.apple.platform.iphoneos";
            break;
          case "macos-game":
            xcodeTemplate = "Game";
            platformIdentifier = "com.apple.platform.macosx";
            break;
          case "cross-platform-framework":
            xcodeTemplate = "Cross-platform Framework";
            platformIdentifier = "";
            break;
          case "cross-platform-library":
            xcodeTemplate = "Cross-platform Library";
            platformIdentifier = "";
            break;
          default:
            throw new Error(`Unsupported template: ${template}`);
        }

        // Build the command to create the project
        let cmd = `cd "${resolvedOutputDir}" && xcrun swift package init`;

        // For Swift Package Manager templates, use swift package init
        if (template === "cross-platform-framework" || template === "cross-platform-library") {
          const isLibrary = template === "cross-platform-library";
          cmd = `cd "${resolvedOutputDir}" && xcrun swift package init --${isLibrary ? 'type library' : 'type framework'}`;

          if (!includeTests) {
            cmd += " --no-tests";
          }

          // Execute the command
          const { stdout, stderr } = await execAsync(cmd);

          // Generate Xcode project from the Swift package
          const generateCmd = `cd "${resolvedOutputDir}" && xcrun swift package generate-xcodeproj`;
          const { stdout: genStdout, stderr: genStderr } = await execAsync(generateCmd);

          // Get the path to the generated .xcodeproj
          const projectPath = path.join(resolvedOutputDir, `${name}.xcodeproj`);

          // Set as active project if requested
          if (setAsActive && await fileExists(projectPath)) {
            const projectObj = {
              path: projectPath,
              name: name,
              isWorkspace: false,
              isSPMProject: true,
              type: "spm" as 'standard' | 'workspace' | 'spm'
            };

            server.setActiveProject(projectObj);
            server.directoryState.setActiveDirectory(resolvedOutputDir);
          }

          return {
            content: [{
              type: "text",
              text: `Created new Swift Package project at: ${resolvedOutputDir}\n` +
                    `Generated Xcode project: ${path.join(resolvedOutputDir, `${name}.xcodeproj`)}\n\n` +
                    `Package initialization output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}\n\n` +
                    `Xcode project generation output:\n${genStdout}\n${genStderr ? 'Error output:\n' + genStderr : ''}`
            }]
          };
        }

        // For Xcode templates, use Xcode's template system
        // Create a temporary directory for the project
        const projectDir = path.join(resolvedOutputDir, name);
        await fs.mkdir(projectDir, { recursive: true });

        // Build the Xcode project creation command
        cmd = `cd "${resolvedOutputDir}" && xcrun swift package generate-xcodeproj --output "${name}.xcodeproj"`;

        // Add organization name if provided
        const orgNameArg = organizationName ? `--organization "${organizationName}"` : "";

        // Add organization identifier if provided
        const orgIdArg = organizationIdentifier ? `--identifier "${organizationIdentifier}"` : "";

        // Add language
        const langArg = `--language ${language === "swift" ? "Swift" : "Objective-C"}`;

        // Add test options
        const testArgs = includeTests ? "" : "--no-tests";
        const uiTestArgs = includeUITests ? "--include-ui-tests" : "";

        // Execute the command
        const { stdout, stderr } = await execAsync(cmd);

        // Get the path to the generated .xcodeproj
        const projectPath = path.join(resolvedOutputDir, `${name}.xcodeproj`);

        // Set as active project if requested
        if (setAsActive && await fileExists(projectPath)) {
          const projectObj = {
            path: projectPath,
            name: name,
            isWorkspace: false,
            isSPMProject: false,
            type: "standard" as 'standard' | 'workspace' | 'spm'
          };

          server.setActiveProject(projectObj);
          server.directoryState.setActiveDirectory(resolvedOutputDir);
        }

        return {
          content: [{
            type: "text",
            text: `Created new Xcode project at: ${projectPath}\n\n` +
                  `Project creation output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new Error(
            `Failed to create Xcode project: ${stderr || (error instanceof Error ? error.message : String(error))}`
          );
        }
      }
    }
  );
}