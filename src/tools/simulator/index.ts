import { z } from "zod";
import { promisify } from "util";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { XcodeServer } from "../../server.js";
import { CommandExecutionError, PathAccessError } from "../../utils/errors.js";

const execAsync = promisify(exec);

interface SimulatorInfo {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
  runtime: string;
}

/**
 * Parse simulator device information from simctl output
 */
function parseSimulatorDevices(simctlOutput: string): SimulatorInfo[] {
  try {
    const simctlData = JSON.parse(simctlOutput);
    const simulators: SimulatorInfo[] = [];

    // Process the devices object in the simctl output
    if (simctlData && simctlData.devices) {
      // Iterate through each runtime
      Object.entries(simctlData.devices).forEach(([runtimeName, devices]: [string, any]) => {
        // Extract the iOS version from runtime name
        // Handle different formats:
        // - "com.apple.CoreSimulator.SimRuntime.iOS-17-0"
        // - "iOS 17.0"
        // - "com.apple.CoreSimulator.SimRuntime.tvOS-17-0"
        // - "com.apple.CoreSimulator.SimRuntime.watchOS-10-0"
        let runtimeVersion = runtimeName;

        // Try to extract platform and version
        const platformMatch = runtimeName.match(/\.([a-zA-Z]+)OS-([\d]+)-([\d]+)/);
        if (platformMatch) {
          const platform = platformMatch[1];
          const major = platformMatch[2];
          const minor = platformMatch[3];
          runtimeVersion = `${platform}OS ${major}.${minor}`;
        } else {
          // Try direct format like "iOS 17.0"
          const directMatch = runtimeName.match(/([a-zA-Z]+)OS\s+([\d]+\.[\d]+)/);
          if (directMatch) {
            runtimeVersion = runtimeName; // Already in the desired format
          }
        }

        // Process each device in the runtime
        if (Array.isArray(devices)) {
          devices.forEach(device => {
            if (device.name && device.udid) {
              simulators.push({
                name: device.name,
                udid: device.udid,
                state: device.state || 'unknown',
                isAvailable: device.isAvailable === true,
                runtime: runtimeVersion
              });
            }
          });
        }
      });
    }

    return simulators;
  } catch (error) {
    console.error("Error parsing simulator data:", error);
    return [];
  }
}

/**
 * Get the current booted simulators
 * @returns Array of booted simulator information
 */
async function getBootedSimulators(): Promise<SimulatorInfo[]> {
  try {
    const { stdout } = await execAsync("xcrun simctl list --json");
    const allSimulators = parseSimulatorDevices(stdout);
    return allSimulators.filter(sim => sim.state === 'Booted');
  } catch (error) {
    console.error("Error getting booted simulators:", error);
    return [];
  }
}

/**
 * Register iOS Simulator related tools
 */
