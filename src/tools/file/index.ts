import { z } from "zod";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, PathAccessError, FileOperationError, CommandExecutionError } from "../../utils/errors.js";
import { getMimeTypeForExtension, listDirectory, expandPath } from "../../utils/file.js";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);

/**
 * Helper function to format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Interface for file stat information
 */
interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modified?: Date;
  created?: Date;
  permissions?: string;
  owner?: string;
  isHidden: boolean;
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

// formatFileSize function is defined above

/**
 * Get detailed information about a file
 */
async function getFileInfo(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  const baseName = path.basename(filePath);
  const isHidden = baseName.startsWith('.') || /\/\.[^/]+$/.test(filePath);

  let type: 'file' | 'directory' | 'symlink' | 'other' = 'other';
  if (stats.isFile()) type = 'file';
  else if (stats.isDirectory()) type = 'directory';
  else if (stats.isSymbolicLink()) type = 'symlink';

  // Try to get owner info (this might fail in some environments)
  let owner = undefined;
  try {
    const { stdout } = await execAsync(`ls -l "${filePath}" | awk '{print $3}'`);
    owner = stdout.trim();
  } catch {
    // Ignore errors, owner will remain undefined
  }

  // Get permissions
  let permissions = undefined;
  try {
    const { stdout } = await execAsync(`ls -la "${filePath}" | awk '{print $1}'`);
    permissions = stdout.trim();
  } catch {
    // Ignore errors, permissions will remain undefined
  }

  return {
    name: baseName,
    path: filePath,
    type,
    size: stats.size,
    modified: stats.mtime,
    created: stats.birthtime,
    permissions,
    owner,
    isHidden
  };
}

/**
 * Register file operation tools
 */
