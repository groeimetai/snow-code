import z from "zod/v4"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { ToolSearch } from "./tool-search"
import { MCP } from "../mcp"

const log = Log.create({ service: "deferred-executor" })

/**
 * Deferred Tool Executor - Proxy tool for executing enabled deferred tools
 *
 * This tool allows the AI to execute any tool that has been enabled via tool_search,
 * even though those tools are not in the initial tools list.
 *
 * Flow:
 * 1. AI uses tool_search to find and enable tools
 * 2. AI uses deferred_tool_executor to call those tools with arguments
 * 3. This proxy validates the tool is enabled and executes it
 */
export const DeferredToolExecutor = Tool.define("deferred_tool_executor", {
  description: `Execute a deferred tool that was enabled via tool_search.

IMPORTANT: After using tool_search to find and enable tools, you MUST use this executor to call those tools.
Do NOT try to call the tools directly - they are not in your available tools list.

Usage:
1. First use tool_search to find tools (e.g., tool_search({query: "incident"}))
2. Note the tool names from the results (e.g., "servicenow-unified_snow_query_incidents")
3. Call this executor with the tool name and arguments

Example:
deferred_tool_executor({
  tool_name: "servicenow-unified_snow_get_instance_info",
  arguments: {}
})`,
  parameters: z.object({
    tool_name: z.string().describe("The exact name of the tool to execute (from tool_search results)"),
    arguments: z
      .record(z.string(), z.any())
      .default({})
      .describe("Arguments to pass to the tool as a JSON object"),
  }),
  async execute(args, ctx) {
    const { tool_name, arguments: toolArgs } = args
    log.info("Executing deferred tool", { tool_name, sessionID: ctx.sessionID })

    // Check if tool is enabled for this session
    const isEnabled = await ToolSearch.isToolEnabled(ctx.sessionID, tool_name)
    if (!isEnabled) {
      return {
        title: "Tool Not Enabled",
        output: `The tool "${tool_name}" is not enabled for this session. Please use tool_search first to find and enable tools.

Example: tool_search({query: "${tool_name.split("_").slice(-1)[0]}"})`,
        metadata: { tool_name, success: false, error: "tool_not_enabled" },
      }
    }

    // Get the tool from MCP
    const mcpTools = await MCP.tools()
    const tool = mcpTools[tool_name]

    if (!tool) {
      return {
        title: "Tool Not Found",
        output: `The tool "${tool_name}" was not found in the available MCP tools. It may have been removed or the MCP server may not be running.`,
        metadata: { tool_name, success: false, error: "tool_not_found" },
      }
    }

    if (!tool.execute) {
      return {
        title: "Tool Not Executable",
        output: `The tool "${tool_name}" does not have an execute function.`,
        metadata: { tool_name, success: false, error: "tool_not_executable" },
      }
    }

    // Execute the tool
    try {
      log.info("Executing MCP tool via proxy", { tool_name, args: toolArgs })

      const result = await tool.execute(toolArgs, {
        toolCallId: ctx.callID || `deferred-${Date.now()}`,
        messages: [],
        abortSignal: undefined as any,
      })

      // Format the result
      if (typeof result === "string") {
        return {
          title: `${tool_name} Result`,
          output: result,
          metadata: { tool_name, success: true },
        }
      }

      // Handle object results
      const output =
        typeof result === "object"
          ? JSON.stringify(result, null, 2)
          : String(result)

      return {
        title: `${tool_name} Result`,
        output,
        metadata: { tool_name, success: true },
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error)
      log.error("Deferred tool execution failed", { tool_name, error: errorMsg })
      return {
        title: "Tool Execution Error",
        output: `Failed to execute "${tool_name}": ${errorMsg}`,
        metadata: { tool_name, success: false, error: errorMsg },
      }
    }
  },
})
