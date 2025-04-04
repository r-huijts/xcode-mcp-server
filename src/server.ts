import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";

import { ServerConfig, ActiveProject } from "./types/index.js";
import { XcodeServerError, ProjectNotFoundError } from "./utils/errors.js";
import { findXcodeProjects, findProjectByName, getProjectInfo } from "./utils/project.js";

// Import our new path management classes
import { PathManager } from "./utils/pathManager.js";
import { SafeFileOperations } from "./utils/safeFileOperations.js";
import { ProjectDirectoryState } from "./utils/projectDirectoryState.js";

// Load environment variables from .env file
dotenv.config();

const execAsync = promisify(exec);

// Tool registration functions
import { registerProjectTools } from "./tools/project/index.js";
import { registerFileTools } from "./tools/file/index.js";
import { registerBuildTools } from "./tools/build/index.js";
import { registerCocoaPodsTools } from "./tools/cocoapods/index.js";
import { registerSPMTools } from "./tools/spm/index.js";
import { registerSimulatorTools } from "./tools/simulator/index.js";
import { registerXcodeTools } from "./tools/xcode/index.js";

export class XcodeServer {
  public server: McpServer;
  public config: ServerConfig = {};
  public activeProject: ActiveProject | null = null;
  public projectFiles: Map<string, string[]> = new Map();
  
  // Our new path management instances
  public pathManager: PathManager;
  public fileOperations: SafeFileOperations;
  public directoryState: ProjectDirectoryState;