export function registerFileTools(server: XcodeServer) {
  // Register "read_file"
  server.server.tool(
    "read_file",
    "Reads the contents of a file within the active project or allowed directories.",
    {
      filePath: z.string().describe("Path to the file to read. Can be absolute, relative to active directory, or use ~ for home directory."),
      encoding: z.string().optional().describe("Encoding to use when reading the file (e.g., 'utf-8', 'latin1'). Default is 'utf-8'."),
      asBinary: z.boolean().optional().describe("If true, read the file as binary and return base64-encoded content. Useful for images and other binary files.")
    },
    async ({ filePath, encoding = 'utf-8', asBinary = false }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(filePath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        // Check if file exists
        try {
          await fs.access(resolvedPath);
        } catch {
          throw new FileOperationError('read', resolvedPath, new Error('File does not exist'));
        }

        // Get file stats to check if it's a directory
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          throw new FileOperationError('read', resolvedPath, new Error('Path is a directory, not a file'));
        }

        // Determine MIME type
        const mimeType = getMimeTypeForExtension(path.extname(resolvedPath));

        // Read file based on binary flag
        if (asBinary) {
          // Read as binary and encode as base64
          const buffer = await fs.readFile(resolvedPath);
          const base64Content = buffer.toString('base64');

          return {
            content: [{
              type: "text" as const,
              text: base64Content,
              mimeType: mimeType || 'application/octet-stream',
              metadata: {
                encoding: 'base64',
                isBinary: true,
                size: stats.size,
                lastModified: stats.mtime
              }
            }]
          };
        } else {
          // Read as text with specified encoding
          try {
            const content = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });

            return {
              content: [{
                type: "text" as const,
                text: content,
                mimeType: mimeType || 'text/plain',
                metadata: {
                  encoding,
                  isBinary: false,
                  size: stats.size,
                  lastModified: stats.mtime
                }
              }]
            };
          } catch (error) {
            // If encoding error, suggest binary mode
            if (error instanceof Error && error.message.includes('encoding')) {
              throw new Error(
                `Error reading file with encoding '${encoding}'. This might be a binary file. ` +
                `Try using asBinary=true to read it as binary data.`
              );
            }
            throw error;
          }
        }
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
    "Writes or updates the content of a file within the active project or allowed directories.",
    {
      path: z.string().describe("Path to the file to update or create. Can be absolute, relative to active directory, or use ~ for home directory."),
      filePath: z.string().optional().describe("Alias for 'path' parameter (deprecated)"),
      content: z.string().describe("The content to be written to the file."),
      encoding: z.string().optional().describe("Encoding to use when writing the file (e.g., 'utf-8', 'latin1'). Default is 'utf-8'."),
      fromBase64: z.boolean().optional().describe("If true, decode the content from base64 before writing. Useful for binary files."),
      createIfMissing: z.boolean().or(z.string().transform(val => val === 'true')).optional().describe("If true, creates the file if it doesn't exist."),
      createPath: z.boolean().optional().describe("If true, creates the directory path if it doesn't exist.")
    },
    async ({ path: targetPath, filePath, content, encoding = 'utf-8', fromBase64 = false, createIfMissing = false, createPath = true }) => {
      try {
        // Use filePath as fallback for backward compatibility
        const pathToUse = targetPath || filePath;
        if (!pathToUse) {
          throw new Error("Either 'path' or 'filePath' must be provided");
        }

        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(pathToUse);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForWriting(resolvedPath);

        // Check if file exists
        const fileExists = await fs.access(resolvedPath).then(() => true).catch(() => false);

        if (!fileExists && !createIfMissing) {
          throw new FileOperationError('write', resolvedPath, new Error('File does not exist and createIfMissing is false'));
        }

        // Create directory path if needed and requested
        if (createPath) {
          try {
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          } catch (mkdirError) {
            throw new FileOperationError('create directory for', resolvedPath,
              mkdirError instanceof Error ? mkdirError : new Error(String(mkdirError)));
          }
        }

        // Write file based on fromBase64 flag
        if (fromBase64) {
          // Decode base64 content and write as binary
          try {
            const buffer = Buffer.from(content, 'base64');
            await fs.writeFile(resolvedPath, buffer);
          } catch (error) {
            if (error instanceof Error && error.message.includes('base64')) {
              throw new Error('Invalid base64 content. Make sure the content is properly base64-encoded.');
            }
            throw error;
          }
        } else {
          // Write as text with specified encoding
          await fs.writeFile(resolvedPath, content, { encoding: encoding as BufferEncoding });
        }

        // Get file stats for response
        const stats = await fs.stat(resolvedPath);

        return {
          content: [{
            type: "text" as const,
            text: `Successfully wrote ${resolvedPath} (${formatFileSize(stats.size)})`
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

  // Register "copy_file"
  server.server.tool(
    "copy_file",
    "Copies a file or directory to a new location within allowed directories.",
    {
      source: z.string().describe("Source path. Can be absolute, relative to active directory, or use ~ for home directory."),
      destination: z.string().describe("Destination path. Can be absolute, relative to active directory, or use ~ for home directory."),
      recursive: z.boolean().optional().describe("If true, copy directories recursively")
    },
    async ({ source, destination, recursive = false }) => {
      try {
        // Expand tildes first in both paths
        const expandedSource = server.pathManager.expandPath(source);
        const expandedDest = server.pathManager.expandPath(destination);

        // Resolve and validate paths
        const resolvedSource = server.directoryState.resolvePath(expandedSource);
        server.pathManager.validatePathForReading(resolvedSource);

        const resolvedDestination = server.directoryState.resolvePath(expandedDest);
        server.pathManager.validatePathForWriting(resolvedDestination);

        // Check if source exists
        const sourceExists = await fileExists(resolvedSource);
        if (!sourceExists) {
          throw new FileOperationError('copy', resolvedSource, new Error('Source file or directory does not exist'));
        }

        // Check if source is directory
        const sourceStats = await fs.stat(resolvedSource);
        const isDirectory = sourceStats.isDirectory();

        if (isDirectory && !recursive) {
          throw new FileOperationError('copy directory', resolvedSource,
            new Error('Source is a directory. Use recursive=true to copy directories.'));
        }

        // Create destination directory if needed
        let targetPath = resolvedDestination;

        // If destination exists and is a directory, copy into it
        try {
          const destStats = await fs.stat(resolvedDestination);
          if (destStats.isDirectory()) {
            targetPath = path.join(resolvedDestination, path.basename(resolvedSource));
          }
        } catch {
          // Destination doesn't exist, use the full path
          await fs.mkdir(path.dirname(resolvedDestination), { recursive: true });
        }

        if (isDirectory) {
          // Use cp with recursive flag for directories
          const { stdout, stderr } = await execAsync(`cp -R "${resolvedSource}" "${targetPath}"`);
          if (stderr) {
            throw new FileOperationError('copy directory', resolvedSource, new Error(stderr));
          }
        } else {
          // Copy file
          await fs.copyFile(resolvedSource, targetPath);
        }

        return {
          content: [{
            type: "text",
            text: `Successfully copied ${isDirectory ? 'directory' : 'file'} from ${resolvedSource} to ${targetPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error copying file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "move_file"
  server.server.tool(
    "move_file",
    "Moves a file or directory to a new location within allowed directories.",
    {
      source: z.string().describe("Source path. Can be absolute, relative to active directory, or use ~ for home directory."),
      destination: z.string().describe("Destination path. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ source, destination }) => {
      try {
        // Expand tildes first in both paths
        const expandedSource = server.pathManager.expandPath(source);
        const expandedDest = server.pathManager.expandPath(destination);

        // Resolve and validate paths
        const resolvedSource = server.directoryState.resolvePath(expandedSource);
        server.pathManager.validatePathForWriting(resolvedSource); // Need write access to remove source

        const resolvedDestination = server.directoryState.resolvePath(expandedDest);
        server.pathManager.validatePathForWriting(resolvedDestination);

        // Check if source exists
        const sourceExists = await fileExists(resolvedSource);
        if (!sourceExists) {
          throw new FileOperationError('move', resolvedSource, new Error('Source file or directory does not exist'));
        }

        // Create destination directory if needed
        let targetPath = resolvedDestination;

        // If destination exists and is a directory, move into it
        try {
          const destStats = await fs.stat(resolvedDestination);
          if (destStats.isDirectory()) {
            targetPath = path.join(resolvedDestination, path.basename(resolvedSource));
          }
        } catch {
          // Destination doesn't exist, use the full path
          await fs.mkdir(path.dirname(resolvedDestination), { recursive: true });
        }

        // Move file or directory
        await fs.rename(resolvedSource, targetPath);

        return {
          content: [{
            type: "text",
            text: `Successfully moved from ${resolvedSource} to ${targetPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error moving file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "delete_file"
  server.server.tool(
    "delete_file",
    "Deletes a file or directory within allowed directories.",
    {
      path: z.string().describe("Path to delete. Can be absolute, relative to active directory, or use ~ for home directory."),
      recursive: z.boolean().optional().describe("If true, delete directories recursively")
    },
    async ({ path: targetPath, recursive = false }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(targetPath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForWriting(resolvedPath);

        // Check if path exists
        const pathExists = await fileExists(resolvedPath);
        if (!pathExists) {
          throw new FileOperationError('delete', resolvedPath, new Error('File or directory does not exist'));
        }

        // Check if it's a directory
        const stats = await fs.stat(resolvedPath);
        const isDirectory = stats.isDirectory();

        if (isDirectory) {
          if (recursive) {
            await fs.rm(resolvedPath, { recursive: true });
          } else {
            try {
              await fs.rmdir(resolvedPath);
            } catch (error) {
              if (error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY') {
                throw new FileOperationError('delete', resolvedPath,
                  new Error('Directory is not empty. Use recursive=true to delete non-empty directories.'));
              }
              throw error;
            }
          }
        } else {
          await fs.unlink(resolvedPath);
        }

        return {
          content: [{
            type: "text",
            text: `Successfully deleted ${isDirectory ? 'directory' : 'file'} at ${resolvedPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error deleting file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "create_directory"
  server.server.tool(
    "create_directory",
    "Creates a new directory within allowed directories.",
    {
      path: z.string().describe("Path to create. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ path: dirPath }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(dirPath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForWriting(resolvedPath);

        // Create directory
        await fs.mkdir(resolvedPath, { recursive: true });

        return {
          content: [{
            type: "text",
            text: `Successfully created directory at ${resolvedPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error creating directory: ${error instanceof Error ? error.message : String(error)}`);
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

        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(projectPath);

        // Use server.pathManager to resolve and validate the path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        const validatedPath = server.pathManager.validatePathForReading(resolvedPath);

        // Check that it's an Xcode project
        if (!validatedPath.endsWith(".xcodeproj")) {
          throw new Error("Path must be to an .xcodeproj directory");
        }

        // Get the project root directory
        const projectRoot = path.dirname(validatedPath);

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
      path: z.string().describe("Path to the directory to list. Can be absolute, relative to active directory, or use ~ for home directory."),
      showHidden: z.boolean().optional().describe("If true, include hidden files (starting with .)"),
      format: z.enum(['simple', 'detailed']).optional().describe("Format of the output: simple (names only) or detailed (with file information)")
    },
    async ({ path: dirPath, showHidden = false, format = 'simple' }) => {
      try {
        // Default to current active directory if path is empty or just a dot
        if (!dirPath || dirPath === ".") {
          dirPath = server.directoryState.getActiveDirectory();
        }

        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(dirPath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        // Check if path exists and is a directory
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new FileOperationError('list', resolvedPath, new Error('Path is not a directory'));
        }

        // Read directory entries
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

        // Filter hidden files if needed
        const filteredEntries = showHidden
          ? entries
          : entries.filter(entry => !entry.name.startsWith('.'));

        if (format === 'simple') {
          // Simple format: just names
          const names = filteredEntries.map(entry => {
            return entry.isDirectory() ? `${entry.name}/` : entry.name;
          });

          return {
            content: [{
              type: "text",
              text: names.join('\n')
            }]
          };
        } else {
          // Detailed format: with file information
          const detailedInfo: FileInfo[] = [];

          for (const entry of filteredEntries) {
            const entryPath = path.join(resolvedPath, entry.name);
            try {
              const info = await getFileInfo(entryPath);
              detailedInfo.push(info);
            } catch (error) {
              console.error(`Error getting info for ${entryPath}:`, error);
              // Add minimal info if detailed info fails
              detailedInfo.push({
                name: entry.name,
                path: entryPath,
                type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
                isHidden: entry.name.startsWith('.')
              });
            }
          }

          // Sort: directories first, then files
          detailedInfo.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });

          // Format the output
          const formattedInfo = detailedInfo.map(info => {
            const sizeStr = info.size !== undefined ? formatFileSize(info.size) : 'N/A';
            const modifiedStr = info.modified ? info.modified.toLocaleString() : 'N/A';
            const typeStr = info.type === 'directory' ? 'dir' : info.type === 'symlink' ? 'link' : 'file';

            return `${info.name.padEnd(30)} ${typeStr.padEnd(6)} ${sizeStr.padEnd(10)} ${modifiedStr}`;
          });

          return {
            content: [{
              type: "text",
              text: `Listing of ${resolvedPath}:\n\n` +
                    `${'Name'.padEnd(30)} ${'Type'.padEnd(6)} ${'Size'.padEnd(10)} ${'Modified'.padEnd(10)}\n` +
                    `${'-'.repeat(60)}\n` +
                    formattedInfo.join('\n')
            }]
          };
        }
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

  // Register "get_file_info"
  server.server.tool(
    "get_file_info",
    "Gets detailed information about a file or directory.",
    {
      path: z.string().describe("Path to the file or directory. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ path: filePath }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(filePath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        // Check if path exists
        const pathExists = await fileExists(resolvedPath);
        if (!pathExists) {
          throw new FileOperationError('info', resolvedPath, new Error('File or directory does not exist'));
        }

        // Get file information
        const info = await getFileInfo(resolvedPath);

        // Format additional information for better readability
        let additionalInfo = '';

        // For files, get mime type
        if (info.type === 'file') {
          const mimeType = getMimeTypeForExtension(path.extname(resolvedPath));
          if (mimeType) {
            additionalInfo += `MIME Type: ${mimeType}\n`;
          }

          // For text files, try to show encoding and line count
          if (mimeType && mimeType.startsWith('text/') && info.size && info.size < 10 * 1024 * 1024) {
            try {
              const { stdout: wc } = await execAsync(`wc -l "${resolvedPath}" | awk '{print $1}'`);
              additionalInfo += `Line Count: ${wc.trim()}\n`;

              const { stdout: file } = await execAsync(`file -b "${resolvedPath}"`);
              additionalInfo += `File Type: ${file.trim()}\n`;
            } catch {
              // Ignore errors for these extra info commands
            }
          }
        }

        // For directories, count items
        if (info.type === 'directory') {
          try {
            const entries = await fs.readdir(resolvedPath);
            additionalInfo += `Contains: ${entries.length} items\n`;
          } catch {
            // Ignore errors
          }
        }

        return {
          content: [{
            type: "text",
            text: `File Information for ${resolvedPath}:\n\n` +
                 `Name: ${info.name}\n` +
                 `Type: ${info.type}\n` +
                 `Size: ${info.size !== undefined ? formatFileSize(info.size) : 'N/A'}\n` +
                 `Created: ${info.created ? info.created.toLocaleString() : 'N/A'}\n` +
                 `Modified: ${info.modified ? info.modified.toLocaleString() : 'N/A'}\n` +
                 `Permissions: ${info.permissions || 'N/A'}\n` +
                 `Owner: ${info.owner || 'N/A'}\n` +
                 `Hidden: ${info.isHidden ? 'Yes' : 'No'}\n` +
                 `${additionalInfo}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          throw new Error(`Error getting file info: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "find_files"
  server.server.tool(
    "find_files",
    "Searches for files matching a pattern in a directory.",
    {
      path: z.string().describe("Directory to search in. Can be absolute, relative to active directory, or use ~ for home directory."),
      pattern: z.string().describe("Glob pattern to match files (e.g., '*.swift' or '**/*.json')"),
      maxDepth: z.number().optional().describe("Maximum directory depth to search"),
      showHidden: z.boolean().optional().describe("If true, include hidden files in the search")
    },
    async ({ path: dirPath, pattern, maxDepth, showHidden = false }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(dirPath || '.');

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        // Validate the directory exists
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new FileOperationError('find', resolvedPath, new Error('Path is not a directory'));
        }

        // Use find command with appropriate options
        let findCmd = `find "${resolvedPath}" -type f`;

        // Add maxDepth if specified
        if (maxDepth !== undefined) {
          findCmd += ` -maxdepth ${maxDepth}`;
        }

        // Exclude hidden files/dirs if not showing hidden
        if (!showHidden) {
          findCmd += ` -not -path "*/\\.*"`;
        }

        // Add pattern matching
        if (pattern) {
          // Convert glob pattern to find-compatible pattern
          if (pattern.includes('*') || pattern.includes('?')) {
            // For simple glob patterns, use -name
            if (!pattern.includes('/**/')) {
              findCmd += ` -name "${pattern}"`;
            } else {
              // For more complex patterns with ** (any depth), we need to post-process
              // Remove the ** handling and filter results after
            }
          } else {
            // For exact matches, use -name
            findCmd += ` -name "${pattern}"`;
          }
        }

        try {
          const { stdout, stderr } = await execAsync(findCmd);

          if (stderr) {
            console.error(`Warning from find command: ${stderr}`);
          }

          let files = stdout.trim().split('\n').filter(Boolean);

          // Post-process for complex patterns with **
          if (pattern && pattern.includes('/**/')) {
            const regexPattern = pattern
              .replace(/\./g, '\\.')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.')
              .replace(/\/\*\*\//g, '(/.*)?/');

            const regex = new RegExp(`^${regexPattern}$`);
            files = files.filter(file => regex.test(file));
          }

      return {
        content: [{
          type: "text",
              text: files.length > 0
                ? `Found ${files.length} files matching pattern '${pattern}':\n\n${files.join('\n')}`
                : `No files found matching pattern '${pattern}' in ${resolvedPath}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'find',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else if (error instanceof CommandExecutionError) {
          throw new Error(`Command execution error: ${error.message}`);
        } else {
          throw new Error(`Error finding files: ${error instanceof Error ? error.message : String(error)}`);
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
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(inputPath);

        // Then use ProjectDirectoryState to resolve relative to active dir
        const resolvedPath = server.directoryState.resolvePath(expandedPath);

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

  // Register "check_file_exists"
  server.server.tool(
    "check_file_exists",
    "Checks if a file or directory exists at the specified path.",
    {
      path: z.string().describe("Path to check. Can be absolute, relative to active directory, or use ~ for home directory.")
    },
    async ({ path: filePath }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(filePath);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        try {
          await fs.access(resolvedPath);

          // If we get here, the file exists - check what type it is
          const stats = await fs.stat(resolvedPath);
          const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                exists: true,
                path: resolvedPath,
                type
              }, null, 2)
            }]
          };
        } catch {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                exists: false,
                path: resolvedPath
              }, null, 2)
            }]
          };
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw new Error(`Error checking if file exists: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  );

  // Register "search_in_files"
  server.server.tool(
    "search_in_files",
    "Searches for text content within files in a directory.",
    {
      directory: z.string().describe("Directory to search in. Can be absolute, relative to active directory, or use ~ for home directory."),
      pattern: z.string().describe("File pattern to match (e.g., '*.swift', '*.{js,ts}')"),
      searchText: z.string().describe("Text or regular expression to search for within the files"),
      isRegex: z.boolean().optional().describe("If true, treat searchText as a regular expression"),
      caseSensitive: z.boolean().optional().describe("If true, perform a case-sensitive search"),
      maxResults: z.number().optional().describe("Maximum number of results to return"),
      includeHidden: z.boolean().optional().describe("If true, include hidden files in the search")
    },
    async ({ directory, pattern, searchText, isRegex = false, caseSensitive = false, maxResults = 100, includeHidden = false }) => {
      try {
        // Expand tilde first
        const expandedPath = server.pathManager.expandPath(directory);

        // Resolve and validate path
        const resolvedPath = server.directoryState.resolvePath(expandedPath);
        server.pathManager.validatePathForReading(resolvedPath);

        // Check if directory exists
        try {
          const stats = await fs.stat(resolvedPath);
          if (!stats.isDirectory()) {
            throw new FileOperationError('search', resolvedPath, new Error('Path is not a directory'));
          }
        } catch (error) {
          if (error instanceof FileOperationError) throw error;
          throw new FileOperationError('search', resolvedPath, new Error('Directory does not exist'));
        }

        // Prepare the search regex
        let searchRegex: RegExp;
        if (isRegex) {
          try {
            searchRegex = new RegExp(searchText, caseSensitive ? 'g' : 'gi');
          } catch (error) {
            throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          // Escape special regex characters for literal search
          const escapedText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          searchRegex = new RegExp(escapedText, caseSensitive ? 'g' : 'gi');
        }

        // Find matching files
        const findCmd = `find "${resolvedPath}" -type f ${includeHidden ? '' : '-not -path "*/\\.*"'} -name "${pattern}"${maxResults ? ` | head -n ${maxResults}` : ''}`;

        let files: string[];
        try {
          const { stdout } = await execAsync(findCmd);
          files = stdout.trim().split('\n').filter(Boolean);
        } catch (error) {
          throw new CommandExecutionError(
            'find',
            error instanceof Error ? error.message : String(error)
          );
        }

        if (files.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No files matching pattern '${pattern}' found in ${resolvedPath}`
            }]
          };
        }

        // Search within each file
        const results: Array<{ file: string, matches: Array<{ line: number, content: string, match: string }> }> = [];
        let totalMatches = 0;

        for (const file of files) {
          try {
            // Skip directories and non-text files
            const stats = await fs.stat(file);
            if (stats.isDirectory()) continue;

            // Skip files that are likely binary
            const mimeType = getMimeTypeForExtension(path.extname(file));
            if (mimeType && !mimeType.startsWith('text/') &&
                !mimeType.includes('javascript') &&
                !mimeType.includes('json') &&
                !mimeType.includes('xml') &&
                !mimeType.includes('html')) {
              continue;
            }

            // Read file content
            let content: string;
            try {
              content = await fs.readFile(file, 'utf-8');
            } catch {
              // Skip files that can't be read as text
              continue;
            }

            // Search for matches
            const lines = content.split('\n');
            const fileMatches: Array<{ line: number, content: string, match: string }> = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              searchRegex.lastIndex = 0; // Reset regex state

              let match;
              while ((match = searchRegex.exec(line)) !== null) {
                fileMatches.push({
                  line: i + 1, // 1-based line number
                  content: line.trim(),
                  match: match[0]
                });

                // Avoid infinite loops with zero-width matches
                if (match.index === searchRegex.lastIndex) {
                  searchRegex.lastIndex++;
                }

                // Check if we've hit the max results
                totalMatches++;
                if (maxResults && totalMatches >= maxResults) break;
              }

              if (maxResults && totalMatches >= maxResults) break;
            }

            if (fileMatches.length > 0) {
              results.push({
                file: file,
                matches: fileMatches
              });
            }

            if (maxResults && totalMatches >= maxResults) break;
          } catch {
            // Skip files that cause errors
            continue;
          }
        }

        // Format the results
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No matches found for '${searchText}' in files matching '${pattern}' in ${resolvedPath}`
            }]
          };
        }

        let output = `Found ${totalMatches} match${totalMatches === 1 ? '' : 'es'} for '${searchText}' in ${results.length} file${results.length === 1 ? '' : 's'}:\n\n`;

        for (const result of results) {
          const relativePath = path.relative(resolvedPath, result.file);
          output += `${relativePath}:\n`;

          for (const match of result.matches) {
            output += `  Line ${match.line}: ${match.content.substring(0, 100)}${match.content.length > 100 ? '...' : ''}\n`;
          }

          output += '\n';
        }

        if (maxResults && totalMatches >= maxResults) {
          output += `\nSearch stopped after reaching maximum of ${maxResults} results.`;
        }

        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else if (error instanceof CommandExecutionError) {
          throw new Error(`Command execution error: ${error.message}`);
        } else {
          throw new Error(`Error searching in files: ${error instanceof Error ? error.message : String(error)}`);
        }
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
        console.error(`Warning: Could not update project references: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
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
  try {
    // Find the .xcodeproj directory
    const projectDirName = await fs.readdir(projectRoot)
      .then(entries => entries.find(e => e.endsWith(".xcodeproj")));

    if (!projectDirName) {
      console.error("Could not find .xcodeproj directory in project root");
      return;
    }

    const projectDir = path.join(projectRoot, projectDirName);
    const pbxprojPath = path.join(projectDir, "project.pbxproj");

    // Check if project.pbxproj exists
    try {
      await fs.access(pbxprojPath);
    } catch {
      console.error("Could not find project.pbxproj file");
      return;
    }

    // Get the relative path from the project root to the file
    const relativeFilePath = path.relative(projectRoot, filePath);

    // Check if the file is already in the project
    const pbxprojContent = await fs.readFile(pbxprojPath, 'utf-8');

    // Simple check if the file path is already in the project file
    if (pbxprojContent.includes(relativeFilePath)) {
      console.error(`File ${relativeFilePath} is already referenced in the project`);
      return;
    }

    // For now, we'll just notify that the file needs to be added manually
    // In the future, we could use a library like simple-plist or xcode to modify the project file
    console.error(`New file created at ${relativeFilePath}. You may need to add it to the project in Xcode manually.`);

    // Create a temporary AppleScript to add the file to the project
    // This is a more advanced approach that requires Xcode to be running
    try {
      // Check if Xcode is running
      const { stdout: isRunning } = await execAsync('pgrep -x Xcode || echo "not running"');

      if (isRunning.trim() === 'not running') {
        console.error('Xcode is not running. Cannot automatically add file to project.');
        return;
      }

      // Create a temporary AppleScript file
      const tempScriptPath = path.join(projectRoot, 'temp_add_file.scpt');
      const scriptContent = `
        tell application "Xcode"
          open "${path.join(projectRoot, projectDirName)}"
          delay 1
          tell application "System Events"
            tell process "Xcode"
              -- Try to add the file using the File menu
              click menu item "Add Files to \"${path.basename(projectDirName, '.xcodeproj')}\"..." of menu "File" of menu bar 1
              delay 1
              -- This part is tricky as the file dialog is system-dependent
              -- For now, we'll just notify the user
            end tell
          end tell
        end tell
      `;

      await fs.writeFile(tempScriptPath, scriptContent, 'utf-8');

      // We won't actually execute this script automatically as it's too intrusive
      // Just clean up the temporary file
      await fs.unlink(tempScriptPath);
    } catch (error) {
      console.error('Failed to create AppleScript for adding file:', error);
    }
  } catch (error) {
    console.error(`Error updating project references: ${error instanceof Error ? error.message : String(error)}`);
  }
}