import { execFile } from "child_process";
import { promisify } from "util";
import { CommandExecutionError } from "./errors.js";

const execFileAsync = promisify(execFile);

export interface RunExecFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}

/**
 * Run a binary with argument array. No shell is invoked; arguments are passed
 * literally to the process. Use this instead of exec() to prevent CWE-78
 * command injection when any argument is or could be user-controlled.
 */
export async function runExecFile(
  file: string,
  args: string[],
  options?: RunExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(file, args, {
      encoding: "utf8",
      ...options,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: string }).stderr)
        : "";
    const message =
      error instanceof Error ? error.message : String(error);
    throw new CommandExecutionError(
      [file, ...args].join(" "),
      stderr || message
    );
  }
}
