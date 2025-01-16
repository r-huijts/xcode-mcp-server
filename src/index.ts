import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

interface XcodeProject {
  path: string;
  name: string;
}

interface GetActiveProjectArgs {}

interface ReadFileArgs {
  filePath: string;
}

interface WriteFileArgs {
  filePath: string;
  content: string;
  createIfMissing?: boolean;
}

interface ListProjectFilesArgs {
  projectPath: string;
  fileType?: string;
}

interface AnalyzeFileArgs {
  filePath: string;
}

interface BuildProjectArgs {
  configuration: string;
  scheme: string;
}

interface RunTestsArgs {
  testPlan?: string;
}

interface SetProjectPathArgs {
  projectPath: string;
}

class XcodeServer {
  private server: Server;
  private fileWatchers: Map<string, any> = new Map();
  private projectFiles: Map<string, string[]> = new Map();
  private activeProject: {
    path: string;
    workspace?: string;
    name: string;
  } | null = null;

  constructor() {
    this.server = new Server(
      {
        name: "xcode-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        },
      }
    );

    // Initialize handlers first so we can handle requests even without an active project
    this.initializeHandlers();
    
    // Then try to detect the project
    this.detectActiveProject()
      .catch(error => {
        console.error("Failed to detect active project:", error.message);
        // Project will remain null until explicitly set via API
      });
  }

