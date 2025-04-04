import * as fs from 'fs/promises';
import * as path from 'path';
import { PathManager } from './pathManager.js';
import { FileOperationError, PathAccessError } from './errors.js';

/**
 * SafeFileOperations provides secure file operations with strict path validation
 */
export class SafeFileOperations {
  constructor(private pathManager: PathManager) {}

  /**
   * Safely read a file with strict path validation
   */
  async readFile(filePath: string): Promise<{ content: string, mimeType: string }> {
    try {
      // Validate path for reading permission
      const validatedPath = this.pathManager.validatePathForReading(filePath);
      
      try {
        // Check if the file exists
        await fs.access(validatedPath);
        
        // Read file content
        const content = await fs.readFile(validatedPath, 'utf-8');
        const ext = path.extname(validatedPath);
        const mimeType = this.getMimeTypeForExtension(ext);
        
        return { content, mimeType };
      } catch (error) {
        if (error instanceof Error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'ENOENT') {
            throw new FileOperationError('read', validatedPath, new Error('File does not exist'));
          }
          if (nodeError.code === 'EACCES') {
            throw new FileOperationError('read', validatedPath, new Error('Permission denied'));
          }
        }
        throw new FileOperationError('read', validatedPath, 
          error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      // Re-throw PathAccessError or wrap other errors
      if (error instanceof PathAccessError || error instanceof FileOperationError) {
        throw error;
      }
      throw new FileOperationError('read', filePath, 
        error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Safely write to a file with strict path validation
   */
  async writeFile(filePath: string, content: string, createIfMissing = false): Promise<void> {
    try {
      // Validate path for writing permission
      const validatedPath = this.pathManager.validatePathForWriting(filePath);
      
      try {
        // Check if the file exists
        const exists = await fs.access(validatedPath).then(() => true).catch(() => false);
        if (!exists && !createIfMissing) {
          throw new FileOperationError('write', validatedPath, 
            new Error('File does not exist and createIfMissing is false'));
        }
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(validatedPath), { recursive: true });
        
        // Write file content
        await fs.writeFile(validatedPath, content, 'utf-8');
      } catch (error) {
        if (error instanceof FileOperationError) {
          throw error;
        }
        
        if (error instanceof Error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'EACCES') {
            throw new FileOperationError('write', validatedPath, new Error('Permission denied'));
          }
          if (nodeError.code === 'EISDIR') {
            throw new FileOperationError('write', validatedPath, new Error('Path is a directory, not a file'));
          }
        }
        
        throw new FileOperationError('write', validatedPath, 
          error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      // Re-throw PathAccessError or wrap other errors
      if (error instanceof PathAccessError || error instanceof FileOperationError) {
        throw error;
      }
      throw new FileOperationError('write', filePath, 
        error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Safely list directory contents with strict path validation
   */
  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      // Validate path for reading permission
      const validatedPath = this.pathManager.validatePathForReading(dirPath);
      
      try {
        // List directory contents
        const entries = await fs.readdir(validatedPath, { withFileTypes: true });
        return entries.map(entry => {
          const fullPath = path.join(validatedPath, entry.name);
          return `${entry.isDirectory() ? 'd' : 'f'} ${fullPath}`;
        });
      } catch (error) {
        if (error instanceof Error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === 'ENOENT') {
            throw new FileOperationError('list', validatedPath, new Error('Directory does not exist'));
          }
          if (nodeError.code === 'EACCES') {
            throw new FileOperationError('list', validatedPath, new Error('Permission denied'));
          }
          if (nodeError.code === 'ENOTDIR') {
            throw new FileOperationError('list', validatedPath, new Error('Path is not a directory'));
          }
        }
        throw new FileOperationError('list', validatedPath, 
          error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      // Re-throw PathAccessError or wrap other errors
      if (error instanceof PathAccessError || error instanceof FileOperationError) {
        throw error;
      }
      throw new FileOperationError('list', dirPath, 
        error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get MIME type for a given file extension
   */
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
      ".xib": "application/x-xcode-xib",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".js": "application/javascript",
      ".ts": "application/typescript",
      ".html": "text/html",
      ".css": "text/css",
      ".xml": "application/xml",
      ".yaml": "application/x-yaml",
      ".yml": "application/x-yaml"
    };
    return mimeTypes[ext] || "text/plain";
  }
} 