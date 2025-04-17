export class XcodeServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XcodeServerError';
  }
}

export class ProjectNotFoundError extends XcodeServerError {
  constructor(message: string = "No active project set. Please set a project first using set_project_path.") {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

export class PathAccessError extends XcodeServerError {
  path: string;
  
  constructor(path: string, message?: string) {
    super(message || `Access denied - path not allowed: ${path}. Please ensure the path is within your projects directory or set the projects base directory using set_projects_base_dir.`);
    this.name = 'PathAccessError';
    this.path = path;
  }
}

export class FileOperationError extends XcodeServerError {
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

export class CommandExecutionError extends XcodeServerError {
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