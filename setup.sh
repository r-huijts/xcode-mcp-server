#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Xcode MCP Server - Setup Script${NC}"
echo -e "${GREEN}======================================${NC}"
echo

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}Error: This script must be run on macOS.${NC}"
  exit 1
fi

# Check for Xcode installation
echo -e "Checking Xcode installation..."
if ! xcode-select -p &> /dev/null; then
  echo -e "${RED}Error: Xcode or Xcode Command Line Tools are not installed.${NC}"
  echo -e "Please install Xcode from the App Store or run 'xcode-select --install' to install the Command Line Tools."
  exit 1
else
  echo -e "${GREEN}✓ Xcode is installed${NC}"
fi

# Check for Node.js
echo -e "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  echo -e "Please install Node.js from https://nodejs.org/ (version 16 or higher recommended)."
  exit 1
else
  NODE_VERSION=$(node -v | cut -d 'v' -f 2)
  MAJOR_VERSION=$(echo $NODE_VERSION | cut -d '.' -f 1)
  if [[ $MAJOR_VERSION -lt 16 ]]; then
    echo -e "${YELLOW}Warning: Node.js version $NODE_VERSION detected. Version 16 or higher is recommended.${NC}"
  else
    echo -e "${GREEN}✓ Node.js v$NODE_VERSION is installed${NC}"
  fi
fi

# Check for npm
echo -e "Checking npm installation..."
if ! command -v npm &> /dev/null; then
  echo -e "${RED}Error: npm is not installed.${NC}"
  echo -e "npm should be installed with Node.js. Please reinstall Node.js."
  exit 1
else
  NPM_VERSION=$(npm -v)
  echo -e "${GREEN}✓ npm v$NPM_VERSION is installed${NC}"
fi

# Install dependencies
echo -e "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
  echo -e "${RED}Error: Failed to install dependencies.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ Dependencies installed successfully${NC}"
fi

# Build the project
echo -e "Building the project..."
npm run build
if [ $? -ne 0 ]; then
  echo -e "${RED}Error: Failed to build the project.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ Project built successfully${NC}"
fi

# Create .env file if it doesn't exist
if [[ ! -f .env ]]; then
  echo -e "Creating .env configuration file..."
  echo "# Xcode MCP Server Configuration" > .env
  echo >> .env
  
  # Ask for projects base directory
  echo -e "Enter the base directory for your Xcode projects (leave empty for default):"
  read -p "> " PROJECTS_DIR
  
  if [[ -n "$PROJECTS_DIR" ]]; then
    # Expand ~ if used
    PROJECTS_DIR="${PROJECTS_DIR/#\~/$HOME}"
    
    # Check if directory exists
    if [[ ! -d "$PROJECTS_DIR" ]]; then
      echo -e "${YELLOW}Warning: Directory '$PROJECTS_DIR' does not exist. It will be created when needed.${NC}"
    fi
    
    echo "PROJECTS_BASE_DIR=$PROJECTS_DIR" >> .env
    echo -e "${GREEN}✓ Projects directory set to $PROJECTS_DIR${NC}"
  else
    echo "# PROJECTS_BASE_DIR=/path/to/your/projects" >> .env
    echo -e "${YELLOW}No projects directory specified. You'll need to set it later or let the server auto-detect projects.${NC}"
  fi
  
  # Add debug option
  echo -e "Enable debug logging? (y/n):"
  read -p "> " ENABLE_DEBUG
  if [[ "$ENABLE_DEBUG" == "y" || "$ENABLE_DEBUG" == "Y" ]]; then
    echo "DEBUG=true" >> .env
    echo -e "${GREEN}✓ Debug logging enabled${NC}"
  else
    echo "DEBUG=false" >> .env
    echo -e "${GREEN}✓ Debug logging disabled${NC}"
  fi
  
  echo -e "${GREEN}✓ .env file created${NC}"
else
  echo -e "${YELLOW}A .env file already exists. Keeping existing configuration.${NC}"
fi

# Configure for Claude Desktop (if desired)
echo -e "Would you like to configure this server for Claude Desktop? (y/n):"
read -p "> " CONFIGURE_CLAUDE
if [[ "$CONFIGURE_CLAUDE" == "y" || "$CONFIGURE_CLAUDE" == "Y" ]]; then
  CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
  CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
  
  # Check if Claude Desktop config directory exists
  if [[ ! -d "$CLAUDE_CONFIG_DIR" ]]; then
    echo -e "${YELLOW}Claude Desktop config directory not found. Creating...${NC}"
    mkdir -p "$CLAUDE_CONFIG_DIR"
  fi
  
  # Check if config file exists, create or update it
  if [[ -f "$CLAUDE_CONFIG_FILE" ]]; then
    # Backup existing config
    cp "$CLAUDE_CONFIG_FILE" "${CLAUDE_CONFIG_FILE}.backup"
    echo -e "${GREEN}✓ Backed up existing Claude Desktop config${NC}"
    
    # Simple update using cat and jq if available
    if command -v jq &> /dev/null; then
      SERVER_PATH=$(pwd)
      EXEC_PATH="$SERVER_PATH/dist/index.js"
      
      if [[ -f "$EXEC_PATH" ]]; then
        # Update config using jq
        jq --arg path "$EXEC_PATH" '.mcpServers.xcode = {"command": "node", "args": [$path]}' "$CLAUDE_CONFIG_FILE" > "${CLAUDE_CONFIG_FILE}.new"
        mv "${CLAUDE_CONFIG_FILE}.new" "$CLAUDE_CONFIG_FILE"
        echo -e "${GREEN}✓ Updated Claude Desktop configuration${NC}"
      else
        echo -e "${RED}Error: Built server not found at $EXEC_PATH${NC}"
        echo -e "Please complete the setup manually by editing the Claude Desktop config file."
      fi
    else
      echo -e "${YELLOW}jq not found. Manual configuration instructions:${NC}"
      echo -e "1. Edit the file: $CLAUDE_CONFIG_FILE"
      echo -e "2. Add the Xcode MCP Server configuration as shown in the README.md"
      echo -e "3. Restart Claude Desktop"
    fi
  else
    # Create new config file
    SERVER_PATH=$(pwd)
    EXEC_PATH="$SERVER_PATH/dist/index.js"
    
    echo '{
  "mcpServers": {
    "xcode": {
      "command": "node",
      "args": ["'"$EXEC_PATH"'"]
    }
  }
}' > "$CLAUDE_CONFIG_FILE"
    
    echo -e "${GREEN}✓ Created Claude Desktop configuration file${NC}"
  fi
  
  echo -e "${YELLOW}Important: Restart Claude Desktop for the changes to take effect.${NC}"
fi

echo
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo
echo -e "To start the server:"
echo -e "  ${YELLOW}npm start${NC}"
echo
echo -e "For more information, please refer to the README.md file."
echo 