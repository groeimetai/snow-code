import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Token } from "./token"
import { Log } from "./log"

export namespace LargeOutputHandler {
  const log = Log.create({ service: "large-output-handler" })

  /**
   * Maximum tokens for tool output before saving to file
   * ~12.5k tokens = 50k chars - leaves room for other context
   */
  const MAX_OUTPUT_TOKENS = 12_500
  const MAX_OUTPUT_CHARS = MAX_OUTPUT_TOKENS * 4

  /**
   * Directory for storing large tool outputs
   */
  const OUTPUT_DIR = ".snowcode/tool-outputs"

  interface ProcessedOutput {
    /** The output to store in context (either original or summary) */
    contextOutput: string
    /** Whether the output was truncated and saved to file */
    wasTruncated: boolean
    /** Path to full output file if truncated */
    filePath?: string
    /** Original token estimate */
    originalTokens: number
  }

  /**
   * Process tool output - if too large, save to file and return summary
   */
  export async function processOutput(input: {
    toolName: string
    output: string
    callId: string
  }): Promise<ProcessedOutput> {
    const tokenEstimate = Token.estimate(input.output)

    // If output is small enough, return as-is
    if (tokenEstimate <= MAX_OUTPUT_TOKENS) {
      return {
        contextOutput: input.output,
        wasTruncated: false,
        originalTokens: tokenEstimate,
      }
    }

    log.info("large output detected, saving to file", {
      tool: input.toolName,
      tokens: tokenEstimate,
      chars: input.output.length,
    })

    // Save to file
    const filePath = await saveToFile({
      toolName: input.toolName,
      output: input.output,
      callId: input.callId,
    })

    // Generate summary
    const summary = generateSummary({
      toolName: input.toolName,
      output: input.output,
      filePath,
      originalTokens: tokenEstimate,
    })

    return {
      contextOutput: summary,
      wasTruncated: true,
      filePath,
      originalTokens: tokenEstimate,
    }
  }

  /**
   * Save output to a file in the project directory
   */
  async function saveToFile(input: {
    toolName: string
    output: string
    callId: string
  }): Promise<string> {
    const outputDir = path.join(Instance.directory, OUTPUT_DIR)

    // Ensure directory exists
    await fs.mkdir(outputDir, { recursive: true })

    // Create filename with timestamp and tool name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const sanitizedToolName = input.toolName.replace(/[^a-zA-Z0-9_-]/g, "_")
    const filename = `${timestamp}_${sanitizedToolName}_${input.callId.slice(-8)}.json`
    const filePath = path.join(outputDir, filename)

    // Try to pretty-print JSON, fall back to raw string
    let content: string
    try {
      const parsed = JSON.parse(input.output)
      content = JSON.stringify(parsed, null, 2)
    } catch {
      content = input.output
    }

    await fs.writeFile(filePath, content, "utf-8")

    log.info("saved large output to file", {
      path: filePath,
      size: content.length,
    })

    return filePath
  }

  /**
   * Generate a summary of the large output
   */
  function generateSummary(input: {
    toolName: string
    output: string
    filePath: string
    originalTokens: number
  }): string {
    const { toolName, output, filePath, originalTokens } = input

    // Try to parse and analyze the output
    let analysis = ""
    let preview = ""

    try {
      const parsed = JSON.parse(output)

      // Detect success/failure
      if (typeof parsed === "object" && parsed !== null) {
        if ("success" in parsed) {
          analysis += parsed.success ? "✅ Operation succeeded\n" : "❌ Operation failed\n"
        }
        if ("error" in parsed && parsed.error) {
          analysis += `⚠️ Error: ${String(parsed.error).slice(0, 200)}\n`
        }
        if ("message" in parsed && parsed.message) {
          analysis += `📝 Message: ${String(parsed.message).slice(0, 200)}\n`
        }

        // Count records if array
        if ("records" in parsed && Array.isArray(parsed.records)) {
          analysis += `📊 Records returned: ${parsed.records.length}\n`
          // Show first record's keys as schema hint
          if (parsed.records.length > 0) {
            const firstRecord = parsed.records[0]
            if (typeof firstRecord === "object" && firstRecord !== null) {
              const keys = Object.keys(firstRecord).slice(0, 10)
              analysis += `🔑 Fields: ${keys.join(", ")}${Object.keys(firstRecord).length > 10 ? "..." : ""}\n`
            }
          }
        } else if ("result" in parsed && Array.isArray(parsed.result)) {
          analysis += `📊 Results returned: ${parsed.result.length}\n`
        } else if ("data" in parsed && Array.isArray(parsed.data)) {
          analysis += `📊 Data items: ${parsed.data.length}\n`
        } else if ("count" in parsed) {
          analysis += `📊 Count: ${parsed.count}\n`
        }

        // Check for common ServiceNow response patterns
        if ("sys_id" in parsed) {
          analysis += `🆔 sys_id: ${parsed.sys_id}\n`
        }
        if ("number" in parsed) {
          analysis += `#️⃣ Number: ${parsed.number}\n`
        }
      }

      // Generate preview (first ~500 chars of pretty-printed JSON)
      const prettyJson = JSON.stringify(parsed, null, 2)
      preview = prettyJson.slice(0, 500)
      if (prettyJson.length > 500) {
        preview += "\n... [truncated]"
      }
    } catch {
      // Not JSON - show text preview
      preview = output.slice(0, 500)
      if (output.length > 500) {
        preview += "\n... [truncated]"
      }
    }

    // Build the summary
    const relativePath = path.relative(Instance.directory, filePath)

    return `📦 LARGE TOOL OUTPUT - Saved to file for exploration

**Tool:** ${toolName}
**Original size:** ~${originalTokens.toLocaleString()} tokens (${input.output.length.toLocaleString()} chars)
**Full output:** ${relativePath}

${analysis ? `## Analysis\n${analysis}\n` : ""}## Preview
\`\`\`json
${preview}
\`\`\`

## How to explore the full data
Use these native tools to investigate the saved output:

1. **Read specific lines:**
   \`Read { file_path: "${filePath}", offset: 0, limit: 100 }\`

2. **Search for specific content:**
   \`Grep { pattern: "your_search_term", path: "${filePath}" }\`

3. **Count occurrences:**
   \`Bash { command: "wc -l ${filePath}" }\`

The full data is available at: ${filePath}`
  }

  /**
   * Clean up old output files (older than 24 hours)
   */
  export async function cleanup(): Promise<number> {
    const outputDir = path.join(Instance.directory, OUTPUT_DIR)

    try {
      const files = await fs.readdir(outputDir)
      const now = Date.now()
      const maxAge = 24 * 60 * 60 * 1000 // 24 hours
      let deleted = 0

      for (const file of files) {
        const filePath = path.join(outputDir, file)
        const stat = await fs.stat(filePath)

        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(filePath)
          deleted++
        }
      }

      if (deleted > 0) {
        log.info("cleaned up old output files", { deleted })
      }

      return deleted
    } catch {
      // Directory doesn't exist or other error - ignore
      return 0
    }
  }
}
