import z from "zod/v4"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { ToolSearch } from "./tool-search"
import { MCP } from "../mcp"

const log = Log.create({ service: "deferred-executor" })

/**
 * Format helpers for pretty output
 */
function formatToolName(toolName: string): string {
  // Extract readable name from tool_name like "servicenow-unified_snow_create_widget"
  const parts = toolName.split("_")
  const action = parts.find((p) => ["create", "update", "delete", "query", "get", "list", "search", "execute"].includes(p))
  const resource = parts.slice(-1)[0] || parts.slice(-2).join(" ")
  if (action) {
    return `${action.charAt(0).toUpperCase() + action.slice(1)} ${resource}`
  }
  return toolName.split("_").slice(-2).join(" ")
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}

function formatValue(value: any, indent: number = 0): string {
  const prefix = "  ".repeat(indent)

  if (value === null || value === undefined) return `${prefix}(none)`
  if (typeof value === "boolean") return `${prefix}${value ? "Yes" : "No"}`
  if (typeof value === "number") return `${prefix}${value}`
  if (typeof value === "string") {
    // Check if it's a long string (like HTML/code)
    if (value.length > 200 || value.includes("\n")) {
      const lines = value.split("\n").length
      const chars = value.length
      return `${prefix}[${lines} lines, ${chars} chars]`
    }
    return `${prefix}${value}`
  }
  if (Array.isArray(value)) {
    return `${prefix}[${value.length} items]`
  }
  if (typeof value === "object") {
    return `${prefix}{${Object.keys(value).length} properties}`
  }
  return `${prefix}${String(value)}`
}

/**
 * Extract text content from MCP result
 */
function extractMCPContent(result: any): any {
  // Handle MCP content array format: { content: [{ type: "text", text: "..." }] }
  if (result && typeof result === "object" && Array.isArray(result.content)) {
    const textParts = result.content
      .filter((c: any) => c.type === "text" && c.text)
      .map((c: any) => c.text)

    if (textParts.length === 1) {
      // Try to parse as JSON
      try {
        return JSON.parse(textParts[0])
      } catch {
        return textParts[0]
      }
    }
    if (textParts.length > 1) {
      return textParts.join("\n")
    }
  }
  return result
}

/**
 * Format widget result nicely (plain text, no markdown)
 */
function formatWidgetResult(data: any): string {
  const lines: string[] = []
  const widget = data.widget || data

  lines.push("Widget Created Successfully")
  lines.push("")

  if (widget.sys_id) lines.push(`  sys_id:   ${widget.sys_id}`)
  if (widget.name) lines.push(`  Name:     ${widget.name}`)
  if (widget.id) lines.push(`  ID:       ${widget.id}`)
  if (widget.sys_class_name) lines.push(`  Type:     ${widget.sys_class_name}`)
  if (widget.sys_updated_on) lines.push(`  Updated:  ${widget.sys_updated_on}`)
  if (widget.sys_updated_by) lines.push(`  By:       ${widget.sys_updated_by}`)

  const components: string[] = []
  if (widget.template) {
    const templateLines = widget.template.split("\n").length
    components.push(`Template (${templateLines} lines)`)
  }
  if (widget.css) {
    const cssLines = widget.css.split("\n").length
    components.push(`CSS (${cssLines} lines)`)
  }
  if (widget.client_script) components.push("Client Script")
  if (widget.server_script) components.push("Server Script")
  if (widget.link) components.push("Link Function")

  if (components.length > 0) {
    lines.push("")
    lines.push(`  Components: ${components.join(", ")}`)
  }

  return lines.join("\n")
}

/**
 * Format incident/record result (plain text, no markdown)
 */
function formatRecordResult(data: any, recordType: string): string {
  const lines: string[] = []
  const records = Array.isArray(data) ? data : data.records || data.result || [data]

  if (Array.isArray(records) && records.length > 0) {
    lines.push(`Found ${records.length} ${recordType}(s)`)
    lines.push("")

    // Show first few records
    const displayRecords = records.slice(0, 10)
    for (const record of displayRecords) {
      const title = record.number || record.name || record.sys_id || "Record"
      lines.push(`  ${title}`)

      // Show key fields
      const keyFields = ["short_description", "description", "state", "priority", "assigned_to", "category", "sys_created_on", "sys_updated_on"]
      for (const field of keyFields) {
        if (record[field]) {
          const label = field.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
          const value = typeof record[field] === "string" && record[field].length > 100
            ? truncateString(record[field], 100)
            : record[field]
          lines.push(`    ${label}: ${value}`)
        }
      }
      lines.push("")
    }

    if (records.length > 10) {
      lines.push(`  ...and ${records.length - 10} more records`)
    }
  } else {
    lines.push(`${recordType} Result`)
    lines.push("")
    lines.push(JSON.stringify(data, null, 2))
  }

  return lines.join("\n")
}

