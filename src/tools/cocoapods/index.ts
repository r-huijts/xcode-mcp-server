import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { ProjectNotFoundError, XcodeServerError, CommandExecutionError, PathAccessError } from "../../utils/errors.js";

const execAsync = promisify(exec);

interface GemIssue {
  type: string;
  gem: string;
  fix: string;
}

interface CocoaPodsCheck {
  installed: boolean;
  version?: string;
  error?: unknown;
}

interface RubyCheck {
  rubyVersion?: string;
  issues?: GemIssue[];
  error?: unknown;
}

interface PodInfo {
  name: string;
  version: string;
  isOutdated?: boolean;
  latestVersion?: string;
}

/**
 * Parse CocoaPods version from Podfile.lock
 */
async function getPodfileLockVersion(podfileLockPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(podfileLockPath, 'utf-8');
    const match = content.match(/COCOAPODS: ([\d.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if CocoaPods is installed and working properly
 */
async function checkCocoaPodsInstallation(): Promise<CocoaPodsCheck> {
  try {
    // Check if pod command exists
    await execAsync('which pod');

    // Check CocoaPods version
    const { stdout } = await execAsync('pod --version');
    return { installed: true, version: stdout.trim() };
  } catch (error) {
    return { installed: false, error };
  }
}

/**
 * Check for version compatibility and provide update instructions if needed
 */
async function checkVersionCompatibility(projectRoot: string): Promise<void> {
  const podfileLockPath = path.join(projectRoot, 'Podfile.lock');
  const [installedVersion, lockVersion] = await Promise.all([
    checkCocoaPodsInstallation().then(check => check.version),
    getPodfileLockVersion(podfileLockPath)
  ]);

  if (lockVersion && installedVersion) {
    // Split version strings into components and convert to numbers
    const installedParts = installedVersion.split('.').map(Number);
    const lockParts = lockVersion.split('.').map(Number);

    // Ensure we have at least 3 parts (major.minor.patch)
    const installedMajor = installedParts[0] || 0;
    const installedMinor = installedParts[1] || 0;
    const installedPatch = installedParts[2] || 0;

    const lockMajor = lockParts[0] || 0;
    const lockMinor = lockParts[1] || 0;
    const lockPatch = lockParts[2] || 0;

    // Compare versions: first by major, then minor, then patch
    if (installedMajor < lockMajor ||
        (installedMajor === lockMajor && installedMinor < lockMinor) ||
        (installedMajor === lockMajor && installedMinor === lockMinor && installedPatch < lockPatch)) {
      throw new XcodeServerError(
        `CocoaPods version mismatch detected:\n` +
        `- Installed version: ${installedVersion}\n` +
        `- Version used in Podfile.lock: ${lockVersion}\n\n` +
        `To resolve this, you can either:\n` +
        `1. Update CocoaPods to match or exceed version ${lockVersion}:\n` +
        `   sudo gem install cocoapods\n\n` +
        `2. Or regenerate Podfile.lock with your current version:\n` +
        `   rm Podfile.lock\n` +
        `   pod install\n\n` +
        `Option 1 (updating CocoaPods) is recommended.`
      );
    }
  }
}

/**
 * Check Ruby environment
 */
async function checkRubyEnvironment(): Promise<RubyCheck> {
  try {
    const { stdout: rubyVersion } = await execAsync('ruby --version');
    const { stdout: gemList } = await execAsync('gem list');

    const issues: GemIssue[] = [];

    // Check for common gem issues
    if (gemList.includes('ffi') && gemList.includes('extensions are not built')) {
      issues.push({
        type: 'gem_issue',
        gem: 'ffi',
        fix: 'Run: sudo gem pristine ffi --version 1.15.5'
      });
    }

    // Check for activesupport issues which are common with CocoaPods
    if (gemList.includes('activesupport') && gemList.includes('incompatible')) {
      issues.push({
        type: 'gem_issue',
        gem: 'activesupport',
        fix: 'Run: sudo gem uninstall activesupport && sudo gem install activesupport -v 6.1.7.6'
      });
    }

    // Check for common image_optim issues
    if (gemList.includes('image_optim') && gemList.includes('cannot load')) {
      issues.push({
        type: 'gem_issue',
        gem: 'image_optim',
        fix: 'Run: brew install optipng jpegoptim'
      });
    }

    // Check for common xcodeproj issues
    if (gemList.includes('xcodeproj') && gemList.includes('incompatible')) {
      issues.push({
        type: 'gem_issue',
        gem: 'xcodeproj',
        fix: 'Run: sudo gem uninstall xcodeproj && sudo gem install xcodeproj'
      });
    }

    // Check for common json issues
    if (gemList.includes('json') && gemList.includes('incompatible')) {
      issues.push({
        type: 'gem_issue',
        gem: 'json',
        fix: 'Run: sudo gem uninstall json && sudo gem install json'
      });
    }

    // Check for architecture issues on Apple Silicon
    if (rubyVersion.includes('arm64') && gemList.includes('incompatible architecture')) {
      issues.push({
        type: 'architecture_issue',
        gem: 'multiple',
        fix: 'You may need to use Rosetta for Ruby: arch -x86_64 pod install'
      });
    }

    return {
      rubyVersion: rubyVersion.trim(),
      issues
    };
  } catch (error) {
    return { error };
  }
}

/**
 * Extract installed pods from Podfile.lock content
 */
async function extractInstalledPods(podfileLockPath: string): Promise<PodInfo[]> {
  try {
    const lockContent = await fs.readFile(podfileLockPath, 'utf-8');
    const podsSection = lockContent.match(/PODS:\s*\n([\s\S]+?)(?:\n\n|$)/);

    if (!podsSection || !podsSection[1]) {
      return [];
    }

    const podLines = podsSection[1].split('\n');
    const installedPods: PodInfo[] = [];

    for (const line of podLines) {
      // Match both standard pod entries and pods with dependencies
      // Format: "  - PodName (1.2.3)" or "  - PodName/SubSpec (1.2.3)"
      const match = line.match(/\s*-\s+([^(/]+(?:\/[^(]*)?)\s+\(([^)]+)\)/);
      if (match) {
        installedPods.push({
          name: match[1].trim(),
          version: match[2].trim()
        });
      }
    }

    return installedPods;
  } catch (error) {
    console.error("Error extracting pods from Podfile.lock:", error);
    return [];
  }
}

/**
 * Check for outdated pods in the project
 */
async function checkOutdatedPods(projectDir: string): Promise<PodInfo[]> {
  try {
    // Get the list of installed pods first
    const podfileLockPath = path.join(projectDir, 'Podfile.lock');
    const installedPods = await extractInstalledPods(podfileLockPath);

    // Run pod outdated to get the list of outdated pods
    const { stdout } = await execAsync('pod outdated --no-repo-update', { cwd: projectDir });

    // Parse the output to identify outdated pods and their latest versions
    const outdatedPods = new Map<string, string>();
    const outdatedPattern = /- (.*?) \((.*?) -> (.*?)\)/g;
    let match;

    while ((match = outdatedPattern.exec(stdout)) !== null) {
      const [, podName, , latestVersion] = match; // Skip currentVersion as it's not used
      outdatedPods.set(podName.trim(), latestVersion.trim());
    }

    // Update the installed pods list with outdated information
    return installedPods.map(pod => {
      const latestVersion = outdatedPods.get(pod.name);
      if (latestVersion) {
        return {
          ...pod,
          isOutdated: true,
          latestVersion
        };
      }
      return pod;
    });

  } catch (error) {
    console.error("Error checking for outdated pods:", error);
    return [];
  }
}

/**
 * Get installation instructions based on the current system state
 */
function getInstallationInstructions(cocoaPodsCheck: CocoaPodsCheck, rubyCheck: RubyCheck): string {
  const instructions: string[] = [];

  if (!cocoaPodsCheck.installed) {
    instructions.push(
      "CocoaPods is not installed. To install it:",
      "1. First, ensure you have Ruby installed (macOS comes with it pre-installed)",
      "2. Run: sudo gem install cocoapods",
      "3. After installation, run: pod setup"
    );
  }

  if (rubyCheck.issues?.length) {
    instructions.push(
      "\nRuby gem issues detected:",
      ...rubyCheck.issues.map(issue => `- ${issue.fix}`)
    );
  }

  if (!instructions.length) {
    return "CocoaPods appears to be properly installed.";
  }

  return instructions.join('\n');
}

/**
 * Check if a specific pod exists in the Podfile
 */
async function checkPodExists(podfilePath: string, podName: string): Promise<boolean> {
  try {
    const content = await fs.readFile(podfilePath, 'utf-8');
    const podRegex = new RegExp(`pod\\s+['"](${podName})['"]`, 'i');
    return podRegex.test(content);
  } catch {
    return false;
  }
}

/**
 * Register CocoaPods related tools
 */
export function registerCocoaPodsTools(server: XcodeServer) {
  // Register "pod_install"
  server.server.tool(
    "pod_install",
    "Runs 'pod install' in the active project directory to install CocoaPods dependencies.",
    {
      repoUpdate: z.boolean().optional().describe("Whether to update the spec repositories before installation. Defaults to false."),
      cleanInstall: z.boolean().optional().describe("Ignore the contents of the project cache and force a full pod installation."),
      verbose: z.boolean().optional().describe("Show more debugging information during installation.")
    },
    async ({ repoUpdate = false, cleanInstall = false, verbose = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Check CocoaPods installation first
        const cocoaPodsCheck = await checkCocoaPodsInstallation();
        const rubyCheck = await checkRubyEnvironment();

        if (!cocoaPodsCheck.installed || (rubyCheck.issues && rubyCheck.issues.length > 0)) {
          const instructions = getInstallationInstructions(cocoaPodsCheck, rubyCheck);
          throw new XcodeServerError(
            "CocoaPods installation issues detected. Please fix the following issues before proceeding:\n\n" +
            instructions
          );
        }

        // Use the active directory rather than deriving from project path
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate this is properly within project boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check version compatibility before proceeding
        await checkVersionCompatibility(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');

        try {
          // Check if Podfile exists
          await fs.access(podfilePath);
        } catch {
          throw new XcodeServerError("No Podfile found in the project directory. This project doesn't use CocoaPods.");
        }

        try {
          // Set UTF-8 encoding and run pod install
          const env = {
            ...process.env,
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8'
          };

          // Build the command with appropriate flags
          let cmd = 'pod install';
          if (repoUpdate) {
            cmd += ' --repo-update';
          } else {
            cmd += ' --no-repo-update';
          }

          if (cleanInstall) {
            cmd += ' --clean-install';
          }

          if (verbose) {
            cmd += ' --verbose';
          }

          const { stdout, stderr } = await execAsync(cmd, {
            cwd: activeDirectory,
            env
          });

          return {
            content: [{
              type: "text",
              text: `CocoaPods installation completed successfully:\n\n${stdout}\n${stderr ? 'Console output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Check for specific error patterns and provide helpful messages
          if (stderr.includes('Podfile syntax error')) {
            throw new XcodeServerError(
              "Podfile syntax error detected. Please check your Podfile format.\n" +
              "Common issues:\n" +
              "1. Missing 'end' keyword\n" +
              "2. Incorrect target name\n" +
              "3. Invalid pod specifications\n\n" +
              stderr
            );
          }

          if (stderr.includes('unicode_normalize')) {
            throw new XcodeServerError(
              "CocoaPods UTF-8 encoding issue detected. Please ensure your terminal is configured for UTF-8:\n" +
              "Add to your ~/.zshrc or ~/.bash_profile:\n" +
              "export LANG=en_US.UTF-8\n" +
              "export LC_ALL=en_US.UTF-8"
            );
          }

          if (stderr.includes('CDN: trunk URL couldn\'t be downloaded')) {
            throw new XcodeServerError(
              "CocoaPods CDN connection issue. Try one of the following:\n" +
              "1. Check your internet connection\n" +
              "2. Run 'pod repo update'\n" +
              "3. Try again with '--repo-update' flag\n" +
              "4. If behind a proxy, configure CocoaPods to use your proxy settings"
            );
          }

          if (stderr.includes('pod: command not found')) {
            throw new XcodeServerError(
              "CocoaPods is not installed or not in your PATH. To install CocoaPods:\n" +
              "1. Run: sudo gem install cocoapods\n" +
              "2. After installation, run: pod setup"
            );
          }

          if (stderr.includes('incompatible architecture')) {
            throw new XcodeServerError(
              "Architecture compatibility issue detected. This often happens with M1/M2 Macs.\n" +
              "Try one of the following:\n" +
              "1. Install ffi gem: sudo gem install ffi\n" +
              "2. Install cocoapods with arch flag: sudo arch -x86_64 gem install cocoapods\n" +
              "3. Run pod install with arch flag: arch -x86_64 pod install"
            );
          }

          if (stderr.includes('Could not find compatible versions for pod')) {
            throw new XcodeServerError(
              "Version compatibility issue detected.\n" +
              "Common solutions:\n" +
              "1. Update your CocoaPods spec repos: pod repo update\n" +
              "2. Check the version constraints in your Podfile\n" +
              "3. Try using a more specific version constraint\n" +
              "4. Check if the pod has been updated recently\n\n" +
              stderr
            );
          }

          throw new CommandExecutionError(
            'pod install',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "pod_update"
  server.server.tool(
    "pod_update",
    "Runs 'pod update' in the active project directory to update CocoaPods dependencies.",
    {
      pods: z.array(z.string()).optional().describe("Optional list of specific pods to update. If not provided, updates all pods."),
      repoUpdate: z.boolean().optional().describe("Whether to update the spec repositories before updating pods. Defaults to true."),
      excludePods: z.array(z.string()).optional().describe("Optional list of pods to exclude during update."),
      cleanInstall: z.boolean().optional().describe("Ignore the contents of the project cache and force a full pod installation."),
      sources: z.array(z.string()).optional().describe("Optional list of sources from which to update dependent pods.")
    },
    async ({ pods, repoUpdate = true, excludePods, cleanInstall, sources }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory rather than deriving from project path
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate this is properly within project boundaries
        server.pathManager.validatePathForReading(activeDirectory);

        // Check version compatibility before proceeding
        await checkVersionCompatibility(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');

        try {
          // Check if Podfile exists
          await fs.access(podfilePath);
        } catch {
          throw new XcodeServerError("No Podfile found in the project directory. This project doesn't use CocoaPods.");
        }

        // If specific pods are provided, verify they exist in the Podfile
        if (pods && pods.length > 0) {
          const nonExistentPods: string[] = [];

          for (const podName of pods) {
            const exists = await checkPodExists(podfilePath, podName);
            if (!exists) {
              nonExistentPods.push(podName);
            }
          }

          if (nonExistentPods.length > 0) {
            throw new XcodeServerError(
              `The following pods were not found in your Podfile: ${nonExistentPods.join(', ')}\n` +
              `Please check the pod names and try again.`
            );
          }
        }

        try {
          // Set UTF-8 encoding
          const env = {
            ...process.env,
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8'
          };

          // Build the command
          let cmd = 'pod update';

          // Add specific pods to update
          if (pods && pods.length > 0) {
            cmd += ' ' + pods.map(pod => pod.trim()).join(' ');
          }

          // Add repo update flag
          if (!repoUpdate) {
            cmd += ' --no-repo-update';
          }

          // Add excluded pods
          if (excludePods && excludePods.length > 0) {
            cmd += ` --exclude-pods=${excludePods.join(',')}`;
          }

          // Add clean install flag
          if (cleanInstall) {
            cmd += ' --clean-install';
          }

          // Add sources
          if (sources && sources.length > 0) {
            cmd += ` --sources=${sources.join(',')}`;
          }

          const { stdout, stderr } = await execAsync(cmd, {
            cwd: activeDirectory,
            env
          });

          return {
            content: [{
              type: "text",
              text: `CocoaPods update completed successfully:\n\n${stdout}\n${stderr ? 'Console output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Handle specific error cases
          if (stderr.includes('The dependency') && stderr.includes('is not used in any concrete target')) {
            throw new XcodeServerError(
              "Error: Some dependencies you're trying to update aren't used in any target.\n" +
              "Try updating specific pods that are actually used in your project."
            );
          }

          if (stderr.includes('pod: command not found')) {
            throw new XcodeServerError(
              "CocoaPods is not installed or not in your PATH. To install CocoaPods:\n" +
              "1. Run: sudo gem install cocoapods\n" +
              "2. After installation, run: pod setup"
            );
          }

          if (stderr.includes('Could not find compatible versions for pod')) {
            throw new XcodeServerError(
              "Version compatibility issue detected.\n" +
              "Common solutions:\n" +
              "1. Update your CocoaPods spec repos: pod repo update\n" +
              "2. Check the version constraints in your Podfile\n" +
              "3. Try using a more specific version constraint\n" +
              "4. Check if the pod has been updated recently\n\n" +
              stderr
            );
          }

          if (stderr.includes('CDN: trunk URL couldn\'t be downloaded')) {
            throw new XcodeServerError(
              "CocoaPods CDN connection issue. Try one of the following:\n" +
              "1. Check your internet connection\n" +
              "2. Run 'pod repo update'\n" +
              "3. Try again with '--repo-update' flag\n" +
              "4. If behind a proxy, configure CocoaPods to use your proxy settings"
            );
          }

          throw new CommandExecutionError(
            'pod update',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "pod_outdated"
  server.server.tool(
    "pod_outdated",
    "Shows outdated pods in the current project and their available updates.",
    {
      ignorePrerelease: z.boolean().optional().describe("Don't consider prerelease versions to be updates. Defaults to true."),
      repoUpdate: z.boolean().optional().describe("Whether to update the spec repositories before checking for outdated pods. Defaults to false.")
    },
    async ({ ignorePrerelease = true, repoUpdate = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate the path
        server.pathManager.validatePathForReading(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');
        const podfileLockPath = path.join(activeDirectory, 'Podfile.lock');

        try {
          // Check if Podfile and Podfile.lock exist
          await fs.access(podfilePath);
          await fs.access(podfileLockPath);
        } catch {
          throw new XcodeServerError("Podfile or Podfile.lock not found. Make sure you have a CocoaPods project and have run 'pod install' first.");
        }

        try {
          // Build command with options
          let cmd = 'pod outdated';

          if (ignorePrerelease) {
            cmd += ' --ignore-prerelease';
          }

          if (!repoUpdate) {
            cmd += ' --no-repo-update';
          }

          const { stdout, stderr } = await execAsync(cmd, {
            cwd: activeDirectory
          });

          // Parse the outdated pods information
          const outdatedPods: PodInfo[] = [];
          const outdatedPattern = /- (.*?) \((.*?) -> (.*?)\)/g;
          let match;

          while ((match = outdatedPattern.exec(stdout)) !== null) {
            const [, podName, currentVersion, latestVersion] = match;
            outdatedPods.push({
              name: podName.trim(),
              version: currentVersion.trim(),
              isOutdated: true,
              latestVersion: latestVersion.trim()
            });
          }

          // Get the list of installed pods for comparison
          const installedPods = await extractInstalledPods(podfileLockPath);

          // Generate the response with a structured format
          const summary = outdatedPods.length > 0
            ? `Found ${outdatedPods.length} outdated pods.`
            : 'All pods are up to date!';

          return {
            content: [{
              type: "text",
              text: `${summary}\n\n` +
                    `${stdout}\n\n` +
                    `Installed Pods: ${installedPods.length}\n` +
                    `Outdated Pods: ${outdatedPods.length}\n\n` +
                    `${stderr ? 'Console output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          throw new CommandExecutionError(
            'pod outdated',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "pod_repo_update"
  server.server.tool(
    "pod_repo_update",
    "Updates the local clone of the CocoaPods spec repositories.",
    {
      verbose: z.boolean().optional().describe("Show more detailed output."),
      silent: z.boolean().optional().describe("Show nothing during update.")
    },
    async ({ verbose = false, silent = false }) => {
      try {
        // Build command with options
        let cmd = 'pod repo update';

        if (verbose) {
          cmd += ' --verbose';
        }

        if (silent) {
          cmd += ' --silent';
        }

        const { stdout, stderr } = await execAsync(cmd);

        return {
          content: [{
            type: "text",
            text: `CocoaPods repository update completed successfully:\n\n${stdout}\n${stderr ? 'Console output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        throw new CommandExecutionError(
          'pod repo update',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "pod_deintegrate"
  server.server.tool(
    "pod_deintegrate",
    "Deintegrate CocoaPods from the active project, removing all traces of CocoaPods.",
    {},
    async () => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate path
        server.pathManager.validatePathForWriting(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');

        try {
          // Check if Podfile exists
          await fs.access(podfilePath);
        } catch {
          throw new XcodeServerError("No Podfile found in the project directory. This project doesn't use CocoaPods.");
        }

        try {
          const { stdout, stderr } = await execAsync('pod deintegrate', {
            cwd: activeDirectory
          });

          return {
            content: [{
              type: "text",
              text: `CocoaPods has been deintegrated from the project:\n\n${stdout}\n${stderr ? 'Console output:\n' + stderr : ''}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          throw new CommandExecutionError(
            'pod deintegrate',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "check_cocoapods"
  server.server.tool(
    "check_cocoapods",
    "Checks if the active project uses CocoaPods and returns setup information.",
    {
      includeOutdated: z.boolean().optional().describe("Check for outdated pods and include update information. Default: false")
    },
    async ({ includeOutdated = false }) => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory for checking
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate this path is allowed
        server.pathManager.validatePathForReading(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');
        const podfileLockPath = path.join(activeDirectory, 'Podfile.lock');

        // Check if Podfile and Podfile.lock exist
        const [podfileExists, podfileLockExists] = await Promise.all([
          fs.access(podfilePath).then(() => true).catch(() => false),
          fs.access(podfileLockPath).then(() => true).catch(() => false)
        ]);

        const cocoaPodsCheck = await checkCocoaPodsInstallation();
        const rubyCheck = await checkRubyEnvironment();

        // If it has a Podfile, it's using CocoaPods
        const usesCocoaPods = podfileExists;

        // Get Podfile content if it exists
        let podfileContent = null;
        if (podfileExists) {
          try {
            podfileContent = await fs.readFile(podfilePath, 'utf-8');
          } catch {
            // Ignore errors reading the file
          }
        }

        // Get installed pods and check for outdated ones if requested
        let installedPods: PodInfo[] = [];
        if (podfileLockExists) {
          installedPods = await extractInstalledPods(podfileLockPath);

          if (includeOutdated && usesCocoaPods) {
            try {
              const outdatedInfo = await checkOutdatedPods(activeDirectory);

              // Merge the outdated info into the installed pods
              installedPods = installedPods.map(pod => {
                const outdatedPod = outdatedInfo.find(p => p.name === pod.name && p.isOutdated);
                if (outdatedPod) {
                  return {
                    ...pod,
                    isOutdated: true,
                    latestVersion: outdatedPod.latestVersion
                  };
                }
                return pod;
              });
            } catch (error) {
              console.error("Error checking for outdated pods:", error);
            }
          }
        }

        // Get info about CocoaPods repositories
        let repoInfo = null;
        if (cocoaPodsCheck.installed) {
          try {
            const { stdout } = await execAsync('pod repo list');
            repoInfo = stdout.trim();
          } catch {
            // Ignore repo listing errors
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              usesCocoaPods,
              podfileExists,
              podfileLockExists,
              installedPods,
              podCount: installedPods.length,
              outdatedCount: installedPods.filter(pod => pod.isOutdated).length,
              cocoaPodsInstalled: cocoaPodsCheck.installed,
              cocoaPodsVersion: cocoaPodsCheck.version,
              podfileSummary: podfileContent ? `${podfileContent.split('\n').slice(0, 10).join('\n')}${podfileContent.split('\n').length > 10 ? '\n...(truncated)' : ''}` : null,
              installationInstructions: getInstallationInstructions(cocoaPodsCheck, rubyCheck),
              repoInfo
            }, null, 2)
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  // Register "pod_init"
  server.server.tool(
    "pod_init",
    "Generate a Podfile for the current project directory.",
    {},
    async () => {
      try {
        if (!server.activeProject) throw new ProjectNotFoundError();

        // Use the active directory
        const activeDirectory = server.directoryState.getActiveDirectory();

        // Validate path
        server.pathManager.validatePathForWriting(activeDirectory);

        const podfilePath = path.join(activeDirectory, 'Podfile');

        // Check if Podfile already exists
        try {
          await fs.access(podfilePath);
          throw new XcodeServerError("A Podfile already exists in this directory. If you want to recreate it, delete the existing one first.");
        } catch (error) {
          // Error means file doesn't exist, which is what we want
          if (error instanceof XcodeServerError) {
            throw error;
          }
        }

        try {
          const { stdout, stderr } = await execAsync('pod init', {
            cwd: activeDirectory
          });

          // Read the generated Podfile
          let podfileContent = "";
          try {
            podfileContent = await fs.readFile(podfilePath, 'utf-8');
          } catch {
            // Ignore errors reading the file
          }

          return {
            content: [{
              type: "text",
              text: `Podfile has been created successfully:\n\n${stdout}\n${stderr ? 'Console output:\n' + stderr : ''}\n\nGenerated Podfile content:\n\n${podfileContent}`
            }]
          };
        } catch (error) {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          throw new CommandExecutionError(
            'pod init',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );
}