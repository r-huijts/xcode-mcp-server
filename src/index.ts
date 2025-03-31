#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const execAsync = promisify(exec);

// Custom error classes for better error handling
class XcodeServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XcodeServerError';
  }
}

class ProjectNotFoundError extends XcodeServerError {
  constructor(message: string = "No active project set. Please set a project first using set_project_path.") {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

class PathAccessError extends XcodeServerError {
  path: string;
  
  constructor(path: string, message?: string) {
    super(message || `Access denied - path not allowed: ${path}. Please ensure the path is within your projects directory or set the projects base directory using set_projects_base_dir.`);
    this.name = 'PathAccessError';
    this.path = path;
  }
}

class FileOperationError extends XcodeServerError {
  path: string;
  operation: string;
  
  constructor(operation: string, path: string, cause?: Error) {
    const message = cause 
      ? `Failed to ${operation} file at ${path}: ${cause.message}` 
      : `Failed to ${operation} file at ${path}`;
    super(message);
    this.name = 'FileOperationError';
    this.path = path;
    this.operation = operation;
    if (cause) {
      this.cause = cause;
    }
  }
}

class CommandExecutionError extends XcodeServerError {
  command: string;
  
  constructor(command: string, stderr?: string) {
    const message = stderr 
      ? `Command execution failed: ${command}\nError: ${stderr}` 
      : `Command execution failed: ${command}`;
    super(message);
    this.name = 'CommandExecutionError';
    this.command = command;
  }
}

interface XcodeProject {
  path: string;
  name: string;
  isWorkspace?: boolean;
  isSPMProject?: boolean;
  associatedProjectPath?: string;  // For workspace, points to main .xcodeproj
  packageManifestPath?: string;    // For SPM projects, points to Package.swift
}

interface ServerConfig {
  projectsBaseDir?: string;
}

interface ProjectInfo {
  path: string;
  targets: string[];
  configurations: string[];
  schemes: string[];
}

interface FileContent {
  type: string;
  text: string;
  mimeType?: string;
  metadata?: {
    lastModified: Date;
    size: number;
  };
}

class XcodeServer {
  private server: McpServer;
  private config: ServerConfig = {};
  private activeProject: {
    path: string;
    workspace?: string;
    name: string;
    isWorkspace?: boolean;
    associatedProjectPath?: string;
    isSPMProject?: boolean;
  } | null = null;
  private projectFiles: Map<string, string[]> = new Map();

  constructor(config: ServerConfig = {}) {
    // Use environment variable for projects base directory
    if (process.env.PROJECTS_BASE_DIR) {
      this.config.projectsBaseDir = process.env.PROJECTS_BASE_DIR;
      console.error(`Using projects base directory from env: ${this.config.projectsBaseDir}`);
    }
    this.config = { ...this.config, ...config };

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

    this.registerTools();
    this.registerResources();

    // Attempt to auto-detect an active project, but don't fail if none found
    this.detectActiveProject().catch((error) => {
      console.error("Note: No active project detected -", error.message);
    });
  }

  private registerTools() {
    // Register "set_projects_base_dir"
    this.server.tool(
      "set_projects_base_dir",
      "Sets the base directory where your Xcode projects are stored.",
      {
        baseDir: z.string().describe("Absolute path to the directory containing your Xcode projects.")
      },
      async ({ baseDir }, _extra) => {
        const stats = await fs.stat(baseDir);
        if (!stats.isDirectory()) {
          throw new Error("Provided baseDir is not a directory");
        }
        this.config.projectsBaseDir = baseDir;
        await this.detectActiveProject().catch(console.error);
        return {
          content: [{
            type: "text" as const,
            text: `Projects base directory set to: ${baseDir}`
          }]
        };
      }
    );

    // Register "set_project_path"
    this.server.tool(
      "set_project_path",
      "Sets the active Xcode project by specifying the path to its .xcodeproj directory.",
      {
        projectPath: z.string().describe("Path to the .xcodeproj directory for the desired project.")
      },
      async ({ projectPath }, _extra) => {
        const stats = await fs.stat(projectPath);
        if (!stats.isDirectory() || !projectPath.endsWith(".xcodeproj")) {
          throw new Error("Invalid project path; must be a .xcodeproj directory");
        }
        this.activeProject = {
          path: projectPath,
          name: path.basename(projectPath, ".xcodeproj"),
          isWorkspace: false,
          isSPMProject: false
        };
        return {
          content: [{
            type: "text",
            text: `Active project set to: ${projectPath}`
          }]
        };
      }
    );

    // Register "get_active_project"
    this.server.tool(
      "get_active_project",
      "Retrieves detailed information about the currently active Xcode project.",
      {},
      async () => {
        if (!this.activeProject) {
          await this.detectActiveProject();
        }
        if (!this.activeProject) {
          return { 
            content: [{ 
              type: "text" as const, 
              text: "No active Xcode project detected." 
            }] 
          };
        }
        const info = await this.getProjectInfo(this.activeProject.path);
        return { 
          content: [{ 
            type: "text" as const, 
            text: JSON.stringify({ ...this.activeProject, ...info }, null, 2) 
          }] 
        };
      }
    );

    // Register "read_file"
    this.server.tool(
      "read_file",
      "Reads the contents of a file within the active Xcode project.",
      {
        filePath: z.string().describe("Relative or absolute path to the file within the active project.")
      },
      async ({ filePath }) => {
        const result = await this.readProjectFile(filePath);
        const fileContent = result.content[0];
        return {
          content: [{
            type: "text" as const,
            text: fileContent.text,
            mimeType: fileContent.mimeType
          }]
        };
      }
    );

    // Register "write_file"
    this.server.tool(
      "write_file",
      "Writes or updates the content of a file in the active Xcode project.",
      {
        filePath: z.string().describe("Relative or absolute path to the file to update or create."),
        content: z.string().describe("The content to be written to the file."),
        createIfMissing: z.boolean().optional().describe("If true, creates the file if it doesn't exist.")
      },
      async ({ filePath, content, createIfMissing }) => {
        await this.writeProjectFile(filePath, content, createIfMissing);
        return {
          content: [{
            type: "text" as const,
            text: `Successfully wrote ${filePath}`
          }]
        };
      }
    );

    // Register "list_project_files"
    this.server.tool(
      "list_project_files",
      "Lists all files within an Xcode project.",
      {
        projectPath: z.string().describe("Path to the .xcodeproj directory of the project."),
        fileType: z.string().optional().describe("Optional file extension filter.")
      },
      async ({ projectPath, fileType }) => {
        const result = await this.listProjectFiles(projectPath, fileType);
        return {
          content: [{
            type: "text" as const,
            text: result.content[0].text
          }]
        };
      }
    );

    // Register "analyze_file"
    this.server.tool(
      "analyze_file",
      "Analyzes a source file for potential issues using Xcode's static analyzer.",
      {
        filePath: z.string().describe("Path to the source file to analyze.")
      },
      async ({ filePath }) => {
        const result = await this.analyzeFile(filePath);
        return {
          content: [{
            type: "text" as const,
            text: result.content[0].text
          }]
        };
      }
    );

    // Register "build_project"
    this.server.tool(
      "build_project",
      "Builds the active Xcode project using the specified configuration and scheme.",
      {
        configuration: z.string().describe("Build configuration to use (e.g., 'Debug' or 'Release')."),
        scheme: z.string().describe("Name of the build scheme to be built. Must be one of the schemes available in the project.")
      },
      async ({ configuration, scheme }) => {
        if (!this.activeProject) {
          throw new Error("No active project set. Please set a project first using set_project_path.");
        }
        
        // Validate configuration and scheme
        const info = await this.getProjectInfo(this.activeProject.path);
        if (!info.configurations.includes(configuration)) {
          throw new Error(`Invalid configuration "${configuration}". Available configurations: ${info.configurations.join(", ")}`);
        }
        if (!info.schemes.includes(scheme)) {
          throw new Error(`Invalid scheme "${scheme}". Available schemes: ${info.schemes.join(", ")}`);
        }
        
        const result = await this.buildProject(configuration, scheme);
        return {
          content: [{
            type: "text" as const,
            text: result.content[0].text
          }]
        };
      }
    );

    // Register "run_tests"
    this.server.tool(
      "run_tests",
      "Executes tests for the active Xcode project.",
      {
        testPlan: z.string().optional().describe("Optional name of the test plan to run.")
      },
      async ({ testPlan }) => {
        const result = await this.runTests(testPlan);
        return {
          content: [{
            type: "text" as const,
            text: result.content[0].text
          }]
        };
      }
    );

    // Register "run_xcrun"
    this.server.tool(
      "run_xcrun",
      "Executes a specified Xcode tool via 'xcrun'.",
      {
        tool: z.string().describe("Name of the Xcode tool to execute."),
        arguments: z.string().optional().describe("Optional additional arguments to pass to the specified tool.")
      },
      async ({ tool, arguments: args }) => {
        const { stdout, stderr } = await execAsync(`xcrun ${tool} ${args || ""}`);
        return {
          content: [{
            type: "text" as const,
            text: `xcrun Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "list_simulators"
    this.server.tool(
      "list_simulators",
      "Lists all available iOS simulators with their details by invoking 'xcrun simctl list --json'.",
      {},
      async () => {
        const { stdout, stderr } = await execAsync("xcrun simctl list --json");
        return {
          content: [{
            type: "text" as const,
            text: `Simulators:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "boot_simulator"
    this.server.tool(
      "boot_simulator",
      "Boots an iOS simulator identified by its UDID.",
      {
        udid: z.string().describe("The UDID of the simulator to boot.")
      },
      async ({ udid }) => {
        const { stdout, stderr } = await execAsync(`xcrun simctl boot "${udid}"`);
        return {
          content: [{
            type: "text" as const,
            text: `Boot Simulator Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "shutdown_simulator"
    this.server.tool(
      "shutdown_simulator",
      "Shuts down an active iOS simulator using its UDID.",
      {
        udid: z.string().describe("The UDID of the simulator to shutdown.")
      },
      async ({ udid }) => {
        const { stdout, stderr } = await execAsync(`xcrun simctl shutdown "${udid}"`);
        return {
          content: [{
            type: "text" as const,
            text: `Shutdown Simulator Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "compile_asset_catalog"
    this.server.tool(
      "compile_asset_catalog",
      "Compiles an asset catalog using 'actool'.",
      {
        catalogPath: z.string().describe("Path to the asset catalog."),
        outputDir: z.string().describe("Directory where the compiled assets should be saved.")
      },
      async ({ catalogPath, outputDir }) => {
        const { stdout, stderr } = await execAsync(`xcrun actool "${catalogPath}" --output-format human-readable-text --notices --warnings --export-dependency-info "${outputDir}/assetcatalog_dependencies.txt" --output-partial-info-plist "${outputDir}/assetcatalog_generated_info.plist" --app-icon AppIcon --enable-on-demand-resources YES --target-device iphone --target-device ipad --minimum-deployment-target 11.0 --platform iphoneos --product-type com.apple.product-type.application --compile "${outputDir}"`);
        return {
          content: [{
            type: "text" as const,
            text: `Asset Catalog Compilation Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "run_lldb"
    this.server.tool(
      "run_lldb",
      "Launches the LLDB debugger with custom arguments.",
      {
        lldbArgs: z.string().optional().describe("Optional LLDB arguments.")
      },
      async ({ lldbArgs }) => {
        const { stdout, stderr } = await execAsync(`lldb ${lldbArgs || ""}`);
        return {
          content: [{
            type: "text" as const,
            text: `LLDB Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "trace_app"
    this.server.tool(
      "trace_app",
      "Captures a performance trace of an application using 'xctrace'.",
      {
        appPath: z.string().describe("Path to the application binary to trace."),
        duration: z.number().optional().describe("Duration (in seconds) for the trace.")
      },
      async ({ appPath, duration }) => {
        const durationArg = duration ? `--duration ${duration}` : "";
        const { stdout, stderr } = await execAsync(`xctrace record --target "${appPath}" ${durationArg} --template 'Time Profiler'`);
        return {
          content: [{
            type: "text" as const,
            text: `Trace Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "swift_package_update"
    this.server.tool(
      "swift_package_update",
      "Updates the dependencies of your Swift project using Swift Package Manager by invoking 'swift package update'.",
      {},
      async () => {
        const { stdout, stderr } = await execAsync("swift package update");
        return {
          content: [{
            type: "text" as const,
            text: `Swift Package Update Output:\n${stdout}\n${stderr}`
          }]
        };
      }
    );

    // Register "list_directory"
    this.server.tool(
      "list_directory",
      "Lists the contents of a directory, showing both files and subdirectories.",
      {
        path: z.string().describe("Path to the directory to list.")
      },
      async ({ path: dirPath }) => {
        const files = await this.listDirectory(dirPath);
        return {
          content: [{
            type: "text",
            text: files.join('\n')
          }]
        };
      }
    );

    // Register "pod_install"
    this.server.tool(
      "pod_install",
      "Runs 'pod install' in the active project directory to install CocoaPods dependencies.",
      {},
      async () => {
        if (!this.activeProject) throw new ProjectNotFoundError();
        
        const projectRoot = path.dirname(this.activeProject.path);
        const podfilePath = path.join(projectRoot, 'Podfile');
        
        try {
          // Check if Podfile exists
          await fs.access(podfilePath);
        } catch {
          throw new XcodeServerError("No Podfile found in the project directory. This project doesn't use CocoaPods.");
        }
        
        try {
          const { stdout, stderr } = await execAsync('pod install', { cwd: projectRoot });
          return {
            content: [{
              type: "text",
              text: `CocoaPods installation output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'pod install',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      }
    );

    // Register "pod_update"
    this.server.tool(
      "pod_update",
      "Runs 'pod update' in the active project directory to update CocoaPods dependencies.",
      {
        pods: z.array(z.string()).optional().describe("Optional list of specific pods to update. If not provided, updates all pods.")
      },
      async ({ pods }) => {
        if (!this.activeProject) throw new ProjectNotFoundError();
        
        const projectRoot = path.dirname(this.activeProject.path);
        const podfilePath = path.join(projectRoot, 'Podfile');
        
        try {
          // Check if Podfile exists
          await fs.access(podfilePath);
        } catch {
          throw new XcodeServerError("No Podfile found in the project directory. This project doesn't use CocoaPods.");
        }
        
        try {
          const podsToUpdate = pods ? pods.join(' ') : '';
          const { stdout, stderr } = await execAsync(`pod update ${podsToUpdate}`, { cwd: projectRoot });
          return {
            content: [{
              type: "text",
              text: `CocoaPods update output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'pod update',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      }
    );

    // Register "check_cocoapods"
    this.server.tool(
      "check_cocoapods",
      "Checks if the active project uses CocoaPods and returns information about the setup.",
      {},
      async () => {
        if (!this.activeProject) throw new ProjectNotFoundError();
        
        const projectRoot = path.dirname(this.activeProject.path);
        const podfilePath = path.join(projectRoot, 'Podfile');
        const podfileLockPath = path.join(projectRoot, 'Podfile.lock');
        
        const info = {
          usesCocoapods: false,
          podfileExists: false,
          podfileLockExists: false,
          installedPods: [] as string[],
          workspaceCreated: false
        };
        
        try {
          // Check Podfile
          await fs.access(podfilePath);
          info.podfileExists = true;
          info.usesCocoapods = true;
          
          // Check Podfile.lock
          try {
            await fs.access(podfileLockPath);
            info.podfileLockExists = true;
            
            // Parse Podfile.lock to get installed pods
            const lockContent = await fs.readFile(podfileLockPath, 'utf-8');
            const podMatches = lockContent.match(/- "?([^"]+)"? \([\d.]+\)/g);
            if (podMatches) {
              info.installedPods = podMatches.map(match => {
                const nameMatch = match.match(/- "?([^"]+)"? \(/);
                return nameMatch ? nameMatch[1] : match;
              });
            }
          } catch {
            // Podfile.lock doesn't exist, which is fine
          }
          
          // Check if workspace exists
          const workspacePath = path.join(projectRoot, `${this.activeProject.name}.xcworkspace`);
          try {
            await fs.access(workspacePath);
            info.workspaceCreated = true;
          } catch {
            // Workspace doesn't exist, which might mean pods haven't been installed
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify(info, null, 2)
            }]
          };
        } catch {
          return {
            content: [{
              type: "text",
              text: JSON.stringify(info, null, 2)
            }]
          };
        }
      }
    );

    // Register "swift_package_command"
    this.server.tool(
      "swift_package_command",
      "Executes Swift Package Manager commands in the active project directory.",
      {
        command: z.string().describe("The SPM command to execute (e.g., 'build', 'test', 'clean', 'resolve')"),
        configuration: z.string().optional().describe("Optional build configuration ('debug' or 'release')"),
        extraArgs: z.string().optional().describe("Additional arguments to pass to the command")
      },
      async ({ command, configuration, extraArgs }) => {
        if (!this.activeProject) throw new ProjectNotFoundError();
        
        if (!this.activeProject.isSPMProject) {
          throw new XcodeServerError("This command can only be used with Swift Package Manager projects.");
        }
        
        const configArg = configuration ? `--configuration ${configuration}` : '';
        const extraArgsStr = extraArgs || '';
        
        try {
          const cmd = `cd "${this.activeProject.path}" && swift package ${command} ${configArg} ${extraArgsStr}`.trim();
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

  private registerResources() {
    // Resource to list available Xcode projects.
    this.server.resource(
      "xcode-projects",
      new ResourceTemplate("xcode://projects", { list: undefined }),
      async () => {
        const projects = await this.findXcodeProjects();
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
        const project = await this.findProjectByName(decodedName);
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

  // Helper methods

  private async detectActiveProject(): Promise<void> {
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
          if (this.config.projectsBaseDir && !projectPath.startsWith(this.config.projectsBaseDir)) {
            console.warn("Active project is outside the configured base directory");
          }

          const isWorkspace = projectPath.endsWith('.xcworkspace');
          let associatedProjectPath;
          
          if (isWorkspace) {
            associatedProjectPath = await this.findMainProjectInWorkspace(projectPath);
          }
          
          this.activeProject = {
            path: projectPath,
            name: path.basename(projectPath, path.extname(projectPath)),
            isWorkspace,
            associatedProjectPath
          };
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
          const projects = await this.findXcodeProjects();
          if (projects.length > 0) {
            const projectStats = await Promise.all(
              projects.map(async (project) => ({
                project,
                stats: await fs.stat(project.path)
              }))
            );
            const mostRecent = projectStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())[0];
            this.activeProject = mostRecent.project;
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
            if (this.config.projectsBaseDir && !recentProject.startsWith(this.config.projectsBaseDir)) {
              console.warn("Recent project is outside the configured base directory");
            }

            const isWorkspace = recentProject.endsWith('.xcworkspace');
            let associatedProjectPath;
            
            if (isWorkspace) {
              associatedProjectPath = await this.findMainProjectInWorkspace(recentProject);
            }
            
            this.activeProject = {
              path: recentProject,
              name: path.basename(recentProject, path.extname(recentProject)),
              isWorkspace,
              associatedProjectPath
            };
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

  private async findXcodeProjects(): Promise<XcodeProject[]> {
    try {
      let searchPath = ".";
      if (this.config.projectsBaseDir) {
        searchPath = this.config.projectsBaseDir;
      }
      
      // Find .xcodeproj, .xcworkspace, and Package.swift files
      const { stdout: projStdout } = await execAsync(`find "${searchPath}" -name "*.xcodeproj"`);
      const { stdout: workspaceStdout } = await execAsync(`find "${searchPath}" -name "*.xcworkspace"`);
      const { stdout: spmStdout } = await execAsync(`find "${searchPath}" -name "Package.swift"`);
      
      const projects: XcodeProject[] = [];
      
      // Handle regular projects
      const projectPaths = projStdout.split("\n").filter(Boolean);
      for (const projectPath of projectPaths) {
        // Skip if this is a project inside a workspace (will be handled with workspace)
        const isInWorkspace = await this.isProjectInWorkspace(projectPath);
        if (!isInWorkspace) {
          projects.push({
            path: projectPath,
            name: path.basename(projectPath, ".xcodeproj"),
            isWorkspace: false,
            isSPMProject: false
          });
        }
      }
      
      // Handle workspaces
      const workspacePaths = workspaceStdout.split("\n").filter(Boolean);
      for (const workspacePath of workspacePaths) {
        const mainProject = await this.findMainProjectInWorkspace(workspacePath);
        projects.push({
          path: workspacePath,
          name: path.basename(workspacePath, ".xcworkspace"),
          isWorkspace: true,
          isSPMProject: false,
          associatedProjectPath: mainProject
        });
      }

      // Handle SPM projects
      const spmPaths = spmStdout.split("\n").filter(Boolean);
      for (const packagePath of spmPaths) {
        // Skip if this is a Package.swift inside an Xcode project or workspace
        const isInXcodeProject = await this.isInXcodeProject(packagePath);
        if (!isInXcodeProject) {
          projects.push({
            path: path.dirname(packagePath), // Use the directory containing Package.swift
            name: path.basename(path.dirname(packagePath)), // Use directory name as project name
            isWorkspace: false,
            isSPMProject: true,
            packageManifestPath: packagePath
          });
        }
      }
      
      return projects;
    } catch (error) {
      console.error("Error finding projects:", error);
      return [];
    }
  }

  private async isProjectInWorkspace(projectPath: string): Promise<boolean> {
    const projectDir = path.dirname(projectPath);
    const workspaceCheck = await execAsync(`find "${projectDir}" -maxdepth 2 -name "*.xcworkspace"`);
    return workspaceCheck.stdout.trim().length > 0;
  }

  private async findMainProjectInWorkspace(workspacePath: string): Promise<string | undefined> {
    try {
      // Read workspace contents
      const contentsPath = path.join(workspacePath, 'contents.xcworkspacedata');
      const contents = await fs.readFile(contentsPath, 'utf-8');
      
      // Look for the main project reference
      const projectMatch = contents.match(/location = "group:([^"]+\.xcodeproj)"/);
      if (projectMatch) {
        const projectRelPath = projectMatch[1];
        return path.resolve(path.dirname(workspacePath), projectRelPath);
      }
      
      return undefined;
    } catch (error) {
      console.error("Error finding main project in workspace:", error);
      return undefined;
    }
  }

  private async getProjectInfo(projectPath: string) {
    try {
      const { stdout } = await execAsync(`xcodebuild -list -project "${projectPath}"`);
      const info = {
        path: projectPath,
        targets: [] as string[],
        configurations: [] as string[],
        schemes: [] as string[]
      };
      let currentSection = "";
      for (const line of stdout.split("\n")) {
        if (line.includes("Targets:")) {
          currentSection = "targets";
        } else if (line.includes("Build Configurations:")) {
          currentSection = "configurations";
        } else if (line.includes("Schemes:")) {
          currentSection = "schemes";
        } else if (line.trim() && !line.includes(":")) {
          if (currentSection === "targets") info.targets.push(line.trim());
          else if (currentSection === "configurations") info.configurations.push(line.trim());
          else if (currentSection === "schemes") info.schemes.push(line.trim());
        }
      }
      return info;
    } catch (error) {
      console.error("Error getting project info:", error);
      throw error;
    }
  }

  private async analyzeFile(filePath: string) {
    try {
      const { stdout } = await execAsync(`xcodebuild analyze -quiet -file "${filePath}"`);
      return { content: [{ type: "text", text: `Analysis for ${filePath}:\n${stdout}` }] };
    } catch (error) {
      console.error("Error analyzing file:", error);
      throw error;
    }
  }

  private async buildProject(configuration: string, scheme: string) {
    if (!this.activeProject) throw new ProjectNotFoundError();
    
    const projectPath = this.activeProject.path;
    let projectInfo;
    
    try {
      // Different command for workspace vs project vs SPM
      if (this.activeProject.isSPMProject) {
        // For SPM projects, we use swift build
        const buildConfig = configuration.toLowerCase() === 'release' ? '--configuration release' : '';
        try {
          const cmd = `cd "${projectPath}" && swift build ${buildConfig}`;
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
            `swift build for ${this.activeProject.name}`,
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } else if (this.activeProject.isWorkspace) {
        projectInfo = await this.getWorkspaceInfo(projectPath);
      } else {
        projectInfo = await this.getProjectInfo(projectPath);
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
      const projectFlag = this.activeProject.isWorkspace ? `-workspace "${projectPath}"` : `-project "${projectPath}"`;
      const cmd = `xcodebuild ${projectFlag} -scheme "${scheme}" -configuration "${configuration}" build`;
      
      try {
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
          `xcodebuild for ${scheme} (${configuration})`,
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    } catch (error) {
      console.error("Error building project:", error);
      throw error;
    }
  }

  private async getWorkspaceInfo(workspacePath: string) {
    try {
      const { stdout } = await execAsync(`xcodebuild -workspace "${workspacePath}" -list`);
      const info = {
        path: workspacePath,
        targets: [] as string[],
        configurations: [] as string[],
        schemes: [] as string[]
      };
      let currentSection = "";
      for (const line of stdout.split("\n")) {
        if (line.includes("Targets:")) {
          currentSection = "targets";
        } else if (line.includes("Build Configurations:")) {
          currentSection = "configurations";
        } else if (line.includes("Schemes:")) {
          currentSection = "schemes";
        } else if (line.trim() && !line.includes(":")) {
          if (currentSection === "targets") info.targets.push(line.trim());
          else if (currentSection === "configurations") info.configurations.push(line.trim());
          else if (currentSection === "schemes") info.schemes.push(line.trim());
        }
      }
      return info;
    } catch (error) {
      console.error("Error getting workspace info:", error);
      throw error;
    }
  }

  private async readProjectFile(filePath: string) {
    try {
      if (!this.activeProject) throw new ProjectNotFoundError();
      
      const projectRoot = path.dirname(this.activeProject.path);
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
      
      if (!absolutePath.startsWith(projectRoot)) {
        throw new PathAccessError(absolutePath, "File must be within the active project directory");
      }
      
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        const stats = await fs.stat(absolutePath);
        const mimeType = this.getMimeTypeForExtension(path.extname(absolutePath));
        
        return {
          content: [{
            type: "text",
            text: content,
            mimeType,
            metadata: { lastModified: stats.mtime, size: stats.size }
          }]
        };
      } catch (error) {
        if (error instanceof Error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'ENOENT') {
            throw new FileOperationError('read', absolutePath, new Error('File does not exist'));
          }
          if (nodeError.code === 'EACCES') {
            throw new FileOperationError('read', absolutePath, new Error('Permission denied'));
          }
        }
        throw new FileOperationError('read', absolutePath, error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      console.error("Error reading file:", error);
      throw error; // Re-throw the already specific error
    }
  }

  private async writeProjectFile(filePath: string, content: string, createIfMissing: boolean = false) {
    try {
      if (!this.activeProject) throw new ProjectNotFoundError();
      
      const projectRoot = path.dirname(this.activeProject.path);
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
      
      if (!absolutePath.startsWith(projectRoot)) {
        throw new PathAccessError(absolutePath, "File must be within the active project directory");
      }
      
      try {
        const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
        if (!exists && !createIfMissing) {
          throw new FileOperationError('write', absolutePath, new Error('File does not exist and createIfMissing is false'));
        }
        
        // Create directory structure if needed
        try {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        } catch (mkdirError) {
          throw new FileOperationError('create directory for', absolutePath, 
            mkdirError instanceof Error ? mkdirError : new Error(String(mkdirError)));
        }
        
        // Write file
        await fs.writeFile(absolutePath, content, "utf-8");
        
        // Update project references if needed
        try {
          await this.updateProjectReferences(projectRoot, absolutePath);
        } catch (updateError) {
          console.warn(`Warning: Could not update project references: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
          // Continue despite reference update failure
        }
        
        return { content: [{ type: "text", text: `Successfully wrote ${absolutePath}` }] };
      } catch (error) {
        if (error instanceof FileOperationError) {
          throw error; // Already a specific error
        }
        
        if (error instanceof Error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'EACCES') {
            throw new FileOperationError('write', absolutePath, new Error('Permission denied'));
          }
          if (nodeError.code === 'EISDIR') {
            throw new FileOperationError('write', absolutePath, new Error('Path is a directory, not a file'));
          }
        }
        
        throw new FileOperationError('write', absolutePath, 
          error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      console.error("Error writing file:", error);
      throw error; // Re-throw the already specific error
    }
  }

  private async listProjectFiles(projectPath: string, fileType?: string) {
    try {
      if (!this.activeProject) throw new Error("No active project set.");
      const projectRoot = path.dirname(this.activeProject.path);
      let files = this.projectFiles.get(projectRoot);
      if (!files) {
        files = await this.scanProjectFiles(projectRoot);
        this.projectFiles.set(projectRoot, files);
      }
      if (fileType) {
        files = files.filter(file => path.extname(file).slice(1) === fileType);
      }
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    } catch (error) {
      console.error("Error listing project files:", error);
      throw error;
    }
  }

  private async scanProjectFiles(projectPath: string): Promise<string[]> {
    const projectRoot = path.dirname(projectPath);
    const result: string[] = [];
    async function scan(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === "node_modules" || entry.name.endsWith(".xcodeproj")) continue;
        if (entry.isDirectory()) await scan(fullPath);
        else result.push(fullPath);
      }
    }
    await scan(projectRoot);
    return result;
  }

  private async updateProjectReferences(projectRoot: string, filePath: string) {
    const projectDir = await fs.readdir(projectRoot)
      .then(entries => entries.find(e => e.endsWith(".xcodeproj")))
      .then(projDir => path.join(projectRoot, projDir!, "project.pbxproj"));
    if (!projectDir) throw new Error("Could not find project.pbxproj");
    // TODO: Use a dedicated library to update the pbxproj file if needed.
    console.error("New file created. You may need to add it to the project in Xcode manually.");
  }

  private getMimeTypeForExtension(ext: string): string {
    const mimeTypes: Record<string, string> = {
      ".swift": "text/x-swift",
      ".m": "text/x-objective-c",
      ".h": "text/x-c",
      ".c": "text/x-c",
      ".cpp": "text/x-c++",
      ".json": "application/json",
      ".plist": "application/x-plist",
      ".storyboard": "application/x-xcode-storyboard",
      ".xib": "application/x-xcode-xib"
    };
    return mimeTypes[ext] || "text/plain";
  }

  private async runTests(testPlan?: string) {
    try {
      if (!this.activeProject) throw new ProjectNotFoundError();
      
      try {
        const arg = testPlan ? `-testPlan "${testPlan}"` : "";
        const cmd = `xcodebuild test ${arg}`;
        const { stdout, stderr } = await execAsync(cmd);
        
        const hasFailures = stdout.includes("** TEST FAILED **") || stderr.includes("** TEST FAILED **");
        return { 
          content: [{ 
            type: "text", 
            text: `Test ${hasFailures ? 'FAILED' : 'PASSED'}\n\nTest results:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}` 
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
          return { 
            content: [{ 
              type: "text", 
              text: `Tests FAILED\n\n${stderr || (error instanceof Error ? error.message : String(error))}` 
            }] 
          };
        }
        
        throw new CommandExecutionError(
          `xcodebuild test${testPlan ? ` with testPlan ${testPlan}` : ''}`, 
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    } catch (error) {
      console.error("Error running tests:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async findProjectByName(name: string): Promise<XcodeProject | undefined> {
    const projects = await this.findXcodeProjects();
    return projects.find(p => p.name === name);
  }

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

  private isPathAllowed(targetPath: string): boolean {
    // If projectsBaseDir is set, allow paths within it
    if (this.config.projectsBaseDir) {
      // Allow the projects base dir itself and any subdirectories
      if (targetPath === this.config.projectsBaseDir || targetPath.startsWith(this.config.projectsBaseDir + path.sep)) {
        return true;
      }
    }
    
    // If there's an active project, allow paths within its directory
    if (this.activeProject) {
      const projectDir = path.dirname(this.activeProject.path);
      if (targetPath === projectDir || targetPath.startsWith(projectDir + path.sep)) {
        return true;
      }
    }

    // Allow paths within the server's directory for development purposes
    const serverDir = process.cwd();
    if (targetPath === serverDir || targetPath.startsWith(serverDir + path.sep)) {
      return true;
    }
    
    return false;
  }

  private async listDirectory(dirPath: string): Promise<string[]> {
    try {
      const targetPath = path.resolve(dirPath);
      if (!this.isPathAllowed(targetPath)) {
        throw new PathAccessError(targetPath);
      }

      try {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        return entries.map(entry => {
          const fullPath = path.join(targetPath, entry.name);
          return `${entry.isDirectory() ? 'd' : 'f'} ${fullPath}`;
        });
      } catch (error) {
        if (error instanceof Error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new FileOperationError('list', targetPath, new Error('Directory does not exist'));
          }
          if ((error as NodeJS.ErrnoException).code === 'EACCES') {
            throw new FileOperationError('list', targetPath, new Error('Permission denied'));
          }
        }
        throw new FileOperationError('list', targetPath, error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      console.error("Error listing directory:", error);
      throw error; // Re-throw the already specific error
    }
  }

  private async isInXcodeProject(filePath: string): Promise<boolean> {
    const dir = path.dirname(filePath);
    const parentDirs = dir.split(path.sep);
    
    // Check each parent directory for .xcodeproj or .xcworkspace
    while (parentDirs.length > 0) {
      const currentPath = parentDirs.join(path.sep);
      try {
        const entries = await fs.readdir(currentPath);
        if (entries.some(entry => entry.endsWith('.xcodeproj') || entry.endsWith('.xcworkspace'))) {
          return true;
        }
      } catch {
        // Ignore read errors, just continue checking
      }
      parentDirs.pop();
    }
    
    return false;
  }
}

// Main function to initialize and start the server with proper error handling
async function main() {
  try {
    const server = new XcodeServer();
    await server.start();
  } catch (error) {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("Unhandled exception:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});