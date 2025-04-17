import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import { XcodeServer } from "../../server.js";
import { CommandExecutionError, PathAccessError, FileOperationError } from "../../utils/errors.js";

const execAsync = promisify(exec);

/**
 * Get available Xcode versions on the system
 */
async function getXcodeVersions(): Promise<{path: string, version: string, build: string, isDefault: boolean}[]> {
  try {
    const { stdout } = await execAsync('mdfind "kMDItemCFBundleIdentifier == com.apple.dt.Xcode"');
    const paths = stdout.trim().split('\n').filter(Boolean);

    const versions = [];
    const defaultPath = await getDefaultXcodePath();

    for (const path of paths) {
      try {
        const { stdout: versionOutput } = await execAsync(`/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${path}/Contents/Info.plist"`);
        const { stdout: buildOutput } = await execAsync(`/usr/libexec/PlistBuddy -c "Print :DTXcode" "${path}/Contents/Info.plist"`);

        versions.push({
          path,
          version: versionOutput.trim(),
          build: buildOutput.trim(),
          isDefault: path === defaultPath
        });
      } catch {
        // Skip if we can't get version info
      }
    }

    return versions;
  } catch (error) {
    console.error("Error getting Xcode versions:", error);
    return [];
  }
}

/**
 * Get the path to the default Xcode installation
 */
async function getDefaultXcodePath(): Promise<string> {
  try {
    const { stdout } = await execAsync('xcode-select -p');
    // xcode-select returns the Developer directory, we need to go up two levels
    return path.dirname(path.dirname(stdout.trim()));
  } catch (error) {
    console.error("Error getting default Xcode path:", error);
    return "";
  }
}

/**
 * Register Xcode-related tools
 */
