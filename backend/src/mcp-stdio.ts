// Claude Desktop / Claude Code için yerel MCP sunucusu (stdio).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import os from "node:os";
import { createMcpServer } from "./mcp.js";

await createMcpServer(os.userInfo().username).connect(new StdioServerTransport());
