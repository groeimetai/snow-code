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
 * Smart value formatter - handles any type intelligently
 */
function smartFormat(value: any, maxLen: number = 80): string {
  if (value === null || value === undefined) return "(none)"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") {
    if (value.length > maxLen || value.includes("\n")) {
      const lines = value.split("\n").length
      return `[${value.length} chars${lines > 1 ? `, ${lines} lines` : ""}]`
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "(empty)"
    // Try to show simple arrays inline
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      const joined = value.slice(0, 3).join(", ")
      return value.length > 3 ? `${joined}, ...+${value.length - 3}` : joined
    }
    return `[${value.length} items]`
  }
  if (typeof value === "object") {
    // Extract display value from nested objects
    const display = value.name || value.displayName || value.title || value.key || value.id || value.value
    if (display && typeof display === "string") return display
    return `{${Object.keys(value).length} fields}`
  }
  return String(value)
}

/**
 * Format key to readable label (camelCase/snake_case -> Title Case)
 */
function toLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase
    .replace(/[_-]/g, " ") // snake_case, kebab-case
    .replace(/\b\w/g, (l) => l.toUpperCase()) // Title Case
}

/**
 * Recursively format any data structure - fully dynamic, no hardcoded fields
 */
function formatData(data: any, depth: number = 0, maxDepth: number = 2): string[] {
  const indent = "  ".repeat(depth)
  const lines: string[] = []

  if (data === null || data === undefined) return [`${indent}(none)`]
  if (typeof data !== "object") return [`${indent}${smartFormat(data)}`]

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) return [`${indent}(empty list)`]

    const maxItems = 8
    for (let i = 0; i < Math.min(data.length, maxItems); i++) {
      const item = data[i]
      if (typeof item === "object" && item !== null) {
        // Find best identifier for this item
        const id = findIdentifier(item)
        lines.push(`${indent}${i + 1}. ${id}`)

        // Show nested fields if not too deep
        if (depth < maxDepth) {
          lines.push(...formatObject(item, depth + 1, maxDepth, 6))
        }
      } else {
        lines.push(`${indent}${i + 1}. ${smartFormat(item)}`)
      }
      if (i < Math.min(data.length, maxItems) - 1) lines.push("") // spacing between items
    }

    if (data.length > maxItems) {
      lines.push(`${indent}...+${data.length - maxItems} more`)
    }
    return lines
  }

  // Handle objects
  return formatObject(data, depth, maxDepth)
}

/**
 * Format object fields - shows ALL fields, sorted by importance and type
 */
