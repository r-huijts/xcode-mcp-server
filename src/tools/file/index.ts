import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, PathAccessError, FileOperationError } from "../../utils/errors.js";
import { getMimeTypeForExtension, listDirectory, expandPath } from "../../utils/file.js";

/**
 * Register file operation tools
 */
export function registerFileTools(server: XcodeServer) {
  // Register "read_file"
  server.server.tool(
    "read_file",
    "Reads the contents of a file within the active Xcode project.",
    {
      filePath: z.string().describe("Path to the file to read. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ filePath }) => {
      try {
        // Use our SafeFileOperations to read the file
        const result = await server.fileOperations.readFile(filePath);
        
        return {
          content: [{
            type: "text" as const,
            text: result.content,
            mimeType: result.mimeType
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "write_file"
  server.server.tool(
    "write_file",
    "Writes or updates the content of a file in the active Xcode project.",
    {
      path: z.string().describe("Path to the file to update or create. Can be absolute, relative to active directory, or use ~ for home directory."),
      filePath: z.string().optional().describe("Alias for 'path' parameter (deprecated)"),
      content: z.string().describe("The content to be written to the file."),
      createIfMissing: z.boolean().or(z.string().transform(val => val === 'true')).optional().describe("If true, creates the file if it doesn't exist.")
    },
    async ({ path: targetPath, filePath, content, createIfMissing = false }) => {
      try {
        // Use filePath as fallback for backward compatibility
        const pathToUse = targetPath || filePath;
        if (!pathToUse) {
          throw new Error("Either 'path' or 'filePath' must be provided");
        }
        
        // Use our SafeFileOperations to write the file
        await server.fileOperations.writeFile(pathToUse, content, createIfMissing);
        
        return {
          content: [{
            type: "text" as const,
            text: `Successfully wrote ${pathToUse}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error writing file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "list_project_files"
  server.server.tool(
    "list_project_files",
    "Lists all files within an Xcode project.",
    {
      projectPath: z.string().describe("Path to the .xcodeproj directory of the project. Can be absolute, relative to active directory, or use ~ for home directory."),
      fileType: z.string().optional().describe("Optional file extension filter.")
    },
    async ({ projectPath, fileType }) => {
      try {
        if (!server.activeProject) {
          throw new ProjectNotFoundError();
        }
        
        // Use server.pathManager to resolve and validate the path
        const expandedPath = server.pathManager.validatePathForReading(projectPath);
        
        // Check that it's an Xcode project
        if (!expandedPath.endsWith(".xcodeproj")) {
          throw new Error("Path must be to an .xcodeproj directory");
        }
        
        // Get the project root directory
        const projectRoot = path.dirname(expandedPath);
        
        // Recursively list files in the project directory
        async function listFilesRecursively(directory: string): Promise<string[]> {
          const files: string[] = [];
          const entries = await fs.readdir(directory, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            
            // Skip .xcodeproj and other hidden directories
            if (entry.isDirectory()) {
              if (!entry.name.startsWith(".") && !entry.name.endsWith(".xcodeproj")) {
                files.push(...await listFilesRecursively(fullPath));
              }
            } else {
              // If fileType is specified, filter by extension
              if (!fileType || entry.name.endsWith(`.${fileType}`)) {
                files.push(fullPath);
              }
            }
          }
          
          return files;
        }
        
        const files = await listFilesRecursively(projectRoot);
        
        return {
          content: [{
            type: "text" as const,
            text: files.join("\n")
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error listing project files: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "list_directory"
  server.server.tool(
    "list_directory",
    "Lists the contents of a directory, showing both files and subdirectories.",
    {
      path: z.string().describe("Path to the directory to list. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ path: dirPath }) => {
      try {
        // Default to current active directory if path is empty or just a dot
        if (!dirPath || dirPath === ".") {
          dirPath = server.directoryState.getActiveDirectory();
        }
        
        // Use our SafeFileOperations to list directory
        const entries = await server.fileOperations.listDirectory(dirPath);
        
        return {
          content: [{
            type: "text",
            text: entries.join('\n')
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error listing directory: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );
  
  // Register a new "resolve_path" tool
  server.server.tool(
    "resolve_path",
    "Resolves a path, taking into account the active directory and current project.",
    {
      path: z.string().describe("Path to resolve. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ path: inputPath }) => {
      try {
        // First use ProjectDirectoryState to resolve relative to active dir
        const resolvedPath = server.directoryState.resolvePath(inputPath);
        
        // Check if it exists and what type it is
        let fileInfo = "Path does not exist";
        
        try {
          const stats = await fs.stat(resolvedPath);
          if (stats.isDirectory()) {
            fileInfo = "Directory";
          } else if (stats.isFile()) {
            fileInfo = "File";
          } else {
            fileInfo = "Special file type";
          }
        } catch (_) {
          // Path doesn't exist, use the default message
        }
        
        // Check if path is within allowed boundaries
        const isAllowed = server.pathManager.isPathAllowed(resolvedPath);
        const isWritable = server.pathManager.isPathAllowed(resolvedPath, true);
        
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              inputPath,
              resolvedPath,
              type: fileInfo,
              readAccess: isAllowed,
              writeAccess: isWritable,
              activeDirectory: server.directoryState.getActiveDirectory(),
              projectRoot: server.pathManager.getActiveProjectRoot()
            }, null, 2)
          }]
        };
      } catch (error) {
        throw new Error(`Error resolving path: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

/**
 * Helper function to get the project root directory
 */
function getProjectRoot(projectPath: string): string {
  // The project root is the directory containing the .xcodeproj
  return path.dirname(projectPath);
}

/**
 * Helper function to read a file from the project
 */
async function readProjectFile(server: XcodeServer, filePath: string) {
  try {
    if (!server.activeProject) throw new ProjectNotFoundError();
    
    const projectRoot = getProjectRoot(server.activeProject.path);
    const projectName = path.basename(projectRoot);
    
    // Normalize the input path and remove any leading ~/
    let normalizedPath = path.normalize(filePath.replace(/^~\//, ''));
    
    // If the path contains the full project structure, extract just the relevant part
    const projectParts = normalizedPath.split('/');
    const projectNameIndex = projectParts.lastIndexOf(projectName);
    if (projectNameIndex !== -1) {
      // Take only the parts after the first occurrence of the project name
      normalizedPath = projectParts.slice(projectNameIndex).join('/');
    } else if (!normalizedPath.includes('/')) {
      // If it's just a filename without path, assume it's in the source directory
      // The source directory is in the inner project folder
      normalizedPath = path.join(projectName, normalizedPath);
    }
    
    // Join with project root to get the absolute path
    const absolutePath = path.join(projectRoot, normalizedPath);
    
    // Check if path is within project directory
    if (!absolutePath.startsWith(projectRoot)) {
      throw new PathAccessError(absolutePath, "File must be within the active project directory");
    }
    
    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      const stats = await fs.stat(absolutePath);
      const mimeType = getMimeTypeForExtension(path.extname(absolutePath));
      
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

/**
 * Helper function to write a file to the project
 */
async function writeProjectFile(server: XcodeServer, filePath: string, content: string, createIfMissing: boolean = false) {
  try {
    if (!server.activeProject) throw new ProjectNotFoundError();
    
    const projectRoot = getProjectRoot(server.activeProject.path);
    const projectName = path.basename(projectRoot);
    
    // Normalize the input path and remove any leading ~/
    let normalizedPath = path.normalize(filePath.replace(/^~\//, ''));
    
    // If the path contains the full project structure, extract just the relevant part
    const projectParts = normalizedPath.split('/');
    const projectNameIndex = projectParts.lastIndexOf(projectName);
    if (projectNameIndex !== -1) {
      // Take only the parts after the first occurrence of the project name
      normalizedPath = projectParts.slice(projectNameIndex).join('/');
    }
    
    // Join with project root to get the absolute path
    const absolutePath = path.join(projectRoot, normalizedPath);
    
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
        await updateProjectReferences(projectRoot, absolutePath);
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

/**
 * Helper function to list all files in a project
 */
async function listProjectFiles(server: XcodeServer, projectPath: string, fileType?: string) {
  try {
    if (!server.activeProject) throw new Error("No active project set.");
    const projectRoot = getProjectRoot(server.activeProject.path);
    let files = server.projectFiles.get(projectRoot);
    if (!files) {
      files = await scanProjectFiles(projectRoot);
      server.projectFiles.set(projectRoot, files);
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

/**
 * Helper function to scan all files in a project
 */
async function scanProjectFiles(projectPath: string): Promise<string[]> {
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

/**
 * Helper function to update project references
 */
async function updateProjectReferences(projectRoot: string, filePath: string) {
  const projectDir = await fs.readdir(projectRoot)
    .then(entries => entries.find(e => e.endsWith(".xcodeproj")))
    .then(projDir => path.join(projectRoot, projDir!, "project.pbxproj"));
  if (!projectDir) throw new Error("Could not find project.pbxproj");
  // TODO: Use a dedicated library to update the pbxproj file if needed.
  console.error("New file created. You may need to add it to the project in Xcode manually.");
} 