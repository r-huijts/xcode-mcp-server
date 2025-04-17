import * as path from 'path';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { isInXcodeProject } from './file.js';
import { XcodeProject, ProjectInfo } from '../types/index.js';

const execAsync = promisify(exec);

/**
 * Find all Xcode projects in the given search path
 */
export async function findXcodeProjects(searchPath = "."): Promise<XcodeProject[]> {
  try {
    // Find .xcodeproj, .xcworkspace, and Package.swift files
    const { stdout: projStdout } = await execAsync(`find "${searchPath}" -name "*.xcodeproj"`);
    const { stdout: workspaceStdout } = await execAsync(`find "${searchPath}" -name "*.xcworkspace"`);
    const { stdout: spmStdout } = await execAsync(`find "${searchPath}" -name "Package.swift"`);

    const projects: XcodeProject[] = [];

    // Handle regular projects
    const projectPaths = projStdout.split("\n").filter(Boolean);
    for (const projectPath of projectPaths) {
      // Skip if this is a project inside a workspace (will be handled with workspace)
      const isInWorkspace = await isProjectInWorkspace(projectPath);
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
      try {
        const mainProject = await findMainProjectInWorkspace(workspacePath);
        projects.push({
          path: workspacePath,
          name: path.basename(workspacePath, ".xcworkspace"),
          isWorkspace: true,
          isSPMProject: false,
          associatedProjectPath: mainProject
        });
      } catch (error) {
        // If there's an error finding the main project, still add the workspace
        // but without an associated project
        console.error(`Error processing workspace ${workspacePath}:`, error);
        projects.push({
          path: workspacePath,
          name: path.basename(workspacePath, ".xcworkspace"),
          isWorkspace: true,
          isSPMProject: false
        });
      }
    }

    // Handle SPM projects
    const spmPaths = spmStdout.split("\n").filter(Boolean);
    for (const packagePath of spmPaths) {
      // Skip if this is a Package.swift inside an Xcode project or workspace
      const isInXcodeProj = await isInXcodeProject(packagePath);
      if (!isInXcodeProj) {
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

/**
 * Check if a project is inside a workspace
 */
export async function isProjectInWorkspace(projectPath: string): Promise<boolean> {
  const projectDir = path.dirname(projectPath);
  const workspaceCheck = await execAsync(`find "${projectDir}" -maxdepth 2 -name "*.xcworkspace"`);
  return workspaceCheck.stdout.trim().length > 0;
}

/**
 * Find the main project in a workspace
 */
export async function findMainProjectInWorkspace(workspacePath: string): Promise<string | undefined> {
  try {
    // Check if the workspace path exists
    try {
      await fs.access(workspacePath);
    } catch (error) {
      console.error(`Workspace path does not exist: ${workspacePath}`);
      return undefined;
    }

    // Read workspace contents
    const contentsPath = path.join(workspacePath, 'contents.xcworkspacedata');

    // Check if the contents file exists
    try {
      await fs.access(contentsPath);
    } catch (error) {
      console.error(`Workspace contents file does not exist: ${contentsPath}`);
      return undefined;
    }

    const contents = await fs.readFile(contentsPath, 'utf-8');

    // Look for the main project reference
    // Try multiple patterns that might be used in workspace files
    const patterns = [
      /location = "group:([^"]+\.xcodeproj)"/,  // Standard format
      /location="group:([^"]+\.xcodeproj)"/,     // Alternative format without space
      /<FileRef location="group:([^"]+\.xcodeproj)"/, // FileRef format
      /<FileRef location="container:([^"]+\.xcodeproj)"/ // Container format
    ];

    for (const pattern of patterns) {
      const projectMatch = contents.match(pattern);
      if (projectMatch) {
        const projectRelPath = projectMatch[1];
        return path.resolve(path.dirname(workspacePath), projectRelPath);
      }
    }

    console.error(`No project reference found in workspace: ${workspacePath}`);
    return undefined;
  } catch (error) {
    console.error("Error finding main project in workspace:", error);
    return undefined;
  }
}

/**
 * Get project information (targets, configurations, schemes)
 */
export async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
  try {
    // Determine the right command based on the project path type
    let cmd: string;

    if (projectPath.endsWith('.xcworkspace')) {
      // For workspaces, use -workspace flag
      cmd = `xcodebuild -list -workspace "${projectPath}"`;
    } else if (projectPath.endsWith('/project.xcworkspace')) {
      // Handle the case where we incorrectly get a project.xcworkspace inside an .xcodeproj
      // Strip off the /project.xcworkspace and use the .xcodeproj with -project flag
      const xcodeProjectPath = projectPath.replace('/project.xcworkspace', '');
      cmd = `xcodebuild -list -project "${xcodeProjectPath}"`;
    } else if (projectPath.endsWith('.xcodeproj')) {
      // Standard project
      cmd = `xcodebuild -list -project "${projectPath}"`;
    } else {
      // Check if it's an SPM project
      const packageSwiftPath = path.join(projectPath, 'Package.swift');
      try {
        await fs.access(packageSwiftPath);
        // For SPM projects, return basic info
        return {
          path: projectPath,
          targets: ['all'],
          configurations: ['debug', 'release'],
          schemes: ['all']
        };
      } catch {
        // Not an SPM project, try as a standard project
        cmd = `xcodebuild -list -project "${projectPath}"`;
      }
    }

    const { stdout } = await execAsync(cmd);
    const info: ProjectInfo = {
      path: projectPath,
      targets: [],
      configurations: [],
      schemes: []
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

/**
 * Get workspace information (targets, configurations, schemes)
 */
export async function getWorkspaceInfo(workspacePath: string): Promise<ProjectInfo> {
  try {
    // Handle different path formats
    let cmd: string;

    if (workspacePath.endsWith('.xcworkspace')) {
      // Standard workspace
      cmd = `xcodebuild -workspace "${workspacePath}" -list`;
    } else if (workspacePath.endsWith('/project.xcworkspace')) {
      // Handle case where we get project.xcworkspace inside an .xcodeproj
      const xcodeProjectPath = workspacePath.replace('/project.xcworkspace', '');
      // In this case, use project instead of workspace
      cmd = `xcodebuild -project "${xcodeProjectPath}" -list`;
    } else {
      // Default to treating it as a workspace
      cmd = `xcodebuild -workspace "${workspacePath}" -list`;
    }

    const { stdout } = await execAsync(cmd);
    const info: ProjectInfo = {
      path: workspacePath,
      targets: [],
      configurations: [],
      schemes: []
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

/**
 * Find project by name
 */
export async function findProjectByName(name: string, searchPath = "."): Promise<XcodeProject | undefined> {
  const projects = await findXcodeProjects(searchPath);
  return projects.find(p => p.name === name);
}