function formatObject(obj: any, depth: number = 0, maxDepth: number = 2, maxFields: number = 12): string[] {
  const indent = "  ".repeat(depth)
  const lines: string[] = []

  // Get all non-null entries
  const entries = Object.entries(obj).filter(
    ([k, v]) => v !== null && v !== undefined && k !== "self" && !k.startsWith("_")
  )

  if (entries.length === 0) return [`${indent}(empty)`]

  // Priority fields that should always appear first (most important for users)
  const priorityFields = [
    "key", "number", "sys_id",  // Identifiers
    "summary", "short_description", "title", "name",  // Titles
    "status", "state", "priority", "severity",  // Status fields
    "assignee", "assigned_to", "reporter", "created_by",  // People
    "project", "projectKey", "category",  // Organization
    "created", "updated", "sys_created_on", "sys_updated_on"  // Dates
  ]

  // Sort: priority fields first, then primitives, then arrays, then objects
  entries.sort(([keyA, a], [keyB, b]) => {
    const aIndex = priorityFields.indexOf(keyA)
    const bIndex = priorityFields.indexOf(keyB)

    // If both are priority fields, sort by priority order
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex
    // Priority fields come first
    if (aIndex >= 0) return -1
    if (bIndex >= 0) return 1

    // Then sort by type: primitives first, then arrays, then objects
    const aScore = typeof a === "object" ? (Array.isArray(a) ? 2 : 3) : 1
    const bScore = typeof b === "object" ? (Array.isArray(b) ? 2 : 3) : 1
    return aScore - bScore
  })

  for (const [key, value] of entries.slice(0, maxFields)) {
    const label = toLabel(key)

    // For nested objects/arrays, decide whether to expand or summarize
    if (typeof value === "object" && value !== null && depth < maxDepth) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${indent}${label}: (empty)`)
        } else if (value.length <= 3 && value.every((v) => typeof v !== "object")) {
          lines.push(`${indent}${label}: ${smartFormat(value)}`)
        } else {
          lines.push(`${indent}${label}: [${value.length} items]`)
        }
      } else {
        // Nested object - show inline if simple
        const nested = Object.entries(value).filter(([, v]) => v != null)
        if (nested.length <= 2 && nested.every(([, v]) => typeof v !== "object")) {
          const inline = nested.map(([k, v]) => `${toLabel(k)}: ${smartFormat(v)}`).join(", ")
          lines.push(`${indent}${label}: ${inline}`)
        } else {
          lines.push(`${indent}${label}: ${smartFormat(value)}`)
        }
      }
    } else {
      lines.push(`${indent}${label}: ${smartFormat(value)}`)
    }
  }

  if (entries.length > maxFields) {
    lines.push(`${indent}...+${entries.length - maxFields} more fields`)
  }

  return lines
}

/**
 * Find the best identifier/title for an object - checks ALL string fields
 * Priority order for identifiers:
 * 1. 'key' field (e.g., Jira issue key like "SNOW-307")
 * 2. 'number' field (e.g., ServiceNow number like "INC0001234")
 * 3. 'id' field (last resort - often internal IDs)
 */
function findIdentifier(obj: any): string {
  if (!obj || typeof obj !== "object") return "Item"

  // Check direct fields and nested 'fields' (common in Jira)
  const sources = [obj, obj.fields].filter(Boolean)

  // Priority list for identifier fields - 'key' MUST come before 'id'!
  // Jira uses 'key' (SNOW-307), ServiceNow uses 'number' (INC0001234)
  // 'id' is usually an internal numeric ID and less useful for users
  const identifierPriority = ["key", "number", "sys_id", "id"]

  // First pass: look for fields by priority
  for (const fieldName of identifierPriority) {
    for (const source of sources) {
      const value = source[fieldName]
      if (typeof value === "string" && value.length > 0 && value.length < 100) {
        // Check if there's also a title/summary to combine
        const title =
          source.summary || source.title || source.name || source.short_description || obj.fields?.summary
        if (title && typeof title === "string" && title !== value) {
          return `${value}: ${truncateString(title, 60)}`
        }
        return value
      }
    }
  }

  // Second pass: return first reasonable string (name, title, summary, etc.)
  for (const source of sources) {
    for (const value of Object.values(source)) {
      if (typeof value === "string" && value.length > 0 && value.length < 80) {
        return truncateString(value, 70)
      }
    }
  }

  return "Item"
}

/**
 * Find array data in any response structure - checks ALL array properties
 */
function findArrayData(data: any): any[] | null {
  if (Array.isArray(data)) return data

  if (typeof data !== "object" || data === null) return null

  // Find the first non-empty array property
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0) {
      return value
    }
  }

  return null
}

/**
 * Universal result formatter - fully dynamic, works for ANY data structure
 */
function formatRecordResult(data: any, _recordType: string): string {
  const lines: string[] = []

  // Try to find array data
  const items = findArrayData(data)

  if (items && items.length > 0) {
    lines.push(`Found ${items.length} item(s)`)
    lines.push("")
    lines.push(...formatData(items, 0, 2))
  } else if (typeof data === "object" && data !== null) {
    // Single object or object without array
    const hasMetaOnly = Object.keys(data).every((k) => ["success", "message", "error", "total", "count"].includes(k))

    if (hasMetaOnly) {
      // Just metadata, show it
      lines.push(...formatObject(data, 0, 2, 10))
    } else {
      // Real data object
      lines.push(...formatData(data, 0, 2))
    }
  } else {
    lines.push(String(data))
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
  description: `Execute a deferred ServiceNow tool that was enabled via tool_search.

IMPORTANT: This executor is ONLY for ServiceNow tools found via tool_search.

DO NOT use this for enterprise tools (snow-flow-enterprise_*) like Jira, Azure DevOps, or Confluence!
Enterprise tools are ALWAYS available and should be called DIRECTLY:
- snow-flow-enterprise_jira_get_issue({issueKey: "SNOW-123"})
- snow-flow-enterprise_jira_search_issues({jql: "project = SNOW"})
- snow-flow-enterprise_azure_devops_get_work_item({workItemId: 123})

Usage for ServiceNow deferred tools:
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

    // Enterprise tools (snow-flow-enterprise_*) are always available - no need to enable
    const isEnterpriseTool = tool_name.startsWith("snow-flow-enterprise_")

    // Check if tool is enabled for this session (skip for enterprise tools)
    if (!isEnterpriseTool) {
      const isEnabled = await ToolSearch.isToolEnabled(ctx.sessionID, tool_name)
      if (!isEnabled) {
        return {
          title: "Tool Not Enabled",
          output: `The tool "${tool_name}" is not enabled for this session. Please use tool_search first to find and enable tools.

Example: tool_search({query: "${tool_name.split("_").slice(-1)[0]}"})

NOTE: If this is an enterprise tool (snow-flow-enterprise_*), you can call it directly without using deferred_tool_executor.`,
          metadata: { tool_name, success: false, error: "tool_not_enabled" },
        }
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