  private async initializeHandlers() {
    // Set up tool handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "set_project_path",
          description: "Explicitly set the path to the Xcode project to work with",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Path to the .xcodeproj directory"
              }
            },
            required: ["projectPath"]
          }
        },
        {
          name: "get_active_project",
          description: "Get information about the currently active Xcode project",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },

        {
          name: "read_file",
          description: "Read contents of a file in the Xcode project",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the file within the project"
              }
            },
            required: ["filePath"]
          }
        },
        {
          name: "write_file",
          description: "Write or update contents of a file in the Xcode project",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the file within the project"
              },
              content: {
                type: "string",
                description: "Content to write to the file"
              },
              createIfMissing: {
                type: "boolean",
                description: "Whether to create the file if it doesn't exist"
              }
            },
            required: ["filePath", "content"]
          }
        },
        {
          name: "list_project_files",
          description: "List all files in an Xcode project",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Path to the .xcodeproj directory"
              },
              fileType: {
                type: "string",
                description: "Filter by file extension (e.g., 'swift', 'm')"
              }
            },
            required: ["projectPath"]
          }
        },
        {
          name: "analyze_file",
          description: "Analyze source file for issues and suggestions",
          inputSchema: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "Path to the source file"
              }
            },
            required: ["filePath"]
          }
        },
        {
          name: "build_project",
          description: "Build the current Xcode project",
          inputSchema: {
            type: "object",
            properties: {
              configuration: {
                type: "string",
                description: "Build configuration (Debug/Release)"
              },
              scheme: {
                type: "string",
                description: "Build scheme name"
              }
            },
            required: ["configuration", "scheme"]
          }
        },
        {
          name: "run_tests",
          description: "Run tests for the current Xcode project",
          inputSchema: {
            type: "object",
            properties: {
              testPlan: {
                type: "string",
                description: "Name of the test plan to run"
              }
            }
          }
        }
      ]
    }));

    // Set up resource handlers
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const projects = await this.findXcodeProjects();
      return {
        resources: projects.map(project => ({
          uri: `xcode://${encodeURIComponent(project.path)}`,
          name: project.name,
          mimeType: "application/x-xcode-project"
        }))
      };
    });

    // Handle reading project resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (!uri.startsWith("xcode://")) {
        throw new Error("Invalid Xcode resource URI");
      }

      const projectPath = decodeURIComponent(uri.replace("xcode://", ""));
      const projectInfo = await this.getProjectInfo(projectPath);

      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(projectInfo, null, 2)
        }]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;

      switch (name) {
        case "set_project_path": {
          const args = rawArgs as unknown as SetProjectPathArgs;
          if (!args?.projectPath) {
            throw new Error('Invalid arguments: projectPath (string) is required');
          }
          
          // Validate that the path exists and is an Xcode project
          const stats = await fs.stat(args.projectPath);
          if (!stats.isDirectory() || !args.projectPath.endsWith('.xcodeproj')) {
            throw new Error('Invalid project path: must be a .xcodeproj directory');
          }

          this.activeProject = {
            path: args.projectPath,
            name: path.basename(args.projectPath, '.xcodeproj')
          };

          return {
            content: [{
              type: "text",
              text: `Successfully set active project to: ${args.projectPath}`
            }]
          };
        }

        case "get_active_project": {
          const args = rawArgs as unknown as GetActiveProjectArgs;
          return await this.getActiveProjectInfo();
        }

        case "read_file": {
          const args = rawArgs as unknown as ReadFileArgs;
          if (!args?.filePath) {
            throw new Error('Invalid arguments: filePath (string) is required');
          }
          return await this.readProjectFile(args.filePath);
        }

        case "write_file": {
          const args = rawArgs as unknown as WriteFileArgs;
          if (!args?.filePath || !args?.content) {
            throw new Error('Invalid arguments: filePath (string) and content (string) are required');
          }
          return await this.writeProjectFile(
            args.filePath,
            args.content,
            args.createIfMissing
          );
        }

        case "list_project_files": {
          const args = rawArgs as unknown as ListProjectFilesArgs;
          if (!args?.projectPath) {
            throw new Error('Invalid arguments: projectPath (string) is required');
          }
          return await this.listProjectFiles(
            args.projectPath,
            args.fileType
          );
        }

        case "analyze_file": {
          const args = rawArgs as unknown as AnalyzeFileArgs;
          if (!args?.filePath) {
            throw new Error('Invalid arguments: filePath (string) is required');
          }
          return await this.analyzeFile(args.filePath);
        }

        case "build_project": {
          const args = rawArgs as unknown as BuildProjectArgs;
          if (!args?.configuration || !args?.scheme) {
            throw new Error('Invalid arguments: configuration (string) and scheme (string) are required');
          }
          return await this.buildProject(args.configuration, args.scheme);
        }

        case "run_tests": {
          const args = rawArgs as unknown as RunTestsArgs;
          return await this.runTests(args?.testPlan);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async detectActiveProject(): Promise<void> {
    try {
      // First try to get the frontmost Xcode project using AppleScript
      const { stdout: frontmostProject } = await execAsync(`
        osascript -e '
          tell application "Xcode"
            if it is running then
              set projectFile to path of document 1
              return POSIX path of projectFile
            end if
          end tell
        '
      `).catch(() => ({ stdout: '' }));

      if (frontmostProject.trim()) {
        this.activeProject = {
          path: frontmostProject.trim(),
          name: path.basename(frontmostProject.trim(), path.extname(frontmostProject.trim()))
        };
        return;
      }

      // If AppleScript fails, try xcode-select
      const { stdout: developerDir } = await execAsync('xcode-select -p');
      const { stdout: recentProjects } = await execAsync(
        'defaults read com.apple.dt.Xcode IDERecentWorkspaceDocuments || true'
      ).catch(() => ({ stdout: '' }));

      if (recentProjects) {
        // Parse the plist-style output to get the most recent project
        const projectMatch = recentProjects.match(/= \(\s*"([^"]+)"/);
        if (projectMatch) {
          const recentProject = projectMatch[1];
          this.activeProject = {
            path: recentProject,
            name: path.basename(recentProject, path.extname(recentProject))
          };
          return;
        }
      }

      throw new Error('No active Xcode project found. Please either open a project in Xcode or set the project path explicitly.');
    } catch (error) {
      console.error('Error detecting active project:', error);
      throw error; // Re-throw to be handled by constructor
    }
  }

  private async findXcodeProjects(): Promise<XcodeProject[]> {
    try {
      // Find .xcodeproj directories in the current workspace
      const { stdout } = await execAsync('find . -name "*.xcodeproj"');
      const projectPaths = stdout.split('\n').filter(Boolean);

      return projectPaths.map(path => ({
        path: path,
        name: path.split('/').pop()?.replace('.xcodeproj', '') || ''
      }));
    } catch (error) {
      console.error('Error finding Xcode projects:', error);
      return [];
    }
  }

  private async getProjectInfo(projectPath: string) {
    try {
      // Use xcodebuild to get project information
      const { stdout } = await execAsync(`xcodebuild -list -project "${projectPath}"`);
      
      // Parse the output to extract targets, configurations, and schemes
      const info = {
        path: projectPath,
        targets: [] as string[],
        configurations: [] as string[],
        schemes: [] as string[]
      };

      let currentSection = '';
      for (const line of stdout.split('\n')) {
        if (line.includes('Targets:')) {
          currentSection = 'targets';
        } else if (line.includes('Build Configurations:')) {
          currentSection = 'configurations';
        } else if (line.includes('Schemes:')) {
          currentSection = 'schemes';
        } else if (line.trim() && !line.includes(':')) {
          switch (currentSection) {
            case 'targets':
              info.targets.push(line.trim());
              break;
            case 'configurations':
              info.configurations.push(line.trim());
              break;
            case 'schemes':
              info.schemes.push(line.trim());
              break;
          }
        }
      }

      return info;
    } catch (error) {
      console.error('Error getting project info:', error);
      throw error;
    }
  }

  private async analyzeFile(filePath: string) {
    try {
      // Read the file content
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Use xcodebuild to analyze the file
      const { stdout } = await execAsync(
        `xcodebuild analyze -quiet -file "${filePath}"`
      );

      return {
        content: [{
          type: "text",
          text: `Analysis results for ${filePath}:\n${stdout}`
        }]
      };
    } catch (error) {
      console.error('Error analyzing file:', error);
      throw error;
    }
  }

  private async buildProject(configuration: string, scheme: string) {
    try {
      const { stdout, stderr } = await execAsync(
        `xcodebuild -scheme "${scheme}" -configuration "${configuration}" build`
      );

      return {
        content: [{
          type: "text",
          text: `Build results:\n${stdout}\n${stderr}`
        }]
      };
    } catch (error) {
      console.error('Error building project:', error);
      throw error;
    }
  }

  private async readProjectFile(filePath: string) {
    try {
      // Validate the file exists and is within a project
      await this.validateProjectFile(filePath);

      // Read the file content
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Get file info
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath);
      
      // Determine MIME type based on extension
      const mimeType = this.getMimeTypeForExtension(ext);

      return {
        content: [{
          type: "text",
          text: content,
          mimeType,
          metadata: {
            lastModified: stats.mtime,
            size: stats.size
          }
        }]
      };
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }

  private async writeProjectFile(
    filePath: string, 
    content: string, 
    createIfMissing: boolean = false
  ) {
    try {
      // Validate the file location is within a project
      const projectRoot = await this.findProjectRoot(filePath);
      if (!projectRoot) {
        throw new Error('File must be within an Xcode project directory');
      }

      const fileExists = await fs.access(filePath)
        .then(() => true)
        .catch(() => false);

      if (!fileExists && !createIfMissing) {
        throw new Error('File does not exist and createIfMissing is false');
      }

      // Create parent directories if they don't exist
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write the file
      await fs.writeFile(filePath, content, 'utf-8');

      // Update project references if needed
      await this.updateProjectReferences(projectRoot, filePath);

      return {
        content: [{
          type: "text",
          text: `Successfully wrote ${filePath}`
        }]
      };
    } catch (error) {
      console.error('Error writing file:', error);
      throw error;
    }
  }

  private async listProjectFiles(projectPath: string, fileType?: string) {
    try {
      // Validate project path
      if (!projectPath.endsWith('.xcodeproj')) {
        throw new Error('Invalid project path. Must point to .xcodeproj directory');
      }

      // Get cached files or scan project
      let files = this.projectFiles.get(projectPath);
      if (!files) {
        files = await this.scanProjectFiles(projectPath);
        this.projectFiles.set(projectPath, files);
      }

      // Filter by file type if specified
      if (fileType) {
        files = files.filter(file => path.extname(file).slice(1) === fileType);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(files, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error listing project files:', error);
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
        
        // Skip .xcodeproj directories and node_modules
        if (entry.name === 'node_modules' || entry.name.endsWith('.xcodeproj')) {
          continue;
        }

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else {
          result.push(fullPath);
        }
      }
    }

    await scan(projectRoot);
    return result;
  }

  private async validateProjectFile(filePath: string): Promise<void> {
    const projectRoot = await this.findProjectRoot(filePath);
    if (!projectRoot) {
      throw new Error('File must be within an Xcode project directory');
    }

    const exists = await fs.access(filePath)
      .then(() => true)
      .catch(() => false);
      
    if (!exists) {
      throw new Error('File does not exist');
    }
  }

  private async getActiveProjectInfo() {
    if (!this.activeProject) {
      await this.detectActiveProject();
    }

    if (!this.activeProject) {
      return {
        content: [{
          type: "text",
          text: "No active Xcode project detected. Please open a project in Xcode."
        }]
      };
    }

    try {
      const projectInfo = await this.getProjectInfo(this.activeProject.path);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...this.activeProject,
            ...projectInfo
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error getting active project info:', error);
      throw error;
    }
  }

  private async findProjectRoot(filePath: string): Promise<string | null> {
    let currentDir = path.dirname(filePath);
    
    while (currentDir !== '/') {
      const entries = await fs.readdir(currentDir);
      if (entries.some(entry => entry.endsWith('.xcodeproj'))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  private getMimeTypeForExtension(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.swift': 'text/x-swift',
      '.m': 'text/x-objective-c',
      '.h': 'text/x-c',
      '.c': 'text/x-c',
      '.cpp': 'text/x-c++',
      '.json': 'application/json',
      '.plist': 'application/x-plist',
      '.storyboard': 'application/x-xcode-storyboard',
      '.xib': 'application/x-xcode-xib'
    };
    
    return mimeTypes[ext] || 'text/plain';
  }

  private async updateProjectReferences(projectRoot: string, filePath: string) {
    // Get the project.pbxproj path
    const projectFile = await fs.readdir(projectRoot)
      .then(entries => entries.find(e => e.endsWith('.xcodeproj')))
      .then(projDir => path.join(projectRoot, projDir!, 'project.pbxproj'));

    if (!projectFile) {
      throw new Error('Could not find project.pbxproj');
    }

    // TODO: Implement pbxproj parsing and updating
    // This would require handling the project file format to add new files
    // For now, we'll just log that manual project file addition may be needed
    console.error('New file created. You may need to add it to the project in Xcode.');
  }

  private async runTests(testPlan?: string) {
    try {
      const testPlanArg = testPlan ? `-testPlan "${testPlan}"` : '';
      const { stdout, stderr } = await execAsync(
        `xcodebuild test ${testPlanArg}`
      );

      return {
        content: [{
          type: "text",
          text: `Test results:\n${stdout}\n${stderr}`
        }]
      };
    } catch (error) {
      console.error('Error running tests:', error);
      throw error;
    }
  }

  public async start() {
    console.error("Starting Xcode MCP Server...");
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Xcode MCP Server started");
  }
}

// Start the server
const server = new XcodeServer();
server.start().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});