#!/usr/bin/env node

import { XcodeServer } from './server.js';

// Main function to initialize and start the server with proper error handling
async function main() {
  try {
    const server = new XcodeServer();
    await server.start();
  } catch (error) {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("Unhandled exception:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});