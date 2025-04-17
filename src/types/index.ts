export interface XcodeProject {
  path: string;
  name: string;
  isWorkspace?: boolean;
  isSPMProject?: boolean;
  associatedProjectPath?: string;  // For workspace, points to main .xcodeproj
  packageManifestPath?: string;    // For SPM projects, points to Package.swift
  type?: 'standard' | 'workspace' | 'spm';
}

export interface ServerConfig {
  projectsBaseDir?: string;
}

export interface ProjectInfo {
  path: string;
  targets: string[];
  configurations: string[];
  schemes: string[];
}

export interface FileContent {
  type: string;
  text: string;
  mimeType?: string;
  metadata?: {
    lastModified: Date;
    size: number;
  };
}

export interface ActiveProject {
  path: string;
  workspace?: string;
  name: string;
  isWorkspace?: boolean;
  isSPMProject?: boolean;
  associatedProjectPath?: string;
  packageManifestPath?: string;
  type?: 'standard' | 'workspace' | 'spm';
}