  constructor(config: ServerConfig = {}) {
    // Use environment variable for projects base directory
    if (process.env.PROJECTS_BASE_DIR) {
      config.projectsBaseDir = process.env.PROJECTS_BASE_DIR;
      console.error(`Using projects base directory from env: ${config.projectsBaseDir}`);
    }
    this.config = { ...this.config, ...config };

    // Initialize our path management system
    this.pathManager = new PathManager(this.config);
    this.fileOperations = new SafeFileOperations(this.pathManager);
    this.directoryState = new ProjectDirectoryState(this.pathManager);

    // Create the MCP server
    this.server = new McpServer({
      name: "xcode-server",
      version: "1.0.0",
      description: "An MCP server for Xcode integration"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Enable debug logging if DEBUG is set
    if (process.env.DEBUG === "true") {
      console.error("Debug mode enabled");
    }

    // Register all tools
    this.registerAllTools();
    this.registerResources();

    // Attempt to auto-detect an active project, but don't fail if none found
    this.detectActiveProject().catch((error) => {
      console.error("Note: No active project detected -", error.message);
    });
  }

  private registerAllTools() {
    // Register tools from each category
    registerProjectTools(this);
    registerFileTools(this);
    registerBuildTools(this);
    registerCocoaPodsTools(this);
    registerSPMTools(this);
    registerSimulatorTools(this);
    registerXcodeTools(this);
  }

  private registerResources() {
    // Resource to list available Xcode projects.
    this.server.resource(
      "xcode-projects",
      new ResourceTemplate("xcode://projects", { list: undefined }),
      async () => {
        const projects = await findXcodeProjects(this.config.projectsBaseDir);
        return {
          contents: projects.map(project => ({
            uri: `xcode://projects/${encodeURIComponent(project.name)}`,
            text: project.name,
            mimeType: "application/x-xcode-project" as const
          }))
        };
      }
    );

    // Resource to get project details
    this.server.resource(
      "xcode-project",
      new ResourceTemplate("xcode://projects/{name}", { list: undefined }),
      async (uri, { name }) => {
        const decodedName = decodeURIComponent(name as string);
        const project = await findProjectByName(decodedName, this.config.projectsBaseDir);
        if (!project) {
          throw new Error(`Project ${decodedName} not found`);
        }
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(project, null, 2),
            mimeType: "application/json" as const
          }]
        };
      }
    );
  }

  /**
   * Detect an active Xcode project
   */
  public async detectActiveProject(): Promise<void> {
    try {
      // Attempt to get the frontmost Xcode project via AppleScript.
      try {
        const { stdout: frontmostProject } = await execAsync(`
          osascript -e '
            tell application "Xcode"
              if it is running then
                set projectFile to path of document 1
                return POSIX path of projectFile
              end if
            end tell
          '
        `);
        
        if (frontmostProject && frontmostProject.trim()) {
          const projectPath = frontmostProject.trim();
          
          // Using our new path manager to check boundaries
          if (this.config.projectsBaseDir && 
              !this.pathManager.isPathWithin(this.config.projectsBaseDir, projectPath)) {
            console.warn("Active project is outside the configured base directory");
          }

          const isWorkspace = projectPath.endsWith('.xcworkspace');
          let associatedProjectPath;
          
          if (isWorkspace) {
            const { findMainProjectInWorkspace } = await import('./utils/project.js');
            associatedProjectPath = await findMainProjectInWorkspace(projectPath);
          }
          
          this.activeProject = {
            path: projectPath,
            name: path.basename(projectPath, path.extname(projectPath)),
            isWorkspace,
            associatedProjectPath
          };
          
          // Update path manager with active project
          this.pathManager.setActiveProject(projectPath);
          
          // Set the project root as the active directory
          const projectRoot = path.dirname(projectPath);
          this.directoryState.setActiveDirectory(projectRoot);
          
          return;
        }
      } catch (error) {
        // Just log and continue with fallback methods
        console.warn("Could not detect active Xcode project via AppleScript:", 
          error instanceof Error ? error.message : String(error));
      }

      // Fallback: scan base directory if set.
      if (this.config.projectsBaseDir) {
        try {
          const projects = await findXcodeProjects(this.config.projectsBaseDir);
          if (projects.length > 0) {
            const projectStats = await Promise.all(
              projects.map(async (project) => ({
                project,
                stats: await fs.stat(project.path)
              }))
            );
            const mostRecent = projectStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())[0];
            this.activeProject = mostRecent.project;
            
            // Update path manager with active project
            this.pathManager.setActiveProject(mostRecent.project.path);
            
            // Set the project root as the active directory
            const projectRoot = path.dirname(mostRecent.project.path);
            this.directoryState.setActiveDirectory(projectRoot);
            
            return;
          }
        } catch (error) {
          console.warn("Error scanning projects directory:", 
            error instanceof Error ? error.message : String(error));
        }
      }

      // Further fallback: try reading recent projects from Xcode defaults.
      try {
        const { stdout: recentProjects } = await execAsync('defaults read com.apple.dt.Xcode IDERecentWorkspaceDocuments || true');
        if (recentProjects) {
          const projectMatch = recentProjects.match(/= \\"([^"]+)"/);
          if (projectMatch) {
            const recentProject = projectMatch[1];
            
            // Using our new path manager to check boundaries
            if (this.config.projectsBaseDir && 
                !this.pathManager.isPathWithin(this.config.projectsBaseDir, recentProject)) {
              console.warn("Recent project is outside the configured base directory");
            }

            const isWorkspace = recentProject.endsWith('.xcworkspace');
            let associatedProjectPath;
            
            if (isWorkspace) {
              const { findMainProjectInWorkspace } = await import('./utils/project.js');
              associatedProjectPath = await findMainProjectInWorkspace(recentProject);
            }
            
            this.activeProject = {
              path: recentProject,
              name: path.basename(recentProject, path.extname(recentProject)),
              isWorkspace,
              associatedProjectPath
            };
            
            // Update path manager with active project
            this.pathManager.setActiveProject(recentProject);
            
            // Set the project root as the active directory
            const projectRoot = path.dirname(recentProject);
            this.directoryState.setActiveDirectory(projectRoot);
            
            return;
          }
        }
      } catch (error) {
        console.warn("Error reading Xcode defaults:", 
          error instanceof Error ? error.message : String(error));
      }
      
      // If we've tried all methods and found nothing
      throw new ProjectNotFoundError("No active Xcode project found. Please open a project in Xcode or set one explicitly.");
    } catch (error) {
      console.error("Error detecting active project:", 
        error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Set the active project and update path manager
   */
  public setActiveProject(project: ActiveProject): void {
    this.activeProject = project;
    this.pathManager.setActiveProject(project.path);
    
    // Set the project root as the active directory
    const projectRoot = path.dirname(project.path);
    this.directoryState.setActiveDirectory(projectRoot);
  }

  /**
   * Start the server
   */
  public async start() {
    try {
      console.error("Starting Xcode MCP Server...");
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("Xcode MCP Server started");
    } catch (error) {
      if (error instanceof Error) {
        console.error("Failed to start server:", error.message);
        throw new XcodeServerError(`Server initialization failed: ${error.message}`);
      }
      console.error("Unknown error starting server:", error);
      throw new XcodeServerError(`Server initialization failed: ${String(error)}`);
    }
  }
} 