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
    
    // Simple parsing for location tags
    const projects: string[] = [];
    const locationRegex = /location\s+group:([^=]+)?=?"([^"]+)"/g;
    let match;
    
    while ((match = locationRegex.exec(xmlContent)) !== null) {
      const relativePath = match[2];
      if (relativePath.endsWith(".xcodeproj")) {
        // Resolve the path relative to the workspace
        const absolutePath = path.resolve(path.dirname(workspacePath), relativePath);
        projects.push(absolutePath);
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
      setActiveDirectory: z.boolean().optional().describe("If true, also set the active directory to the project directory")
    },
    async ({ projectPath, setActiveDirectory = true }, _extra) => {
      try {
        // IMPORTANT: Always expand the tilde first, before any other path operations
        const expandedPath = server.pathManager.expandPath(projectPath);
        
        // Then handle relative paths if needed
        const fullPath = path.isAbsolute(expandedPath) 
          ? expandedPath 
          : server.directoryState.resolvePath(expandedPath);
        
        // Now validate the path
        const validatedPath = server.pathManager.validatePathForReading(fullPath);
        
        // Check if the path exists
        const stats = await fs.stat(validatedPath);
        
        let isWorkspace = false;
        let isSPMProject = false;
        let projectType = "standard";
        
        // Check project type
        if (validatedPath.endsWith(".xcworkspace")) {
          isWorkspace = true;
          projectType = "workspace";
        } else if (validatedPath.endsWith(".xcodeproj")) {
          // Standard Xcode project
        } else {
          // Check if it's a SPM project with Package.swift
          const packageSwiftPath = path.join(validatedPath, "Package.swift");
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
          path: validatedPath,
          name: path.basename(validatedPath, path.extname(validatedPath)),
          isWorkspace,
          isSPMProject,
          type: projectType
        };
        
        // Use our setActiveProject method which updates PathManager
        server.setActiveProject(projectObj);
        
        // Set active directory to project directory if requested
        if (setActiveDirectory) {
          const projectDir = path.dirname(validatedPath);
          server.directoryState.setActiveDirectory(projectDir);
        }
        
        return {
          content: [{
            type: "text",
            text: `Active project set to: ${validatedPath} (${projectType})`
          }]
        };
      } catch (error) {
        throw new Error(`Failed to set project path: ${error instanceof Error ? error.message : String(error)}`);
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
        // First resolve the path (handles relative paths correctly)
        const resolvedPath = server.directoryState.resolvePath(directoryPath);
        
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
        // First resolve the path (handles relative paths correctly)
        const resolvedPath = server.directoryState.resolvePath(directoryPath);
        
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
    {},
    async () => {
      try {
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
} 