export function registerSimulatorTools(server: XcodeServer) {
  // Register "list_booted_simulators"
  server.server.tool(
    "list_booted_simulators",
    "List all currently booted iOS simulators",
    {},
    async () => {
      try {
        const bootedSimulators = await getBootedSimulators();

        if (bootedSimulators.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No simulators are currently booted."
            }]
          };
        }

        let outputText = `Currently Booted Simulators (${bootedSimulators.length}):\n\n`;

        // Group by runtime
        const byRuntime: Record<string, SimulatorInfo[]> = {};
        bootedSimulators.forEach(sim => {
          if (!byRuntime[sim.runtime]) {
            byRuntime[sim.runtime] = [];
          }
          byRuntime[sim.runtime].push(sim);
        });

        // Format output by runtime groups
        Object.entries(byRuntime).forEach(([runtime, sims]) => {
          outputText += `== ${runtime} ==\n`;
          sims.forEach(sim => {
            outputText += `${sim.name}\n`;
            outputText += `UDID: ${sim.udid}\n\n`;
          });
        });

        return {
          content: [{
            type: "text",
            text: outputText
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'list_booted_simulators',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
  // Register "list_simulators"
  server.server.tool(
    "list_simulators",
    "List all available iOS simulators with filtering options",
    {
      format: z.enum(["json", "parsed"]).optional().describe("Output format (json for raw data, parsed for structured data). Defaults to parsed."),
      filterRuntime: z.string().optional().describe("Filter simulators by runtime (e.g., 'iOS 16')"),
      filterState: z.enum(["booted", "shutdown"]).optional().describe("Filter simulators by state"),
      filterName: z.string().optional().describe("Filter simulators by name (case-insensitive substring match)")
    },
    async ({ format = "parsed", filterRuntime, filterState, filterName }) => {
      try {
      const { stdout, stderr } = await execAsync("xcrun simctl list --json");

        if (format === "json") {
      return {
        content: [{
              type: "text",
              text: stdout
            }]
          };
        }

        // Parse simulator data
        const simulators = parseSimulatorDevices(stdout);

        // Apply filters if specified
        let filteredSimulators = simulators;

        if (filterRuntime) {
          filteredSimulators = filteredSimulators.filter(
            sim => sim.runtime.toLowerCase().includes(filterRuntime.toLowerCase())
          );
        }

        if (filterState) {
          const state = filterState === "booted" ? "Booted" : "Shutdown";
          filteredSimulators = filteredSimulators.filter(sim => sim.state === state);
        }

        if (filterName) {
          filteredSimulators = filteredSimulators.filter(
            sim => sim.name.toLowerCase().includes(filterName.toLowerCase())
          );
        }

        // Generate formatted output
        let outputText = `Available Simulators (${filteredSimulators.length}):\n\n`;
        if (filteredSimulators.length === 0) {
          outputText += "No simulators found matching your criteria.";
        } else {
          // Group by runtime
          const byRuntime: Record<string, SimulatorInfo[]> = {};
          filteredSimulators.forEach(sim => {
            if (!byRuntime[sim.runtime]) {
              byRuntime[sim.runtime] = [];
            }
            byRuntime[sim.runtime].push(sim);
          });

          // Format output by runtime groups
          Object.entries(byRuntime).forEach(([runtime, sims]) => {
            outputText += `== ${runtime} ==\n`;
            sims.forEach(sim => {
              const status = sim.state === "Booted" ? "🟢 Booted" : "⚪ Shutdown";
              outputText += `${sim.name} (${status})\n`;
              outputText += `UDID: ${sim.udid}\n\n`;
            });
          });
        }

        return {
          content: [{
            type: "text",
            text: outputText + (stderr ? '\nError output:\n' + stderr : '')
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }
        throw new CommandExecutionError(
          'xcrun simctl list',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "boot_simulator"
  server.server.tool(
    "boot_simulator",
    "Boot an iOS simulator by UDID or name",
    {
      udid: z.string().optional().describe("The UDID of the simulator to boot"),
      name: z.string().optional().describe("The name of the simulator to boot (will use the most recent iOS version if multiple match)"),
      runtime: z.string().optional().describe("When using name, optionally specify the iOS runtime version (e.g., 'iOS 16')")
    },
    async ({ udid, name, runtime }) => {
      try {
        // Either udid or name must be provided
        if (!udid && !name) {
          throw new Error("Either udid or name parameter must be provided");
        }

        // If name is provided, we need to find the matching simulator
        if (name && !udid) {
          const { stdout } = await execAsync("xcrun simctl list --json");
          const simulators = parseSimulatorDevices(stdout);

          // Filter by name (case insensitive)
          let matches = simulators.filter(
            sim => sim.name.toLowerCase() === name.toLowerCase()
          );

          // Further filter by runtime if specified
          if (runtime && matches.length > 0) {
            const runtimeMatches = matches.filter(
              sim => sim.runtime.toLowerCase().includes(runtime.toLowerCase())
            );

            if (runtimeMatches.length > 0) {
              matches = runtimeMatches;
            }
          }

          if (matches.length === 0) {
            throw new Error(`No simulator found with name "${name}"${runtime ? ` and runtime "${runtime}"` : ''}`);
          }

          // Sort by iOS version (descending) and pick the first one
          matches.sort((a, b) => {
            const versionA = a.runtime.match(/iOS (\d+)\.(\d+)/);
            const versionB = b.runtime.match(/iOS (\d+)\.(\d+)/);

            if (!versionA) return 1;
            if (!versionB) return -1;

            const majorA = parseInt(versionA[1]);
            const majorB = parseInt(versionB[1]);

            if (majorA !== majorB) return majorB - majorA;

            const minorA = parseInt(versionA[2]);
            const minorB = parseInt(versionB[2]);

            return minorB - minorA;
          });

          // Use the highest iOS version
          udid = matches[0].udid;
        }

        // Boot the simulator
      const { stdout, stderr } = await execAsync(`xcrun simctl boot "${udid}"`);

        return {
          content: [{
            type: "text",
            text: `Booted simulator:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("Unable to boot device in current state: Booted")) {
            return {
              content: [{
                type: "text",
                text: "Simulator is already booted and running."
              }]
            };
          }

          if (errorMsg.includes("Invalid device")) {
            throw new Error(`Invalid simulator UDID: "${udid}". Use the list_simulators command to get a valid UDID.`);
          }

          if (errorMsg.includes("Unable to boot device in current state: Creating")) {
            throw new Error("Simulator is currently being created. Please wait a moment and try again.");
          }

          if (errorMsg.includes("Unable to boot device in current state: Shutting Down")) {
            throw new Error("Simulator is currently shutting down. Please wait a moment and try again.");
          }

          if (errorMsg.includes("Unable to lookup in current state: Deleting")) {
            throw new Error("Simulator is currently being deleted. Please wait a moment and try again.");
          }

          if (errorMsg.includes("Unable to lookup in current state: Creating")) {
            throw new Error("Simulator is currently being created. Please wait a moment and try again.");
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl boot',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "shutdown_simulator"
  server.server.tool(
    "shutdown_simulator",
    "Shutdown a simulator by UDID, or shutdown all running simulators",
    {
      udid: z.string().optional().describe("The UDID of the simulator to shutdown"),
      all: z.boolean().optional().describe("Shutdown all running simulators")
    },
    async ({ udid, all = false }) => {
      try {
        // Either udid or all must be provided
        if (!udid && !all) {
          throw new Error("Either udid parameter or all=true must be provided");
        }

        let command;
        if (all) {
          // Shutdown all simulators
          command = "xcrun simctl shutdown all";
        } else {
          // Shutdown specific simulator
          command = `xcrun simctl shutdown "${udid}"`;
        }

        const { stdout, stderr } = await execAsync(command);

        return {
          content: [{
            type: "text",
            text: `Shutdown simulator${all ? 's' : ''}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("Unable to shutdown device in current state: Shutdown")) {
            return {
              content: [{
                type: "text",
                text: "Simulator is already shut down."
              }]
            };
          }

          if (errorMsg.includes("Invalid device")) {
            throw new Error(`Invalid simulator UDID: "${udid}". Use the list_simulators command to get a valid UDID.`);
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl shutdown',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "install_app"
  server.server.tool(
    "install_app",
    "Install an app on a simulator",
    {
      udid: z.string().describe("The UDID of the simulator"),
      appPath: z.string().describe("Path to the .app bundle to install")
    },
    async ({ udid, appPath }) => {
      try {
        // Validate the app path
        const resolvedAppPath = server.pathManager.normalizePath(appPath);
        server.pathManager.validatePathForReading(resolvedAppPath);

        // Check if path exists and is a directory with .app extension
        try {
          const stat = await fs.stat(resolvedAppPath);
          if (!stat.isDirectory() || !resolvedAppPath.endsWith('.app')) {
            throw new Error(`The specified path is not a valid .app bundle: ${appPath}`);
          }
        } catch (err) {
          throw new Error(`The app bundle doesn't exist: ${appPath}`);
        }

        // Install the app
        const { stdout, stderr } = await execAsync(`xcrun simctl install "${udid}" "${resolvedAppPath}"`);

        return {
          content: [{
            type: "text",
            text: `Installed app on simulator:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        }

        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        throw new CommandExecutionError(
          'xcrun simctl install',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "launch_app"
  server.server.tool(
    "launch_app",
    "Launch an installed app on a simulator",
    {
      udid: z.string().describe("The UDID of the simulator"),
      bundleId: z.string().describe("Bundle identifier of the app to launch"),
      waitForDebugger: z.boolean().optional().describe("Wait for a debugger to attach before starting the app"),
      args: z.array(z.string()).optional().describe("Arguments to pass to the app on launch")
    },
    async ({ udid, bundleId, waitForDebugger = false, args = [] }) => {
      try {
        // Build the command
        let command = `xcrun simctl launch ${waitForDebugger ? '-w' : ''}`;

        // Add the UDID and bundle ID
        command += ` "${udid}" "${bundleId}"`;

        // Add any arguments
        if (args.length > 0) {
          command += ` ${args.map(arg => `"${arg}"`).join(' ')}`;
        }

        const { stdout, stderr } = await execAsync(command);

        return {
          content: [{
            type: "text",
            text: `Launched app on simulator:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("No such file or directory")) {
            throw new Error(`App with bundle ID "${bundleId}" is not installed on the simulator. Install it first with the install_app command.`);
          }

          if (errorMsg.includes("Invalid device")) {
            throw new Error(`Invalid simulator UDID: "${udid}". Use the list_simulators command to get a valid UDID.`);
          }

          if (errorMsg.includes("Unable to lookup in current state: Shutdown")) {
            throw new Error(`Simulator is not booted. Boot the simulator first with the boot_simulator command.`);
          }

          if (errorMsg.includes("Failed to get launch task for")) {
            throw new Error(`Failed to launch app. The app might be in a bad state. Try terminating it first with the terminate_app command.`);
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl launch',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "terminate_app"
  server.server.tool(
    "terminate_app",
    "Terminate a running app on a simulator",
    {
      udid: z.string().describe("The UDID of the simulator"),
      bundleId: z.string().describe("Bundle identifier of the app to terminate")
    },
    async ({ udid, bundleId }) => {
      try {
        const { stdout, stderr } = await execAsync(`xcrun simctl terminate "${udid}" "${bundleId}"`);

        return {
          content: [{
            type: "text",
            text: `Terminated app on simulator:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("No matching processes belonging to")) {
      return {
        content: [{
                type: "text",
                text: `App with bundle ID "${bundleId}" is not running on the simulator.`
              }]
            };
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl terminate',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "open_url"
  server.server.tool(
    "open_url",
    "Open a URL in a simulator",
    {
      udid: z.string().describe("The UDID of the simulator"),
      url: z.string().describe("The URL to open")
    },
    async ({ udid, url }) => {
      try {
        // Validate URL format
        try {
          new URL(url);
        } catch {
          throw new Error(`Invalid URL format: ${url}`);
        }

        const { stdout, stderr } = await execAsync(`xcrun simctl openurl "${udid}" "${url}"`);

        return {
          content: [{
            type: "text",
            text: `Opened URL on simulator:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        throw new CommandExecutionError(
          'xcrun simctl openurl',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "take_screenshot"
  server.server.tool(
    "take_screenshot",
    "Take a screenshot of a simulator",
    {
      udid: z.string().describe("The UDID of the simulator"),
      outputPath: z.string().describe("Path where to save the screenshot (PNG format)")
    },
    async ({ udid, outputPath }) => {
      try {
        // Validate and resolve the output path
        const resolvedOutputPath = server.pathManager.normalizePath(outputPath);
        server.pathManager.validatePathForWriting(resolvedOutputPath);

        // Ensure the directory exists
        const outputDir = path.dirname(resolvedOutputPath);
        await fs.mkdir(outputDir, { recursive: true });

        // Take the screenshot
        const { stdout, stderr } = await execAsync(`xcrun simctl io "${udid}" screenshot "${resolvedOutputPath}"`);

        return {
          content: [{
            type: "text",
            text: `Screenshot saved to ${resolvedOutputPath}:\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        if (error instanceof PathAccessError) {
          throw new Error(`Access denied: ${error.message}`);
        }

        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        throw new CommandExecutionError(
          'xcrun simctl io screenshot',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "reset_simulator"
  server.server.tool(
    "reset_simulator",
    "Reset a simulator by erasing all content and settings",
    {
      udid: z.string().describe("The UDID of the simulator to reset"),
      confirm: z.boolean().describe("Confirmation to reset the simulator. Must be set to true.")
    },
    async ({ udid, confirm }) => {
      try {
        // Require explicit confirmation
        if (!confirm) {
          throw new Error("You must set confirm=true to reset a simulator. This will erase all content and settings.");
        }

        // Reset the simulator
        const { stdout, stderr } = await execAsync(`xcrun simctl erase "${udid}"`);

        return {
          content: [{
            type: "text",
            text: `Reset simulator (erased all content and settings):\n${stdout}\n${stderr ? 'Error output:\n' + stderr : ''}`
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("Invalid device")) {
            throw new Error(`Invalid simulator UDID: "${udid}". Use the list_simulators command to get a valid UDID.`);
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl erase',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );

  // Register "list_installed_apps"
  server.server.tool(
    "list_installed_apps",
    "List all installed applications on a simulator",
    {
      udid: z.string().describe("The UDID of the simulator")
    },
    async ({ udid }) => {
      try {
        // Get the list of installed apps
        const { stdout, stderr } = await execAsync(`xcrun simctl listapps "${udid}"`);

        // Parse the output to extract app information
        // The output format is a plist-like structure
        let formattedOutput = "Installed Applications:\n\n";

        // Check if we have any output
        if (stdout.trim().length === 0) {
          return {
            content: [{
              type: "text",
              text: "No applications installed on this simulator."
            }]
          };
        }

        // Try to parse the output to extract app information
        try {
          // Extract app bundle IDs and names using regex
          const appMatches = stdout.matchAll(/CFBundleIdentifier = "([^"]+)"[\s\S]*?CFBundleName = "([^"]*)"/g);
          const apps = Array.from(appMatches, match => ({
            bundleId: match[1],
            name: match[2] || match[1] // Use bundle ID as fallback if name is empty
          }));

          if (apps.length === 0) {
            formattedOutput += "Could not parse application information. Raw output:\n\n" + stdout;
          } else {
            // Sort apps by name
            apps.sort((a, b) => a.name.localeCompare(b.name));

            // Format the output
            apps.forEach(app => {
              formattedOutput += `${app.name}\n`;
              formattedOutput += `Bundle ID: ${app.bundleId}\n\n`;
            });

            formattedOutput += `Total: ${apps.length} applications`;
          }
        } catch (parseError) {
          formattedOutput += "Error parsing application information. Raw output:\n\n" + stdout;
        }

        return {
          content: [{
            type: "text",
            text: formattedOutput + (stderr ? '\nError output:\n' + stderr : '')
          }]
        };
      } catch (error) {
        let stderr = '';
        if (error instanceof Error && 'stderr' in error) {
          stderr = (error as any).stderr;
        }

        // Check for specific error patterns and provide helpful messages
        if (error instanceof Error) {
          const errorMsg = stderr || error.message;

          if (errorMsg.includes("Invalid device")) {
            throw new Error(`Invalid simulator UDID: "${udid}". Use the list_simulators command to get a valid UDID.`);
          }

          if (errorMsg.includes("Unable to lookup in current state: Shutdown")) {
            throw new Error(`Simulator is not booted. Boot the simulator first with the boot_simulator command.`);
          }
        }

        throw new CommandExecutionError(
          'xcrun simctl listapps',
          stderr || (error instanceof Error ? error.message : String(error))
        );
      }
    }
  );
}