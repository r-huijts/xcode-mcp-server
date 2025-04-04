import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { PathAccessError, FileOperationError } from './errors.js';
import { ServerConfig } from '../types/index.js';

/**
 * PathManager centralizes all path-related operations for consistent and secure path handling
 */
export class PathManager {
  private projectsBaseDir: string | undefined;
  private activeProjectPath: string | undefined;
  private activeProjectRoot: string | undefined;
  private serverRoot: string;
  private directoryHistory: string[] = [];

  constructor(config: ServerConfig = {}) {
    this.projectsBaseDir = config.projectsBaseDir ? this.expandPath(config.projectsBaseDir) : undefined;
    this.serverRoot = process.cwd();
  }

  /**
   * Set the active project path and update the project root
   */
  setActiveProject(projectPath: string): void {
    const expandedPath = this.expandPath(projectPath);
    this.activeProjectPath = expandedPath;
    this.activeProjectRoot = path.dirname(expandedPath);
  }

  /**
   * Set the projects base directory
   */
  setProjectsBaseDir(dirPath: string): void {
    this.projectsBaseDir = this.expandPath(dirPath);
  }

  /**
   * Get the active project path
   */
  getActiveProjectPath(): string | undefined {
    return this.activeProjectPath;
  }

  /**
   * Get the active project root directory
   */
  getActiveProjectRoot(): string | undefined {
    return this.activeProjectRoot;
  }

  /**
   * Get the projects base directory
   */
  getProjectsBaseDir(): string | undefined {
    return this.projectsBaseDir;
  }

  /**
   * Expands a path, resolving environment variables and tilde
   */
  expandPath(inputPath: string): string {
    if (!inputPath) return inputPath;
    
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
   * Normalize a path into a standard format
   */
  normalizePath(inputPath: string): string {
    if (!inputPath) return inputPath;
    
    // Expand and resolve the path
    const expandedPath = this.expandPath(inputPath);
    
    // Use path.normalize to handle ../ and ./ segments
    return path.normalize(expandedPath);
  }

  /**
   * Resolve a path relative to the active project
   */
  resolveProjectPath(relativePath: string): string {
    const normalizedPath = this.normalizePath(relativePath);
    
    // If it's already an absolute path, just normalize it
    if (path.isAbsolute(normalizedPath)) {
      return normalizedPath;
    }
    
    // If we have an active project, resolve relative to project root
    if (this.activeProjectRoot) {
      return path.join(this.activeProjectRoot, normalizedPath);
    }
    
    // Fallback to resolving relative to server root
    return path.join(this.serverRoot, normalizedPath);
  }

  /**
   * Check if a path is allowed based on boundaries
   */
  isPathAllowed(targetPath: string, allowWrite = false): boolean {
    // Always normalize the target path
    const normalizedPath = this.normalizePath(targetPath);
    
    // If we have an active project, check if the path is within it
    if (this.activeProjectRoot) {
      if (normalizedPath === this.activeProjectRoot || normalizedPath.startsWith(this.activeProjectRoot + path.sep)) {
        return true;
      }
    }
    
    // If we have a projects base directory, check if the path is within it
    if (this.projectsBaseDir) {
      if (normalizedPath === this.projectsBaseDir || normalizedPath.startsWith(this.projectsBaseDir + path.sep)) {
        return true;
      }
    }
    
    // Allow access to server directory for development purposes (read-only by default)
    if (normalizedPath === this.serverRoot || normalizedPath.startsWith(this.serverRoot + path.sep)) {
      return !allowWrite; // Only allow read operations by default
    }
    
    return false;
  }

  /**
   * Record a directory change in the history
   */
  recordDirectoryChange(from: string, to: string): void {
    this.directoryHistory.push(`${from} → ${to}`);
    // Keep history at a reasonable size
    if (this.directoryHistory.length > 100) {
      this.directoryHistory.shift();
    }
  }

  /**
   * Get the directory change history
   */
  getDirectoryHistory(): string[] {
    return [...this.directoryHistory];
  }

  /**
   * Clear the directory change history
   */
  clearDirectoryHistory(): void {
    this.directoryHistory = [];
  }

  /**
   * Get relative path between two absolute paths
   */
  getRelativePath(from: string, to: string): string {
    return path.relative(this.normalizePath(from), this.normalizePath(to));
  }

  /**
   * Join paths safely with normalization
   */
  joinPaths(...paths: string[]): string {
    return this.normalizePath(path.join(...paths));
  }

  /**
   * Check if path is within another path
   */
  isPathWithin(parentPath: string, childPath: string): boolean {
    const normalizedParent = this.normalizePath(parentPath);
    const normalizedChild = this.normalizePath(childPath);
    
    return normalizedChild === normalizedParent || 
           normalizedChild.startsWith(normalizedParent + path.sep);
  }

  /**
   * Validate a path for read access
   * @throws PathAccessError if access is denied
   */
  validatePathForReading(targetPath: string): string {
    const normalizedPath = this.normalizePath(targetPath);
    
    if (!this.isPathAllowed(normalizedPath)) {
      throw new PathAccessError(
        normalizedPath, 
        "Path is outside of permitted boundaries for reading"
      );
    }
    
    return normalizedPath;
  }

  /**
   * Validate a path for write access
   * @throws PathAccessError if access is denied
   */
  validatePathForWriting(targetPath: string): string {
    const normalizedPath = this.normalizePath(targetPath);
    
    if (!this.isPathAllowed(normalizedPath, true)) {
      throw new PathAccessError(
        normalizedPath, 
        "Path is outside of permitted boundaries for writing"
      );
    }
    
    return normalizedPath;
  }
} 