export function registerXcodeTools(server: XcodeServer) {
  // Register "run_xcrun"
  server.server.tool(
    "run_xcrun",
    "Executes a specified Xcode tool via xcrun",
    {
      tool: z.string().describe("The name of the Xcode tool to run"),
      args: z.string().optional().describe("Arguments to pass to the tool"),
      workingDir: z.string().optional().describe("Working directory to execute the command in")
    },
    async ({ tool, args = "", workingDir }) => {
      try {
        let options = {};

        if (workingDir) {
          // Validate and resolve the working directory path
          const resolvedWorkingDir = server.pathManager.normalizePath(workingDir);
          server.pathManager.validatePathForReading(resolvedWorkingDir);
          options = { cwd: resolvedWorkingDir };
        }

        const { stdout, stderr } = await execAsync(`xcrun ${tool} ${args}`, options);

      return {
        content: [{
            type: "text",
            text: `${tool} output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        }

        throw new CommandExecutionError(
          `xcrun ${tool}`,
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "compile_asset_catalog"
  server.server.tool(
    "compile_asset_catalog",
    "Compiles an asset catalog (.xcassets) using actool",
    {
      catalogPath: z.string().describe("Path to the asset catalog (.xcassets directory)"),
      outputDir: z.string().describe("Directory where compiled assets should be placed"),
      platform: z.enum(["iphoneos", "iphonesimulator", "macosx", "watchos"]).optional().describe("Target platform (default: iphoneos)"),
      minDeploymentTarget: z.string().optional().describe("Minimum deployment target version (default: 14.0)"),
      appIcon: z.string().optional().describe("Name of the app icon set to include"),
      targetDevices: z.array(z.string()).optional().describe("Target devices (default: ['iphone', 'ipad'])")
    },
    async ({ catalogPath, outputDir, platform = "iphoneos", minDeploymentTarget = "14.0", appIcon, targetDevices = ["iphone", "ipad"] }) => {
      try {
        // Validate paths for security
        const resolvedCatalogPath = server.pathManager.normalizePath(catalogPath);
        server.pathManager.validatePathForReading(resolvedCatalogPath);

        const resolvedOutputDir = server.pathManager.normalizePath(outputDir);
        server.pathManager.validatePathForWriting(resolvedOutputDir);

        // Ensure the catalog path ends with .xcassets
        if (!resolvedCatalogPath.endsWith('.xcassets')) {
          throw new Error(`Asset catalog path must end with .xcassets: ${catalogPath}`);
        }

        // Ensure the catalog exists
        try {
          const stats = await fs.stat(resolvedCatalogPath);
          if (!stats.isDirectory()) {
            throw new Error(`Asset catalog path is not a directory: ${catalogPath}`);
          }
        } catch (error) {
          throw new Error(`Asset catalog not found: ${catalogPath}`);
        }

        // Ensure the output directory exists
        try {
          await fs.mkdir(resolvedOutputDir, { recursive: true });
        } catch (error) {
          throw new FileOperationError(`Failed to create output directory: ${outputDir}`, String(error));
        }

        // Build the command with validated paths
        let cmd = `xcrun actool "${resolvedCatalogPath}" --output-format human-readable-text --notices --warnings`;

        // Add platform
        cmd += ` --platform ${platform}`;

        // Add deployment target
        cmd += ` --minimum-deployment-target ${minDeploymentTarget}`;

        // Add target devices
        for (const device of targetDevices) {
          cmd += ` --target-device ${device}`;
        }

        // Add app icon if specified
        if (appIcon) {
          cmd += ` --app-icon ${appIcon}`;
        }

        // Add output paths
        const plistPath = path.join(resolvedOutputDir, 'assetcatalog_generated_info.plist');
        cmd += ` --output-partial-info-plist "${plistPath}" --compress-pngs --compile "${resolvedOutputDir}"`;

        const { stdout, stderr } = await execAsync(cmd);

      return {
        content: [{
            type: "text",
            text: `Asset catalog compilation:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}\n\nAssets compiled to: ${resolvedOutputDir}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else if (error instanceof FileOperationError) {
          throw new Error(`File operation error: ${error.message}`);
        } else {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'xcrun actool',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      }
    }
  );

  // Register "run_lldb"
  server.server.tool(
    "run_lldb",
    "Launches the LLDB debugger with optional arguments",
    {
      args: z.string().optional().describe("Arguments to pass to lldb"),
      command: z.string().optional().describe("Single LLDB command to execute")
    },
    async ({ args = "", command }) => {
      try {
        let cmd = `xcrun lldb ${args}`;

        // If a single command is provided, execute it and exit
        if (command) {
          cmd += ` -o "${command}" -b`;  // -b for batch mode (exit after running commands)
        }

        const { stdout, stderr } = await execAsync(cmd);

      return {
        content: [{
            type: "text",
            text: `LLDB output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'xcrun lldb',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "trace_app"
  server.server.tool(
    "trace_app",
    "Captures a performance trace of an application using xctrace",
    {
      appPath: z.string().describe("Path to the application to trace"),
      duration: z.number().optional().describe("Duration of the trace in seconds (default: 10)"),
      template: z.string().optional().describe("Trace template to use (default: 'Time Profiler')"),
      outputPath: z.string().optional().describe("Path where to save the trace file (default: app_trace.trace in active directory)"),
      startSuspended: z.boolean().optional().describe("Start the application in a suspended state")
    },
    async ({ appPath, duration = 10, template = "Time Profiler", outputPath, startSuspended = false }) => {
      try {
        // Validate app path
        const resolvedAppPath = server.pathManager.normalizePath(appPath);
        server.pathManager.validatePathForReading(resolvedAppPath);

        // Determine output path
        const activeDirectory = server.directoryState.getActiveDirectory();
        const resolvedOutputPath = outputPath
          ? server.pathManager.normalizePath(outputPath)
          : path.join(activeDirectory, "app_trace.trace");

        // Make sure we can write to the output path
        server.pathManager.validatePathForWriting(resolvedOutputPath);

        // Ensure output directory exists
        const outputDir = path.dirname(resolvedOutputPath);
        await fs.mkdir(outputDir, { recursive: true });

        // Build the command
        let cmd = `xcrun xctrace record --template "${template}" --time-limit ${duration}s --output "${resolvedOutputPath}"`;

        if (startSuspended) {
          cmd += ' --launch-suspended';
        }

        cmd += ` --launch -- "${resolvedAppPath}"`;

        const { stdout, stderr } = await execAsync(cmd);

        return {
          content: [{
            type: "text",
            text: `XCTrace output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}\nTrace saved to: ${resolvedOutputPath}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new CommandExecutionError(
            'xcrun xctrace',
            stderr || (error instanceof Error ? error.message : String(error))
          );
        }
      }
    }
  );

  // Register "get_xcode_info"
  server.server.tool(
    "get_xcode_info",
    "Get information about Xcode installations on the system",
    {},
    async () => {
      try {
        const xcodeVersions = await getXcodeVersions();
        const defaultPath = await getDefaultXcodePath();

        let formattedOutput = "Xcode Installations:\n\n";

        if (xcodeVersions.length === 0) {
          formattedOutput += "No Xcode installations found.\n";
        } else {
          xcodeVersions.forEach(xcode => {
            formattedOutput += `${xcode.isDefault ? '* ' : '  '}Xcode ${xcode.version} (${xcode.build})\n`;
            formattedOutput += `  Path: ${xcode.path}\n\n`;
          });

          formattedOutput += "* = Active Xcode installation\n\n";
          formattedOutput += `Active Xcode Developer Path: ${defaultPath}/Contents/Developer\n`;
        }

        // Add SDK information
        try {
          // Get iOS SDK information
          const { stdout: iOSSDKOutput } = await execAsync('xcrun --show-sdk-path --sdk iphoneos');
          formattedOutput += `\niOS SDK Path: ${iOSSDKOutput.trim()}\n`;

          const { stdout: iOSSDKVersionOutput } = await execAsync('xcrun --show-sdk-version --sdk iphoneos');
          formattedOutput += `iOS SDK Version: ${iOSSDKVersionOutput.trim()}\n`;

          // Get macOS SDK information
          try {
            const { stdout: macOSSDKOutput } = await execAsync('xcrun --show-sdk-path --sdk macosx');
            formattedOutput += `\nmacOS SDK Path: ${macOSSDKOutput.trim()}\n`;

            const { stdout: macOSSDKVersionOutput } = await execAsync('xcrun --show-sdk-version --sdk macosx');
            formattedOutput += `macOS SDK Version: ${macOSSDKVersionOutput.trim()}\n`;
          } catch {
            // Ignore if macOS SDK info can't be retrieved
          }

          // Get watchOS SDK information
          try {
            const { stdout: watchOSSDKOutput } = await execAsync('xcrun --show-sdk-path --sdk watchos');
            formattedOutput += `\nwatchOS SDK Path: ${watchOSSDKOutput.trim()}\n`;

            const { stdout: watchOSSDKVersionOutput } = await execAsync('xcrun --show-sdk-version --sdk watchos');
            formattedOutput += `watchOS SDK Version: ${watchOSSDKVersionOutput.trim()}\n`;
          } catch {
            // Ignore if watchOS SDK info can't be retrieved
          }

          // Get tvOS SDK information
          try {
            const { stdout: tvOSSDKOutput } = await execAsync('xcrun --show-sdk-path --sdk appletvos');
            formattedOutput += `\ntvOS SDK Path: ${tvOSSDKOutput.trim()}\n`;

            const { stdout: tvOSSDKVersionOutput } = await execAsync('xcrun --show-sdk-version --sdk appletvos');
            formattedOutput += `tvOS SDK Version: ${tvOSSDKVersionOutput.trim()}\n`;
          } catch {
            // Ignore if tvOS SDK info can't be retrieved
          }
        } catch {
          formattedOutput += "\nCould not determine SDK information\n";
        }

        return {
          content: [{
            type: "text",
            text: formattedOutput
          }]
        };
      } catch (error) {
        let errorMessage = "Failed to retrieve Xcode information";
        if (error instanceof Error) {
          errorMessage += `: ${error.message}`;
        }

        throw new Error(errorMessage);
      }
    }
  );

  // Register "switch_xcode"
  server.server.tool(
    "switch_xcode",
    "Switch the active Xcode version",
    {
      xcodePath: z.string().optional().describe("Path to the Xcode.app to use. If not provided, available Xcode installations will be listed."),
      version: z.string().optional().describe("Version of Xcode to use (e.g., '14.3'). Will use the first matching version found.")
    },
    async ({ xcodePath, version }) => {
      try {
        // Get available Xcode versions
        const xcodeVersions = await getXcodeVersions();

        if (xcodeVersions.length === 0) {
          throw new Error("No Xcode installations found on this system.");
        }

        // If neither xcodePath nor version is provided, just list available versions
        if (!xcodePath && !version) {
          let formattedOutput = "Available Xcode installations:\n\n";

          xcodeVersions.forEach((xcode, index) => {
            formattedOutput += `${index + 1}. Xcode ${xcode.version} (${xcode.build})${xcode.isDefault ? ' (active)' : ''}\n`;
            formattedOutput += `   Path: ${xcode.path}\n\n`;
          });

          formattedOutput += "To switch Xcode version, use this tool with either 'path' or 'version' parameter.";

          return {
            content: [{
              type: "text",
              text: formattedOutput
            }]
          };
        }

        // Find the Xcode to switch to
        let targetXcode;

        if (xcodePath) {
          // Normalize and validate the path
          const resolvedPath = server.pathManager.normalizePath(xcodePath);

          // Find by path
          targetXcode = xcodeVersions.find(xcode => xcode.path === resolvedPath);

          if (!targetXcode) {
            throw new Error(`No Xcode installation found at path: ${resolvedPath}`);
          }
        } else if (version) {
          // Find by version
          targetXcode = xcodeVersions.find(xcode => xcode.version === version);

          if (!targetXcode) {
            throw new Error(`No Xcode installation found with version: ${version}`);
          }
        }

        // Check if already active
        if (targetXcode && targetXcode.isDefault) {
          return {
            content: [{
              type: "text",
              text: `Xcode ${targetXcode.version} (${targetXcode.build}) is already the active Xcode version.`
            }]
          };
        }

        // Switch Xcode version using xcode-select
        if (!targetXcode) {
          throw new Error('No target Xcode version found');
        }

        // Use the path module
        // (already imported at the top of the file)
        const developerDir = path.join(targetXcode.path, 'Contents', 'Developer');
        const { stdout, stderr } = await execAsync(`sudo xcode-select --switch "${developerDir}"`);

        return {
          content: [{
            type: "text",
            text: `Successfully switched to Xcode ${targetXcode.version} (${targetXcode.build})\n${stdout}${stderr ? '\nConsole output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let errorMessage = "Failed to switch Xcode version";

        if (error instanceof Error) {
          if (error.message.includes("sudo") || error.message.includes("password")) {
            errorMessage = "Switching Xcode versions requires sudo privileges. Please run the command manually in your terminal:\n\n" +
                          `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`;
          } else {
            errorMessage += `: ${error.message}`;
          }
        }

        throw new Error(errorMessage);
      }
    }
  );

  // Register "export_archive"
  server.server.tool(
    "export_archive",
    "Export an Xcode archive for distribution (App Store, Ad Hoc, Enterprise, Development)",
    {
      archivePath: z.string().describe("Path to the .xcarchive file to export"),
      exportPath: z.string().describe("Directory where exported IPA and other files will be placed"),
      method: z.enum(["app-store", "ad-hoc", "enterprise", "development"]).describe("Distribution method"),
      teamId: z.string().optional().describe("Team ID for code signing. If not provided, will try to use the default team."),
      signingCertificate: z.string().optional().describe("Signing certificate to use. If not provided, will try to use the default certificate for the selected method."),
      provisioningProfiles: z.record(z.string()).optional().describe("Dictionary mapping bundle identifiers to provisioning profile names."),
      compileBitcode: z.boolean().optional().describe("Whether to compile Bitcode. Default is true for App Store, false otherwise."),
      stripSwiftSymbols: z.boolean().optional().describe("Whether to strip Swift symbols. Default is true.")
    },
    async ({ archivePath, exportPath, method, teamId, signingCertificate, provisioningProfiles, compileBitcode, stripSwiftSymbols }) => {
      try {
        // Validate paths
        const resolvedArchivePath = server.pathManager.normalizePath(archivePath);
        server.pathManager.validatePathForReading(resolvedArchivePath);

        const resolvedExportPath = server.pathManager.normalizePath(exportPath);
        server.pathManager.validatePathForWriting(resolvedExportPath);

        // Ensure the archive exists
        try {
          const stats = await fs.stat(resolvedArchivePath);
          if (!stats.isDirectory()) {
            throw new Error(`Archive path is not a directory: ${archivePath}`);
          }

          // Check if it's a valid .xcarchive
          if (!resolvedArchivePath.endsWith('.xcarchive')) {
            throw new Error(`Archive path must end with .xcarchive: ${archivePath}`);
          }
        } catch (error) {
          throw new Error(`Archive not found: ${archivePath}`);
        }

        // Create the export directory if it doesn't exist
        await fs.mkdir(resolvedExportPath, { recursive: true });

        // Create a temporary exportOptions.plist file
        const tempDir = path.join(resolvedExportPath, 'temp_export_options');
        await fs.mkdir(tempDir, { recursive: true });
        const exportOptionsPath = path.join(tempDir, 'exportOptions.plist');

        // Build the export options plist content
        let exportOptionsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>method</key>
\t<string>${method}</string>
`;

        // Add team ID if provided
        if (teamId) {
          exportOptionsContent += `\t<key>teamID</key>
\t<string>${teamId}</string>
`;
        }

        // Add signing certificate if provided
        if (signingCertificate) {
          exportOptionsContent += `\t<key>signingCertificate</key>
\t<string>${signingCertificate}</string>
`;
        }

        // Add compileBitcode option if provided
        if (compileBitcode !== undefined) {
          exportOptionsContent += `\t<key>compileBitcode</key>
\t<${compileBitcode ? 'true' : 'false'}/>
`;
        }

        // Add stripSwiftSymbols option if provided
        if (stripSwiftSymbols !== undefined) {
          exportOptionsContent += `\t<key>stripSwiftSymbols</key>
\t<${stripSwiftSymbols ? 'true' : 'false'}/>
`;
        }

        // Add provisioning profiles if provided
        if (provisioningProfiles && Object.keys(provisioningProfiles).length > 0) {
          exportOptionsContent += `\t<key>provisioningProfiles</key>
\t<dict>
`;

          for (const [bundleId, profileName] of Object.entries(provisioningProfiles)) {
            exportOptionsContent += `\t\t<key>${bundleId}</key>
\t\t<string>${profileName}</string>
`;
          }

          exportOptionsContent += `\t</dict>
`;
        }

        // Close the plist
        exportOptionsContent += `</dict>
</plist>
`;

        // Write the export options plist
        await fs.writeFile(exportOptionsPath, exportOptionsContent, 'utf-8');

        // Run the export command
        const cmd = `xcrun xcodebuild -exportArchive -archivePath "${resolvedArchivePath}" -exportOptionsPlist "${exportOptionsPath}" -exportPath "${resolvedExportPath}"`;
        const { stdout, stderr } = await execAsync(cmd);

        // Clean up the temporary directory
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }

        // Try to find the exported IPA file
        let ipaPath = "";
        try {
          const files = await fs.readdir(resolvedExportPath);
          const ipaFile = files.find(file => file.endsWith('.ipa'));
          if (ipaFile) {
            ipaPath = path.join(resolvedExportPath, ipaFile);
          }
        } catch {
          // Ignore errors finding IPA
        }

        return {
          content: [{
            type: "text",
            text: `Archive exported successfully to ${resolvedExportPath}\n` +
                  (ipaPath ? `IPA file: ${ipaPath}\n\n` : "\n") +
                  `Export method: ${method}\n\n` +
                  `Export log:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }

          // Check for common export errors
          if (stderr) {
            if (stderr.includes("No signing certificate")) {
              throw new Error("Export failed: No signing certificate found. Make sure you have a valid signing certificate installed.");
            }
            if (stderr.includes("requires a provisioning profile")) {
              throw new Error("Export failed: Missing provisioning profile. Make sure you have a valid provisioning profile for your app.");
            }
            if (stderr.includes("doesn't match the identity")) {
              throw new Error("Export failed: Provisioning profile doesn't match the signing identity. Check your team ID and certificate.");
            }
          }

          throw new Error(
            `Failed to export archive: ${stderr || (error instanceof Error ? error.message : String(error))}`
          );
        }
      }
    }
  );

  // Register "validate_app"
  server.server.tool(
    "validate_app",
    "Validate an app for App Store submission using altool",
    {
      ipaPath: z.string().describe("Path to the .ipa file to validate"),
      username: z.string().describe("App Store Connect username (usually an email)"),
      password: z.string().describe("App-specific password for the App Store Connect account"),
      apiKey: z.string().optional().describe("API Key ID (alternative to username/password)"),
      apiIssuer: z.string().optional().describe("API Key Issuer ID (required if using apiKey)"),
      apiKeyPath: z.string().optional().describe("Path to the API Key .p8 file (required if using apiKey)")
    },
    async ({ ipaPath, username, password, apiKey, apiIssuer, apiKeyPath }) => {
      try {
        // Validate paths
        const resolvedIpaPath = server.pathManager.normalizePath(ipaPath);
        server.pathManager.validatePathForReading(resolvedIpaPath);

        // Ensure the IPA exists
        try {
          const stats = await fs.stat(resolvedIpaPath);
          if (!stats.isFile()) {
            throw new Error(`IPA path is not a file: ${ipaPath}`);
          }

          // Check if it's a valid .ipa
          if (!resolvedIpaPath.endsWith('.ipa')) {
            throw new Error(`IPA path must end with .ipa: ${ipaPath}`);
          }
        } catch (error) {
          throw new Error(`IPA file not found: ${ipaPath}`);
        }

        // Validate API Key path if provided
        if (apiKey && apiKeyPath) {
          const resolvedApiKeyPath = server.pathManager.normalizePath(apiKeyPath);
          server.pathManager.validatePathForReading(resolvedApiKeyPath);

          try {
            const stats = await fs.stat(resolvedApiKeyPath);
            if (!stats.isFile()) {
              throw new Error(`API Key path is not a file: ${apiKeyPath}`);
            }
          } catch (error) {
            throw new Error(`API Key file not found: ${apiKeyPath}`);
          }
        }

        // Build the validation command
        let cmd;

        if (apiKey && apiIssuer && apiKeyPath) {
          // Use API Key authentication
          const resolvedApiKeyPath = server.pathManager.normalizePath(apiKeyPath);
          cmd = `xcrun altool --validate-app -f "${resolvedIpaPath}" --apiKey "${apiKey}" --apiIssuer "${apiIssuer}" --api-key-path "${resolvedApiKeyPath}" --type ios`;
        } else {
          // Use username/password authentication
          cmd = `xcrun altool --validate-app -f "${resolvedIpaPath}" -u "${username}" -p "${password}" --type ios`;
        }

        const { stdout, stderr } = await execAsync(cmd);

        // Check for validation success
        if (stdout.includes("No errors validating")) {
          return {
            content: [{
              type: "text",
              text: `App validation successful! The app is ready for submission to the App Store.\n\nValidation output:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        } else {
          // There were validation issues
          return {
            content: [{
              type: "text",
              text: `App validation completed with issues. Please review the validation output:\n\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
            }]
          };
        }
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for common validation errors
        if (stderr) {
          if (stderr.includes("Invalid username and password")) {
            throw new Error("Validation failed: Invalid username and password. Make sure your App Store Connect credentials are correct.");
          }
          if (stderr.includes("Unable to validate archive")) {
            throw new Error("Validation failed: Unable to validate archive. The IPA file might be corrupted or not properly signed.");
          }
          if (stderr.includes("API Key not found")) {
            throw new Error("Validation failed: API Key not found. Make sure the API Key ID and path are correct.");
          }
        }

        throw new Error(
          `Failed to validate app: ${stderr || (error instanceof Error ? error.message : String(error))}`
        );
      }
    }
  );

  // Register "generate_icon_set"
  server.server.tool(
    "generate_icon_set",
    "Generate an app icon set from a source image",
    {
      sourceImage: z.string().describe("Path to the source image (should be at least 1024x1024)"),
      outputPath: z.string().describe("Path where to create the AppIcon.appiconset directory"),
      platform: z.enum(["ios", "macos", "watchos"]).optional().describe("Target platform (default: ios)")
    },
    async ({ sourceImage, outputPath, platform = "ios" }) => {
      try {
        // Validate paths
        const resolvedSourceImage = server.pathManager.normalizePath(sourceImage);
        server.pathManager.validatePathForReading(resolvedSourceImage);

        const resolvedOutputPath = server.pathManager.normalizePath(outputPath);
        server.pathManager.validatePathForWriting(resolvedOutputPath);

        // Ensure the source image exists
        try {
          const stats = await fs.stat(resolvedSourceImage);
          if (!stats.isFile()) {
            throw new Error(`Source image is not a file: ${sourceImage}`);
          }
        } catch (error) {
          throw new Error(`Source image not found: ${sourceImage}`);
        }

        // Create the AppIcon.appiconset directory
        const iconsetPath = path.join(resolvedOutputPath, "AppIcon.appiconset");
        await fs.mkdir(iconsetPath, { recursive: true });

        // Define icon sizes based on platform
        const iconSizes = {
          ios: [
            { size: 20, scales: [1, 2, 3] },
            { size: 29, scales: [1, 2, 3] },
            { size: 40, scales: [1, 2, 3] },
            { size: 60, scales: [2, 3] },
            { size: 76, scales: [1, 2] },
            { size: 83.5, scales: [2] },
            { size: 1024, scales: [1] } // App Store
          ],
          macos: [
            { size: 16, scales: [1, 2] },
            { size: 32, scales: [1, 2] },
            { size: 64, scales: [1, 2] },
            { size: 128, scales: [1, 2] },
            { size: 256, scales: [1, 2] },
            { size: 512, scales: [1, 2] },
            { size: 1024, scales: [1] }
          ],
          watchos: [
            { size: 24, scales: [2] },
            { size: 27.5, scales: [2] },
            { size: 29, scales: [2, 3] },
            { size: 40, scales: [2] },
            { size: 44, scales: [2] },
            { size: 50, scales: [2] },
            { size: 86, scales: [2] },
            { size: 98, scales: [2] },
            { size: 108, scales: [2] },
            { size: 1024, scales: [1] }
          ]
        };

        // Create Contents.json
        const contentsJson = {
          images: [],
          info: {
            version: 1,
            author: "xcode-mcp-server"
          }
        };

        // Generate the resize commands and add to Contents.json
        for (const { size, scales } of iconSizes[platform]) {
          for (const scale of scales) {
            const pixelSize = Math.round(size * scale);
            const filename = `icon_${size}x${size}@${scale}x.png`;
            const outputFilePath = path.join(iconsetPath, filename);

            // Generate the resized image
            const resizeCmd = `sips -Z ${pixelSize} "${resolvedSourceImage}" --out "${outputFilePath}"`;
            await execAsync(resizeCmd);

            // Add to Contents.json
            (contentsJson.images as any[]).push({
              size: `${size}x${size}`,
              idiom: platform === "macos" ? "mac" : platform === "watchos" ? "watch" : "iphone",
              filename,
              scale: `${scale}x`
            });
          }
        }

        // Write Contents.json
        await fs.writeFile(
          path.join(iconsetPath, "Contents.json"),
          JSON.stringify(contentsJson, null, 2),
          "utf-8"
        );

      return {
        content: [{
            type: "text",
            text: `App icon set generated successfully at ${iconsetPath}\n\nThe icon set includes ${(contentsJson.images as any[]).length} icon sizes for ${platform} platform.`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        } else {
          let stderr = '';
          if (error instanceof Error && 'stderr' in error) {
            stderr = (error as any).stderr;
          }
          throw new Error(
            `Failed to generate icon set: ${stderr || (error instanceof Error ? error.message : String(error))}`
          );
        }
      }
    }
  );
}