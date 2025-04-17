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
            console.error("Active project is outside the configured base directory");
          }

          // Clean up path if it's pointing to project.xcworkspace inside an .xcodeproj
          let cleanedPath = projectPath;
          if (projectPath.endsWith('/project.xcworkspace')) {
            cleanedPath = projectPath.replace('/project.xcworkspace', '');
          }

          const isWorkspace = cleanedPath.endsWith('.xcworkspace');
          let associatedProjectPath;

          if (isWorkspace) {
            const { findMainProjectInWorkspace } = await import('./utils/project.js');
            associatedProjectPath = await findMainProjectInWorkspace(cleanedPath);
          }

          this.activeProject = {
            path: cleanedPath, // Use the cleaned path
            name: path.basename(cleanedPath, path.extname(cleanedPath)),
            isWorkspace,
            associatedProjectPath
          };

          // Update path manager with active project
          this.pathManager.setActiveProject(cleanedPath);

          // Set the project root as the active directory
          const projectRoot = path.dirname(cleanedPath);
          this.directoryState.setActiveDirectory(projectRoot);

          return;
        }
      } catch (error) {
        // Just log and continue with fallback methods
        console.error("Could not detect active Xcode project via AppleScript:",
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

            // Clean up path if needed
            let cleanedPath = mostRecent.project.path;
            if (cleanedPath.endsWith('/project.xcworkspace')) {
              cleanedPath = cleanedPath.replace('/project.xcworkspace', '');
              // Update the project object to use the cleaned path
              mostRecent.project.path = cleanedPath;
              mostRecent.project.name = path.basename(cleanedPath, path.extname(cleanedPath));
            }

            this.activeProject = mostRecent.project;

            // Update path manager with active project
            this.pathManager.setActiveProject(cleanedPath);

            // Set the project root as the active directory
            const projectRoot = path.dirname(cleanedPath);
            this.directoryState.setActiveDirectory(projectRoot);

            return;
          }
        } catch (error) {
          console.error("Error scanning projects directory:",
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
              console.error("Recent project is outside the configured base directory");
            }

            // Clean up path if needed
            let cleanedPath = recentProject;
            if (cleanedPath.endsWith('/project.xcworkspace')) {
              cleanedPath = cleanedPath.replace('/project.xcworkspace', '');
            }

            const isWorkspace = cleanedPath.endsWith('.xcworkspace');
            let associatedProjectPath;

            if (isWorkspace) {
              const { findMainProjectInWorkspace } = await import('./utils/project.js');
              associatedProjectPath = await findMainProjectInWorkspace(cleanedPath);
            }

            this.activeProject = {
              path: cleanedPath,
              name: path.basename(cleanedPath, path.extname(cleanedPath)),
              isWorkspace,
              associatedProjectPath
            };

            // Update path manager with active project
            this.pathManager.setActiveProject(cleanedPath);

            // Set the project root as the active directory
            const projectRoot = path.dirname(cleanedPath);
            this.directoryState.setActiveDirectory(projectRoot);

            return;
          }
        }
      } catch (error) {
        console.error("Error reading Xcode defaults:",
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
    // Clean up path if needed
    if (project.path.endsWith('/project.xcworkspace')) {
      const cleanedPath = project.path.replace('/project.xcworkspace', '');
      // Update the project object to use the cleaned path
      project.path = cleanedPath;
      project.name = path.basename(cleanedPath, path.extname(cleanedPath));
    }

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
      console.error("Node.js version:", process.version);
      console.error("Current working directory:", process.cwd());
      console.error("Projects base directory:", this.config.projectsBaseDir || "Not set");

      // Check if we can access the projects directory
      if (this.config.projectsBaseDir) {
        try {
          await fs.access(this.config.projectsBaseDir);
          console.error("Projects directory exists and is accessible");
        } catch (err) {
          console.error("Warning: Cannot access projects directory:", err instanceof Error ? err.message : String(err));
        }
      }

      // Initialize transport with error handling
      console.error("Initializing StdioServerTransport...");
      const transport = new StdioServerTransport();

      // Connect with detailed logging
      console.error("Connecting to transport...");
      await this.server.connect(transport);
      console.error("Xcode MCP Server started successfully");
    } catch (error) {
      if (error instanceof Error) {
        console.error("Failed to start server:", error.message);
        console.error("Error stack:", error.stack);
        throw new XcodeServerError(`Server initialization failed: ${error.message}`);
      }
      console.error("Unknown error starting server:", error);
      throw new XcodeServerError(`Server initialization failed: ${String(error)}`);
    }
  }
}