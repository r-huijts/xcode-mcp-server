import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { getProjectInfo } from "../../utils/project.js";

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
      projectPath: z.string().describe("Path to the .xcodeproj directory for the desired project. Supports ~ for home directory and environment variables.")
    },
    async ({ projectPath }, _extra) => {
      try {
        // Use our PathManager to expand and validate the path
        const expandedPath = server.pathManager.expandPath(projectPath);
        const stats = await fs.stat(expandedPath);
        
        if (!stats.isDirectory() || !expandedPath.endsWith(".xcodeproj")) {
          throw new Error("Invalid project path; must be a .xcodeproj directory");
        }
        
        // Create the project object
        const projectObj = {
          path: expandedPath,
          name: path.basename(expandedPath, ".xcodeproj"),
          isWorkspace: false,
          isSPMProject: false
        };
        
        // Use our new setActiveProject method which updates PathManager
        server.setActiveProject(projectObj);
        
        return {
          content: [{
            type: "text",
            text: `Active project set to: ${expandedPath}`
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
    {},
    async () => {
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
        
        const projectInfo = await getProjectInfo(server.activeProject.path);
        
        // Include current active directory from ProjectDirectoryState
        const activeDirectory = server.directoryState.getActiveDirectory();
        
        const infoWithActiveDir = {
          ...server.activeProject,
          ...projectInfo,
          activeDirectory
        };
        
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
  
  // Register a new "change_directory" tool
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
        throw new Error(`Failed to change directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  
  // Register a new "push_directory" tool
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
        throw new Error(`Failed to push directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  
  // Register a new "pop_directory" tool
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
  
  // Register a new "get_current_directory" tool
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
} 