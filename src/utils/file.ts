import * as path from 'path';
import * as fs from 'fs/promises';
import { FileOperationError, PathAccessError } from './errors.js';
import * as os from 'os';

/**
 * Expands a path, resolving environment variables and tilde
 */
export function expandPath(inputPath: string): string {
  // Handle tilde expansion
  if (inputPath.startsWith('~')) {
    inputPath = path.join(os.homedir(), inputPath.slice(1));
  }
  
  // Handle environment variables
  inputPath = inputPath.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    return process.env[name] || '';
  });
  
  // Handle ${VAR} style variables
  inputPath = inputPath.replace(/\${([A-Za-z_][A-Za-z0-9_]*)}/g, (_, name) => {
    return process.env[name] || '';
  });
  
  return path.resolve(inputPath);
}

/**
 * Check if a path is allowed based on config and active project
 */
export function isPathAllowed(targetPath: string, projectsBaseDir?: string, activeProjectPath?: string): boolean {
  // If projectsBaseDir is set, allow paths within it
  if (projectsBaseDir) {
    // Allow the projects base dir itself and any subdirectories
    if (targetPath === projectsBaseDir || targetPath.startsWith(projectsBaseDir + path.sep)) {
      return true;
    }
  }
  
  // If there's an active project, allow paths within its directory
  if (activeProjectPath) {
    const projectDir = path.dirname(activeProjectPath);
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

/**
 * Get MIME type for a given file extension
 */
export function getMimeTypeForExtension(ext: string): string {
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

/**
 * List directory contents with safety checks
 */
export async function listDirectory(dirPath: string, projectsBaseDir?: string, activeProjectPath?: string): Promise<string[]> {
  try {
    const targetPath = path.resolve(dirPath);
    if (!isPathAllowed(targetPath, projectsBaseDir, activeProjectPath)) {
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

/**
 * Check if a file is inside an Xcode project
 */
export async function isInXcodeProject(filePath: string): Promise<boolean> {
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