/**
 * Format instance info result (plain text, no markdown)
 */
function formatInstanceInfo(data: any): string {
  const lines: string[] = []

  lines.push("ServiceNow Instance Information")
  lines.push("")

  if (data.instance_url) lines.push(`  URL:      ${data.instance_url}`)
  if (data.instance_name) lines.push(`  Instance: ${data.instance_name}`)
  if (data.version) lines.push(`  Version:  ${data.version}`)
  if (data.build_tag) lines.push(`  Build:    ${data.build_tag}`)
  if (data.user) lines.push(`  User:     ${data.user}`)

  return lines.join("\n")
}

/**
 * Format generic success result (plain text, no markdown)
 */
function formatGenericResult(data: any, toolName: string): string {
  const lines: string[] = []

  // Determine success status
  const success = data.success !== false && !data.error
  const statusIcon = success ? "✓" : "✗"
  const statusText = success ? "Success" : "Failed"

  lines.push(`${statusIcon} ${formatToolName(toolName)} - ${statusText}`)
  lines.push("")

  // Show error if present
  if (data.error) {
    lines.push(`  Error: ${data.error}`)
    lines.push("")
  }

  // Show message if present
  if (data.message) {
    lines.push(`  ${data.message}`)
    lines.push("")
  }

  // Show data summary
  if (data.data && typeof data.data === "object") {
    const entries = Object.entries(data.data)
    for (const [key, value] of entries.slice(0, 15)) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
      lines.push(`  ${label}: ${formatValue(value)}`)
    }
    if (entries.length > 15) {
      lines.push(`  ...and ${entries.length - 15} more fields`)
    }
  } else if (typeof data === "object" && !Array.isArray(data)) {
    // Direct object result
    const entries = Object.entries(data).filter(([k]) => !["success", "error", "message"].includes(k))
    if (entries.length > 0) {
      for (const [key, value] of entries.slice(0, 15)) {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
        lines.push(`  ${label}: ${formatValue(value)}`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * Smart format result based on content type
 */
function formatResult(result: any, toolName: string): string {
  // Extract actual content from MCP wrapper
  const data = extractMCPContent(result)

  // If it's a string, return as-is
  if (typeof data === "string") {
    return data
  }

  // Detect result type based on tool name and content
  const toolLower = toolName.toLowerCase()

  // Widget results
  if (toolLower.includes("widget") && (data.widget || data.created || data.sys_class_name === "sp_widget")) {
    return formatWidgetResult(data.data || data)
  }

  // Instance info
  if (toolLower.includes("instance_info") || toolLower.includes("get_instance")) {
    return formatInstanceInfo(data.data || data)
  }

  // Incident/record queries
  if (toolLower.includes("incident")) {
    return formatRecordResult(data.data || data, "Incident")
  }
  if (toolLower.includes("change")) {
    return formatRecordResult(data.data || data, "Change Request")
  }
  if (toolLower.includes("problem")) {
    return formatRecordResult(data.data || data, "Problem")
  }
  if (toolLower.includes("cmdb") || toolLower.includes("ci")) {
    return formatRecordResult(data.data || data, "Configuration Item")
  }
  if (toolLower.includes("user")) {
    return formatRecordResult(data.data || data, "User")
  }
  if (toolLower.includes("query") || toolLower.includes("search") || toolLower.includes("list")) {
    return formatRecordResult(data.data || data, "Record")
  }

  // Generic format for other results
  return formatGenericResult(data, toolName)
}

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

      // Format the result nicely
      const formattedOutput = formatResult(result, tool_name)
      const friendlyTitle = formatToolName(tool_name)

      return {
        title: friendlyTitle,
        output: formattedOutput,
        metadata: { tool_name, success: true },
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error)
      log.error("Deferred tool execution failed", { tool_name, error: errorMsg })
      return {
        title: `${formatToolName(tool_name)} - Error`,
        output: `✗ Execution Failed

  Tool:  ${tool_name}
  Error: ${errorMsg}

  Please check the tool arguments and try again.`,
        metadata: { tool_name, success: false, error: errorMsg },
      }
    }
  },
})
