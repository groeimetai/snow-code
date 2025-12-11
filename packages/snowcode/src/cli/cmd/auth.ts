import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import crypto from "crypto"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { ServiceNowOAuth } from "../../auth/servicenow-oauth"
import { PortalSync } from "../../auth/portal-sync"

// Import enterprise auth commands
import {
  AuthEnterpriseLoginCommand,
  AuthEnterpriseSyncCommand,
  AuthEnterpriseStatusCommand
} from "./auth-enterprise.js"

// Import portal auth commands (Individual/Teams - email-based)
import {
  AuthPortalLoginCommand,
  AuthPortalLogoutCommand,
  AuthPortalStatusCommand,
  AuthPortalRefreshCommand
} from "./auth-portal.js"

/**
 * Generate a unique machine ID for device binding
 * Uses hostname + platform + homedir for consistent ID across sessions
 */
function generateMachineId(): string {
  const machineInfo = `${os.hostname()}-${os.platform()}-${os.homedir()}`
  return crypto.createHash('sha256').update(machineInfo).digest('hex')
}

/**
 * Helper function to update .env file with key-value pairs
 */
async function updateEnvFile(updates: Array<{ key: string; value: string }>) {
  const envPath = path.join(process.cwd(), ".env")
  let envContent = ""

  try {
    envContent = await Bun.file(envPath).text()
  } catch {
    // File doesn't exist yet
  }

  for (const { key, value } of updates) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (envContent.includes(`${key}=`)) {
      envContent = envContent.replace(new RegExp(`${escapedKey}=.*`, "g"), `${key}=${value}`)
    } else {
      envContent += `\n${key}=${value}`
    }
  }

  // Ensure file ends with newline
  if (!envContent.endsWith("\n")) {
    envContent += "\n"
  }

  await Bun.write(envPath, envContent)
}

/**
 * Helper function to update SnowCode MCP config files with ServiceNow credentials
 */
async function updateSnowCodeMCPConfigs(instance: string, clientId: string, clientSecret: string) {
  const projectSnowCodeDir = path.join(process.cwd(), ".snow-code")
  const globalConfigDir = path.join(os.homedir(), ".config", "snow-code")

  // Ensure instance is a full URL
  const instanceUrl = instance.startsWith("http") ? instance : `https://${instance}`

  // ONLY update PRIMARY locations (with hyphen)
  // Legacy locations are read-only for backward compatibility
  const configPaths = [
    // Project-level .mcp.json (primary config for snow-flow)
    path.join(process.cwd(), ".mcp.json"),
    // Project-level (created by snow-flow init) - with hyphen ONLY
    path.join(projectSnowCodeDir, "opencode.json"),
    path.join(projectSnowCodeDir, "config.json"),
    // Global config directory (with hyphen ONLY)
    path.join(globalConfigDir, "opencode.json"),
    path.join(globalConfigDir, "snowcode.json"),
    path.join(globalConfigDir, "config.json"),
  ]

  var updatedCount = 0
  for (const configPath of configPaths) {
    try {
      // Check if file exists
      const file = Bun.file(configPath)
      if (!(await file.exists())) {
        // Silently skip non-existent config files
        continue
      }

      // Read and parse config
      const configText = await file.text()
      var config = JSON.parse(configText)

      // Update ServiceNow credentials in MCP server configs
      if (config.mcp) {
        var serverCount = 0
        for (var serverName in config.mcp) {
          var serverConfig = config.mcp[serverName]

          // Update environment variables
          if (serverConfig.environment) {
            if (serverConfig.environment.SERVICENOW_INSTANCE_URL !== undefined) {
              serverConfig.environment.SERVICENOW_INSTANCE_URL = instanceUrl
            }
            if (serverConfig.environment.SERVICENOW_CLIENT_ID !== undefined) {
              serverConfig.environment.SERVICENOW_CLIENT_ID = clientId
            }
            if (serverConfig.environment.SERVICENOW_CLIENT_SECRET !== undefined) {
              serverConfig.environment.SERVICENOW_CLIENT_SECRET = clientSecret
            }
            if (serverConfig.environment.SNOW_INSTANCE !== undefined) {
              serverConfig.environment.SNOW_INSTANCE = instance
            }
            if (serverConfig.environment.SNOW_CLIENT_ID !== undefined) {
              serverConfig.environment.SNOW_CLIENT_ID = clientId
            }
            if (serverConfig.environment.SNOW_CLIENT_SECRET !== undefined) {
              serverConfig.environment.SNOW_CLIENT_SECRET = clientSecret
            }
            // Also update username/password if present (for basic auth)
            if (serverConfig.environment.SERVICENOW_USERNAME !== undefined) {
              serverConfig.environment.SERVICENOW_USERNAME = ""
            }
            if (serverConfig.environment.SERVICENOW_PASSWORD !== undefined) {
              serverConfig.environment.SERVICENOW_PASSWORD = ""
            }
            serverCount++
          }
        }

        if (serverCount > 0) {
          // Write updated config back
          await Bun.write(configPath, JSON.stringify(config, null, 2))
          // Silently update MCP servers
          updatedCount++
        }
      }
    } catch (error: any) {
      // Silently skip failed config updates
    }
  }

  // Silently complete - no need for verbose logging
  // Config updates are transparent to the user
}

/**
 * Deploy LLM Gateway to ServiceNow via REST API
 * Creates Scripted REST API, Script Include, and System Properties
 */
async function deployLLMGateway(options: {
  instanceUrl: string
  accessToken: string
  midServerName: string
  llmEndpoint: string
  llmType: string
}): Promise<{ success: boolean; error?: string }> {
  const { instanceUrl, accessToken, midServerName, llmEndpoint, llmType } = options

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  }

  try {
    // Step 1: Create System Properties for LLM Gateway configuration
    const properties = [
      { name: "x_snow_llm.mid_server", value: midServerName, description: "MID Server for LLM requests" },
      { name: "x_snow_llm.llm_endpoint", value: llmEndpoint, description: "Local LLM endpoint URL" },
      { name: "x_snow_llm.llm_type", value: llmType, description: "LLM type (ollama, vllm, etc.)" },
    ]

    for (const prop of properties) {
      // Check if property exists
      const checkResponse = await fetch(
        `${instanceUrl}/api/now/table/sys_properties?sysparm_query=name=${encodeURIComponent(prop.name)}&sysparm_limit=1`,
        { headers }
      )
      const checkData = await checkResponse.json()

      if (checkData.result && checkData.result.length > 0) {
        // Update existing property
        await fetch(
          `${instanceUrl}/api/now/table/sys_properties/${checkData.result[0].sys_id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ value: prop.value }),
          }
        )
      } else {
        // Create new property
        await fetch(
          `${instanceUrl}/api/now/table/sys_properties`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: prop.name,
              value: prop.value,
              description: prop.description,
              type: "string",
            }),
          }
        )
      }
    }

    // Step 2: Create Script Include for LLM Gateway logic
    const scriptIncludeScript = `
var LLMGateway = Class.create();
LLMGateway.prototype = {
  initialize: function() {
    this.midServer = gs.getProperty('x_snow_llm.mid_server');
    this.llmEndpoint = gs.getProperty('x_snow_llm.llm_endpoint');
    this.llmType = gs.getProperty('x_snow_llm.llm_type');
  },

  /**
   * Send chat completion request through MID Server
   * @param {Object} requestBody - OpenAI-compatible request body
   * @returns {Object} Response from LLM
   */
  chatCompletion: function(requestBody) {
    var ecc = new GlideRecord('ecc_queue');
    ecc.initialize();
    ecc.agent = this._getMidServerId();
    ecc.topic = 'RESTProbe';
    ecc.name = 'LLMChatCompletion';
    ecc.source = 'LLMGateway';
    ecc.queue = 'output';
    ecc.payload = JSON.stringify({
      url: this.llmEndpoint + '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    ecc.insert();

    // Wait for response with timeout
    return this._waitForResponse(ecc.sys_id, 120);
  },

  /**
   * Test connectivity to LLM endpoint via MID Server
   * @returns {Object} Test result
   */
  testConnectivity: function() {
    var testPayload = {
      model: 'test',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    };

    try {
      var result = this.chatCompletion(testPayload);
      return { success: true, message: 'LLM endpoint is reachable' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  _getMidServerId: function() {
    var mid = new GlideRecord('ecc_agent');
    mid.addQuery('name', this.midServer);
    mid.addQuery('status', 'Up');
    mid.query();
    if (mid.next()) {
      return mid.sys_id.toString();
    }
    throw new Error('MID Server not found or not running: ' + this.midServer);
  },

  _waitForResponse: function(eccSysId, timeoutSeconds) {
    var startTime = new Date().getTime();
    var timeout = timeoutSeconds * 1000;

    while ((new Date().getTime() - startTime) < timeout) {
      var response = new GlideRecord('ecc_queue');
      response.addQuery('response_to', eccSysId);
      response.addQuery('queue', 'input');
      response.query();

      if (response.next()) {
        var payload = response.payload.toString();
        try {
          return JSON.parse(payload);
        } catch (e) {
          return { raw: payload };
        }
      }

      gs.sleep(500);
    }

    throw new Error('Timeout waiting for MID Server response');
  },

  type: 'LLMGateway'
};
`

    // Check if Script Include exists
    const siCheckResponse = await fetch(
      `${instanceUrl}/api/now/table/sys_script_include?sysparm_query=name=LLMGateway&sysparm_limit=1`,
      { headers }
    )
    const siCheckData = await siCheckResponse.json()

    if (siCheckData.result && siCheckData.result.length > 0) {
      // Update existing Script Include
      await fetch(
        `${instanceUrl}/api/now/table/sys_script_include/${siCheckData.result[0].sys_id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ script: scriptIncludeScript }),
        }
      )
    } else {
      // Create new Script Include
      await fetch(
        `${instanceUrl}/api/now/table/sys_script_include`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "LLMGateway",
            api_name: "global.LLMGateway",
            script: scriptIncludeScript,
            active: true,
            client_callable: false,
            description: "LLM Gateway for routing requests through MID Server to local LLM models",
          }),
        }
      )
    }

    // Step 3: Create Scripted REST API
    // Check if REST API exists
    const restCheckResponse = await fetch(
      `${instanceUrl}/api/now/table/sys_ws_definition?sysparm_query=name=LLM Gateway&sysparm_limit=1`,
      { headers }
    )
    const restCheckData = await restCheckResponse.json()

    let restApiSysId: string

    if (restCheckData.result && restCheckData.result.length > 0) {
      restApiSysId = restCheckData.result[0].sys_id
    } else {
      // Create REST API Definition
      const restApiResponse = await fetch(
        `${instanceUrl}/api/now/table/sys_ws_definition`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "LLM Gateway",
            api_id: "x_snow_llm",
            short_description: "OpenAI-compatible LLM Gateway via MID Server",
            active: true,
          }),
        }
      )
      const restApiData = await restApiResponse.json()
      restApiSysId = restApiData.result.sys_id
    }

    // Step 4: Create REST API Resource for chat completions
    const resourceScript = `
(function process(request, response) {
  try {
    var gateway = new LLMGateway();
    var requestBody = request.body.data;

    var result = gateway.chatCompletion(requestBody);

    response.setStatus(200);
    response.setBody(result);
  } catch (e) {
    response.setStatus(500);
    response.setBody({
      error: {
        message: e.message,
        type: 'gateway_error'
      }
    });
  }
})(request, response);
`

    // Check if resource exists
    const resCheckResponse = await fetch(
      `${instanceUrl}/api/now/table/sys_ws_operation?sysparm_query=web_service_definition=${restApiSysId}^name=Chat Completions&sysparm_limit=1`,
      { headers }
    )
    const resCheckData = await resCheckResponse.json()

    if (resCheckData.result && resCheckData.result.length > 0) {
      // Update existing resource
      await fetch(
        `${instanceUrl}/api/now/table/sys_ws_operation/${resCheckData.result[0].sys_id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ operation_script: resourceScript }),
        }
      )
    } else {
      // Create new resource
      await fetch(
        `${instanceUrl}/api/now/table/sys_ws_operation`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Chat Completions",
            web_service_definition: restApiSysId,
            http_method: "POST",
            relative_path: "/v1/chat/completions",
            operation_script: resourceScript,
            active: true,
          }),
        }
      )
    }

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Test LLM connectivity through MID Server
 * Sends a test request via ECC Queue to verify the LLM endpoint is reachable
 */
async function testLLMConnectivity(options: {
  instanceUrl: string
  accessToken: string
  midServerName: string
  llmEndpoint: string
  modelName: string
}): Promise<{ success: boolean; error?: string }> {
  const { instanceUrl, accessToken, midServerName, llmEndpoint, modelName } = options

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  }

  try {
    // First, verify MID Server is up
    const midCheckResponse = await fetch(
      `${instanceUrl}/api/now/table/ecc_agent?sysparm_query=name=${encodeURIComponent(midServerName)}^status=Up&sysparm_limit=1`,
      { headers }
    )
    const midCheckData = await midCheckResponse.json()

    if (!midCheckData.result || midCheckData.result.length === 0) {
      return { success: false, error: `MID Server '${midServerName}' is not running or not found` }
    }

    const midServerId = midCheckData.result[0].sys_id

    // Create ECC Queue entry to test connectivity
    const testPayload = {
      url: `${llmEndpoint}/v1/models`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }

    const eccResponse = await fetch(
      `${instanceUrl}/api/now/table/ecc_queue`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          agent: midServerId,
          topic: "RESTProbe",
          name: "LLMConnectivityTest",
          source: "snow-code-auth",
          queue: "output",
          payload: JSON.stringify(testPayload),
        }),
      }
    )

    if (!eccResponse.ok) {
      return { success: false, error: "Failed to create ECC Queue entry for connectivity test" }
    }

    const eccData = await eccResponse.json()
    const eccSysId = eccData.result.sys_id

    // Wait for response (poll for up to 30 seconds)
    const startTime = Date.now()
    const timeout = 30000

    while (Date.now() - startTime < timeout) {
      const responseCheck = await fetch(
        `${instanceUrl}/api/now/table/ecc_queue?sysparm_query=response_to=${eccSysId}^queue=input&sysparm_limit=1`,
        { headers }
      )
      const responseData = await responseCheck.json()

      if (responseData.result && responseData.result.length > 0) {
        const payload = responseData.result[0].payload
        try {
          const parsedPayload = JSON.parse(payload)
          if (parsedPayload.error) {
            return { success: false, error: parsedPayload.error }
          }
          return { success: true }
        } catch {
          // If payload is not JSON, check if it contains error indicators
          if (payload && (payload.includes("error") || payload.includes("Error"))) {
            return { success: false, error: payload }
          }
          return { success: true }
        }
      }

      // Wait 1 second before next poll
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return { success: false, error: "Timeout waiting for MID Server response (30s)" }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Validate enterprise license key with enterprise server
 * Note: Does NOT require user authentication token - the license key validates itself
 */
async function validateLicenseKey(licenseKey: string, serverUrl?: string): Promise<{
  valid: boolean
  error?: string
  features?: string[]
  serverUrl?: string
}> {
  try {
    // License validation goes to portal server (public endpoint, no auth)
    // Enterprise server has this endpoint but requires authorization header
    const effectiveServerUrl = serverUrl || "https://portal.snow-flow.dev"

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    // NOTE: License validation API does NOT require authentication token
    // It validates the license key itself, not the user session
    // User session tokens will cause "invalid signature" JWT errors

    const response = await fetch(`${effectiveServerUrl}/api/license/validate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ licenseKey }),
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      return {
        valid: false,
        error: data.error || data.message || "Invalid license key",
      }
    }

    return {
      valid: true,
      features: data.features || [],
      serverUrl: data.serverUrl || effectiveServerUrl,
    }
  } catch (error: any) {
    return {
      valid: false,
      error: error.message,
    }
  }
}

/**
 * Find the enterprise proxy path dynamically
 */
async function findEnterpriseProxyPath(): Promise<string> {
  var enterpriseProxyPath = ""

  // Try to get global npm root dynamically
  try {
    const npmRootResult = Bun.spawnSync(["npm", "root", "-g"])
    if (npmRootResult.exitCode === 0) {
      const globalNodeModules = npmRootResult.stdout.toString().trim()
      const dynamicPath = path.join(globalNodeModules, "snow-flow", "dist", "mcp", "enterprise-proxy", "index.js")
      if (await Bun.file(dynamicPath).exists()) {
        return dynamicPath
      }
    }
  } catch (e) {
    // Ignore errors, fall through to static paths
  }

  // Fallback to static paths if dynamic detection failed
  const possiblePaths = [
    path.join(process.cwd(), "node_modules", "snow-flow", "dist", "mcp", "enterprise-proxy", "index.js"),
    path.join(os.homedir(), ".npm", "lib", "node_modules", "snow-flow", "dist", "mcp", "enterprise-proxy", "index.js"),
    "/usr/local/lib/node_modules/snow-flow/dist/mcp/enterprise-proxy/index.js",
  ]

  for (const testPath of possiblePaths) {
    if (await Bun.file(testPath).exists()) {
      return testPath
    }
  }

  // Return npx as fallback
  return "npx"
}

/**
 * Enterprise MCP configuration interface
 */
interface EnterpriseMcpConfig {
  licenseKey: string
  serverUrl?: string
  credentials?: {
    atlassian?: {
      email: string
      apiToken: string
    }
    jira?: {
      host: string
    }
    azure?: {
      organization: string
      project?: string
      pat: string
    }
    confluence?: {
      host: string
    }
  }
}

/**
 * Add enterprise MCP server to snow-code configuration
 */
async function addEnterpriseMcpServer(config: EnterpriseMcpConfig): Promise<void> {
  const projectSnowCodeDir = path.join(process.cwd(), ".snow-code")
  const globalConfigDir = path.join(os.homedir(), ".config", "snow-code")

  const configPaths = [
    // Project root .mcp.json (used by snow-flow)
    path.join(process.cwd(), ".mcp.json"),
    // Project .snow-code configs
    path.join(projectSnowCodeDir, "opencode.json"),
    path.join(projectSnowCodeDir, "config.json"),
    // Global configs
    path.join(globalConfigDir, "opencode.json"),
    path.join(globalConfigDir, "snowcode.json"),
    path.join(globalConfigDir, "config.json"),
  ]

  for (const configPath of configPaths) {
    try {
      const file = Bun.file(configPath)
      if (!(await file.exists())) {
        continue
      }

      const configText = await file.text()
      var snowCodeConfig = JSON.parse(configText)

      // All snow-flow/snow-code configs use "mcp" key consistently
      // (Claude Desktop uses "mcpServers", but we don't write to that directly)
      const mcpKey = "mcp"

      if (!snowCodeConfig[mcpKey]) {
        snowCodeConfig[mcpKey] = {}
      }

      // Find enterprise proxy path dynamically
      const enterpriseProxyPath = await findEnterpriseProxyPath()

      // Add enterprise MCP server configuration
      const enterpriseConfig = {
        type: "local",
        command: enterpriseProxyPath === "npx" ? ["npx", "snow-flow-enterprise-proxy"] : ["node", enterpriseProxyPath],
        environment: {
          SNOW_LICENSE_KEY: config.licenseKey,
          SNOW_ENTERPRISE_URL: config.serverUrl || "https://enterprise.snow-flow.dev",
          ...(config.credentials?.atlassian && {
            ATLASSIAN_EMAIL: config.credentials.atlassian.email,
            ATLASSIAN_API_TOKEN: config.credentials.atlassian.apiToken,
          }),
          ...(config.credentials?.jira && {
            JIRA_HOST: config.credentials.jira.host,
          }),
          ...(config.credentials?.azure && {
            AZURE_ORG: config.credentials.azure.organization,
            AZURE_PROJECT: config.credentials.azure.project || "",
            AZURE_PAT: config.credentials.azure.pat,
          }),
          ...(config.credentials?.confluence && {
            CONFLUENCE_HOST: config.credentials.confluence.host,
          }),
        },
        enabled: true,
      }

      // Add to config
      snowCodeConfig[mcpKey]["snow-flow-enterprise"] = enterpriseConfig

      await Bun.write(configPath, JSON.stringify(snowCodeConfig, null, 2))
    } catch (error: any) {
      // Skip failed config updates
    }
  }
}

/**
 * Update project documentation (CLAUDE.md and AGENTS.md) with enterprise server information
 * Uses the comprehensive enterprise-docs-generator for detailed workflow instructions
 *
 * @param enabledServices - Array of enabled services (e.g., ['jira', 'azdo', 'confluence'])
 */
async function updateDocumentationWithEnterprise(enabledServices?: string[]): Promise<void> {
  try {
    const projectRoot = process.cwd()
    const claudeMdPath = path.join(projectRoot, "CLAUDE.md")
    const agentsMdPath = path.join(projectRoot, "AGENTS.md")

    // Import the comprehensive documentation generator
    const { generateEnterpriseInstructions } = await import("./enterprise-docs-generator.js")

    // Generate comprehensive enterprise documentation based on enabled services
    // Default to all services if not specified
    const services = enabledServices && enabledServices.length > 0
      ? enabledServices
      : ['jira', 'azdo', 'confluence']

    const enterpriseDocSection = generateEnterpriseInstructions(services)

    // Check markers for both old (short) and new (comprehensive) documentation
    const oldMarker = "## 🚀 Enterprise Features"
    const newMarker = "ENTERPRISE INTEGRATIONS - AUTONOMOUS DEVELOPMENT WORKFLOW"

    // Helper function to update a documentation file
    async function updateDocFile(filePath: string, fileName: string): Promise<void> {
      try {
        const file = Bun.file(filePath)
        if (await file.exists()) {
          let content = await file.text()

          // Check if comprehensive docs already exist
          if (content.includes(newMarker)) {
            // Already has comprehensive docs - no update needed
            return
          }

          // Remove old short documentation if it exists (replace with comprehensive)
          if (content.includes(oldMarker)) {
            // Find the start of the old enterprise section
            const oldStart = content.indexOf(oldMarker)
            // Find the end (next ## heading or end of file)
            let oldEnd = content.indexOf("\n## ", oldStart + 1)
            if (oldEnd === -1) {
              // Check for --- separator
              oldEnd = content.indexOf("\n---", oldStart + 1)
            }
            if (oldEnd === -1) {
              oldEnd = content.length
            }

            // Remove the old section
            content = content.slice(0, oldStart) + content.slice(oldEnd)
            prompts.log.info(`Replacing old enterprise docs in ${fileName} with comprehensive version`)
          }

          // Find the best insertion point (before "## Conclusion" or at the end)
          let insertionPoint = content.lastIndexOf("## Conclusion")
          if (insertionPoint === -1) {
            insertionPoint = content.lastIndexOf("---")
            if (insertionPoint === -1) {
              insertionPoint = content.length
            }
          }

          const updatedContent =
            content.slice(0, insertionPoint) + enterpriseDocSection + "\n\n" + content.slice(insertionPoint)

          await Bun.write(filePath, updatedContent)
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          prompts.log.info(`Could not update ${fileName}: ${err.message}`)
        }
      }
    }

    // Update both documentation files
    await updateDocFile(claudeMdPath, "CLAUDE.md")
    await updateDocFile(agentsMdPath, "AGENTS.md")

  } catch (error: any) {
    prompts.log.info(`Failed to update documentation: ${error.message}`)
    // Don't throw - this is not critical
  }
}

/**
 * Replace CLAUDE.md and AGENTS.md with stakeholder-specific read-only documentation
 * This completely replaces the files (not appends) for stakeholder role users
 * Must be called BEFORE updateDocumentationWithEnterprise() when role is 'stakeholder'
 *
 * @param role - User role from enterprise authentication
 */
async function replaceDocumentationForStakeholder(role: string): Promise<void> {
  if (role !== 'stakeholder') {
    return // Only replace for stakeholder role
  }

  try {
    const projectRoot = process.cwd()
    const claudeMdPath = path.join(projectRoot, "CLAUDE.md")
    const agentsMdPath = path.join(projectRoot, "AGENTS.md")

    // Import the stakeholder documentation generator (single comprehensive function for both files)
    const { generateStakeholderDocumentation } = await import("./enterprise-docs-generator.js")

    // Generate stakeholder-specific documentation (same content for both files)
    const stakeholderDocs = generateStakeholderDocumentation()

    // Completely replace CLAUDE.md with stakeholder version
    await Bun.write(claudeMdPath, stakeholderDocs)
    prompts.log.success("📖 CLAUDE.md replaced with stakeholder read-only documentation")

    // Completely replace AGENTS.md with stakeholder version (same content)
    await Bun.write(agentsMdPath, stakeholderDocs)
    prompts.log.success("📖 AGENTS.md replaced with stakeholder read-only documentation")

    prompts.log.info("🔒 Stakeholder documentation configured - READ-ONLY access enabled")

  } catch (error: any) {
    prompts.log.info(`Failed to replace stakeholder documentation: ${error.message}`)
    // Don't throw - this is not critical
  }
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      // Enterprise commands (license key auth)
      .command(AuthEnterpriseLoginCommand)
      .command(AuthEnterpriseSyncCommand)
      .command(AuthEnterpriseStatusCommand)
      // Portal commands (email-based auth for Individual/Teams)
      .command(AuthPortalLoginCommand)
      .command(AuthPortalLogoutCommand)
      .command(AuthPortalStatusCommand)
      .command(AuthPortalRefreshCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "opencode auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json())
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          const proc = Bun.spawn({
            cmd: wellknown.auth.command,
            stdout: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            await Instance.dispose()
            process.exit(0)
          }
          const token = await new Response(proc.stdout).text()
          await Auth.set(args.url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + args.url)
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }
        // First ask what type of authentication they want
        const authCategory = await prompts.select({
          message: "What would you like to authenticate?",
          options: [
            {
              value: "complete",
              label: "Complete Setup",
              hint: "LLM + ServiceNow + Snow-Flow License (recommended)",
            },
            {
              value: "snow-flow",
              label: "Snow-Flow License",
              hint: "Individual/Teams or Enterprise license",
            },
            {
              value: "llm",
              label: "LLM Provider",
              hint: "Anthropic, OpenAI, etc.",
            },
            {
              value: "servicenow",
              label: "ServiceNow Instance",
              hint: "direct ServiceNow connection",
            },
          ],
        })

        if (prompts.isCancel(authCategory)) throw new UI.CancelledError()

        // Handle Snow-Flow License authentication (Individual/Teams or Enterprise)
        if (authCategory === "snow-flow") {
          prompts.log.step("Snow-Flow License Authentication")
          prompts.log.info("")

          const accountType = await prompts.select({
            message: "Select your account type",
            options: [
              {
                value: "portal",
                label: "Individual / Teams",
                hint: "email-based login (€99/mo or €79/seat)",
              },
              {
                value: "enterprise",
                label: "Enterprise",
                hint: "license key login (custom pricing)",
              },
            ],
          })

          if (prompts.isCancel(accountType)) throw new UI.CancelledError()

          if (accountType === "portal") {
            // Portal authentication (Individual/Teams)
            const authMethod = await prompts.select({
              message: "How would you like to authenticate?",
              options: [
                {
                  value: "browser",
                  label: "Browser",
                  hint: "recommended - opens browser for approval",
                },
                {
                  value: "email",
                  label: "Email & Password",
                  hint: "direct login",
                },
                {
                  value: "magic-link",
                  label: "Magic Link",
                  hint: "passwordless via email",
                },
              ],
            })

            if (prompts.isCancel(authMethod)) throw new UI.CancelledError()

            // Import and run portal auth flow
            const {
              AuthPortalLoginCommand
            } = await import("./auth-portal.js")

            prompts.outro("Starting portal authentication...")

            // Execute the appropriate auth flow based on method
            const portalArgs = { method: authMethod }
            await AuthPortalLoginCommand.handler(portalArgs as any)

            await Instance.dispose()
            process.exit(0)
          } else {
            // Enterprise authentication - simple username/password login
            // Admin creates users and provides credentials
            prompts.log.step("Snow-Flow Enterprise Login")
            prompts.log.info("Login with the credentials provided by your admin")
            prompts.log.message("")

            // Enterprise portal URL is fixed
            const portalUrl = "https://portal.snow-flow.dev"
            const mcpServerUrl = "https://enterprise.snow-flow.dev"

            let username: string = ""
            let password: string
            let authData: any
            const machineId = generateMachineId()

            // Login flow
            let loginSuccess = false

            while (!loginSuccess) {
              username = (await prompts.text({
                message: "Username",
                placeholder: "john.doe",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Username is required"
                },
              })) as string

              if (prompts.isCancel(username)) throw new UI.CancelledError()

              password = (await prompts.password({
                message: "Password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(password)) throw new UI.CancelledError()

              prompts.log.message("")
              const spinner = prompts.spinner()
              spinner.start("Authenticating...")

              try {
                const response = await fetch(`${portalUrl}/api/user-auth/login`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ username, password }),
                })

                authData = await response.json()

                if (!response.ok || !authData.success) {
                  spinner.stop("Authentication failed", 1)
                  prompts.log.error(authData.error || "Invalid username or password")

                  const tryAgain = await prompts.confirm({
                    message: "Would you like to try again?",
                    initialValue: true,
                  })
                  if (prompts.isCancel(tryAgain) || !tryAgain) {
                    prompts.outro("Login cancelled")
                    await Instance.dispose()
                    process.exit(1)
                  }
                  continue
                }

                spinner.stop("Authentication successful!")
                loginSuccess = true
              } catch (error: any) {
                spinner.stop("Connection error", 1)
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.outro("Login cancelled")
                await Instance.dispose()
                process.exit(1)
              }
            }

            const role = authData.user?.role || "developer"
            const email = authData.user?.email
            const licenseKey = authData.customer?.licenseKey || ""

            // Store enterprise auth
          await Auth.set("enterprise", {
            type: "enterprise",
            licenseKey,
            enterpriseUrl: portalUrl,
            token: authData.token,
            sessionToken: authData.sessionToken,
            username,
            email,
            role: authData.user?.role || role,
            machineId,
          })

          // NOTE: .env writes removed - credentials are fetched from Portal API by enterprise MCP server
          // JWT token is stored in MCP config, no need to store license key in .env

          prompts.log.success(`Welcome, ${username}!`)
          prompts.log.info(`Role: ${authData.user?.role || role}`)
          if (authData.customer?.company) {
            prompts.log.info(`Company: ${authData.customer.company}`)
          }

          // Fetch third-party tool credentials from portal (optional)
          prompts.log.message("")
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking third-party tool integrations...")

          // Track enabled services for documentation generation
          let enabledServices: string[] = []

          // Check if we have a license key to fetch credentials
          if (!licenseKey) {
            fetchSpinner.stop("Could not fetch credentials (no license key)")
            prompts.log.warn("Your customer account may not have a license key configured")
          } else {
            const portalCredentials = await PortalSync.pullFromPortal(licenseKey, portalUrl)

            if (portalCredentials.success && portalCredentials.credentials) {
              const creds = portalCredentials.credentials
              const credCount = (creds.jira ? 1 : 0) + (creds.azureDevOps ? 1 : 0) + (creds.confluence ? 1 : 0)

              if (credCount > 0) {
                fetchSpinner.stop(`Found ${credCount} integration(s)`)
                if (creds.jira) prompts.log.message(`  • Jira: ${creds.jira.baseUrl}`)
                if (creds.azureDevOps) prompts.log.message(`  • Azure DevOps: ${creds.azureDevOps.org}`)
                if (creds.confluence) prompts.log.message(`  • Confluence: ${creds.confluence.baseUrl}`)

                // Build enabled services list based on fetched credentials
                if (creds.jira) enabledServices.push('jira')
                if (creds.azureDevOps) enabledServices.push('azdo')
                if (creds.confluence) enabledServices.push('confluence')
              } else {
                fetchSpinner.stop("No third-party integrations configured in portal")
              }
            } else {
              fetchSpinner.stop("Could not fetch credentials")
              if (portalCredentials.error) {
                prompts.log.warn(`Reason: ${portalCredentials.error}`)
              }
            }
          }

          // For stakeholders, replace docs with read-only version (regardless of integrations)
          await replaceDocumentationForStakeholder(role)

          // Update documentation with enterprise features based on enabled integrations
          if (enabledServices.length > 0) {
            await updateDocumentationWithEnterprise(enabledServices)
          }

          // Configure MCP server
          try {
            const globalSnowCodeDir = path.join(os.homedir(), ".snowcode")
            const configPath = path.join(globalSnowCodeDir, "config.json")
            await Bun.write(path.join(globalSnowCodeDir, ".keep"), "")

            const file = Bun.file(configPath)
            var config: any = {}
            if (await file.exists()) {
              config = JSON.parse(await file.text())
            }
            if (!config.mcp) config.mcp = {}

            const enterpriseProxyPath = await findEnterpriseProxyPath()
            config.mcp["snow-flow-enterprise"] = {
              command: enterpriseProxyPath === "npx" ? "npx" : "node",
              args: enterpriseProxyPath === "npx" ? ["snow-flow-enterprise-proxy"] : [enterpriseProxyPath],
              env: {
                SNOW_LICENSE_KEY: licenseKey,
                SNOW_ENTERPRISE_URL: mcpServerUrl,
              },
            }

            await Bun.write(configPath, JSON.stringify(config, null, 2))
            prompts.log.info("Added snow-flow-enterprise MCP server to config")
          } catch (error: any) {
            prompts.log.warn(`Failed to configure MCP server: ${error.message}`)
          }

          prompts.log.message("")
          prompts.log.success("✅ Enterprise authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message('  • Run: snow-code init to configure Claude Code')
          prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
          }
        }

        // Track if this is a complete setup (chains all auth steps)
        const isCompleteSetup = authCategory === "complete"

        // For complete setup: ServiceNow FIRST, then LLM Provider
        // This ensures OAuth credentials are available for MID Server LLM deployment
        if (isCompleteSetup) {
          prompts.log.step("Step 1: ServiceNow Configuration")
          prompts.log.info("Snow-Flow requires ServiceNow connection for development")
          prompts.log.message("")

          const snowInstance = (await prompts.text({
            message: "ServiceNow instance URL",
            placeholder: "dev12345.service-now.com",
            validate: (value) => {
              if (!value || value.trim() === "") return "Instance URL is required"
              const cleaned = value.replace(/^https?:\/\//, "").replace(/\/$/, "")
              if (
                !cleaned.includes(".service-now.com") &&
                !cleaned.includes("localhost") &&
                !cleaned.includes("127.0.0.1")
              ) {
                return "Must be a ServiceNow domain (e.g., dev12345.service-now.com)"
              }
            },
          })) as string

          if (prompts.isCancel(snowInstance)) throw new UI.CancelledError()

          const snowAuthMethod = (await prompts.select({
            message: "Authentication method",
            options: [
              { value: "oauth", label: "OAuth 2.0", hint: "recommended - required for MID Server LLM" },
              { value: "basic", label: "Basic Auth", hint: "username/password" },
            ],
          })) as string

          if (prompts.isCancel(snowAuthMethod)) throw new UI.CancelledError()

          if (snowAuthMethod === "oauth") {
            const snowClientId = (await prompts.text({
              message: "OAuth Client ID",
              placeholder: "32-character hex string from ServiceNow",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client ID is required"
                if (value.length < 32) return "Client ID too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(snowClientId)) throw new UI.CancelledError()

            const snowClientSecret = (await prompts.password({
              message: "OAuth Client Secret",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client Secret is required"
                if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(snowClientSecret)) throw new UI.CancelledError()

            // Run OAuth flow for ServiceNow
            const oauth = new ServiceNowOAuth()
            const snowAuthResult = await oauth.authenticate({
              instance: snowInstance,
              clientId: snowClientId,
              clientSecret: snowClientSecret,
            })

            if (snowAuthResult.success) {
              // Write to .env file
              await updateEnvFile([
                { key: "SNOW_INSTANCE", value: snowInstance },
                { key: "SNOW_AUTH_METHOD", value: "oauth" },
                { key: "SNOW_CLIENT_ID", value: snowClientId },
                { key: "SNOW_CLIENT_SECRET", value: snowClientSecret },
              ])
              // Update SnowCode MCP configs
              await updateSnowCodeMCPConfigs(snowInstance, snowClientId, snowClientSecret)
              prompts.log.success("ServiceNow authentication successful!")
            } else {
              prompts.log.error(`ServiceNow authentication failed: ${snowAuthResult.error}`)
              prompts.outro("Setup cancelled")
              await Instance.dispose()
              process.exit(1)
            }
          } else {
            // Basic auth
            const snowUsername = (await prompts.text({
              message: "ServiceNow username",
              placeholder: "admin",
              validate: (value) => {
                if (!value || value.trim() === "") return "Username is required"
              },
            })) as string

            if (prompts.isCancel(snowUsername)) throw new UI.CancelledError()

            const snowPassword = (await prompts.password({
              message: "ServiceNow password",
              validate: (value) => {
                if (!value || value.trim() === "") return "Password is required"
              },
            })) as string

            if (prompts.isCancel(snowPassword)) throw new UI.CancelledError()

            // Save to Auth store
            await Auth.set("servicenow", {
              type: "servicenow-basic",
              instance: snowInstance,
              username: snowUsername,
              password: snowPassword,
            })

            // Write to .env file
            await updateEnvFile([
              { key: "SNOW_INSTANCE", value: snowInstance },
              { key: "SNOW_AUTH_METHOD", value: "basic" },
              { key: "SNOW_USERNAME", value: snowUsername },
              { key: "SNOW_PASSWORD", value: snowPassword },
            ])
            // Update MCP configs with instance only (no OAuth credentials)
            await updateSnowCodeMCPConfigs(snowInstance, "", "")

            prompts.log.success("ServiceNow credentials saved!")
          }

          prompts.log.message("")
          prompts.log.step("Step 2: LLM Provider Configuration")
        }

        // LLM Provider authentication
        let provider: string = ""
        await ModelsDev.refresh().catch(() => {})
        const providers = await ModelsDev.get()

        if (authCategory === "llm" || authCategory === "complete") {
          const priority: Record<string, number> = {
            anthropic: 0,
            "github-copilot": 1,
            openai: 2,
            google: 3,
            openrouter: 4,
            vercel: 5,
            opencode: 99,
          }
          const selectedProvider = await prompts.autocomplete({
            message: "Select LLM provider",
            maxItems: 10,
            options: [
              ...pipe(
                providers,
                values(),
                sortBy(
                  (x) => priority[x.id] ?? 99,
                  (x) => x.name ?? x.id,
                ),
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: priority[x.id] === 0 ? "recommended" : undefined,
                })),
              ),
              {
                value: "other",
                label: "Other",
              },
              {
                value: "midserver-llm",
                label: "ServiceNow MID Server LLM",
                hint: "local LLM via MID Server (enterprise)",
              },
            ],
          })

          if (prompts.isCancel(selectedProvider)) throw new UI.CancelledError()
          provider = selectedProvider as string
        }

        // Handle direct ServiceNow authentication from category selection
        if (authCategory === "servicenow") {
          provider = "servicenow"
        }

        // Handle ServiceNow authentication
        if (provider === "servicenow") {
          prompts.log.step("ServiceNow Authentication")

          const instance = (await prompts.text({
            message: "ServiceNow instance URL",
            placeholder: "dev12345.service-now.com",
            validate: (value) => {
              if (!value || value.trim() === "") return "Instance URL is required"
              const cleaned = value.replace(/^https?:\/\//, "").replace(/\/$/, "")
              if (
                !cleaned.includes(".service-now.com") &&
                !cleaned.includes("localhost") &&
                !cleaned.includes("127.0.0.1")
              ) {
                return "Must be a ServiceNow domain (e.g., dev12345.service-now.com)"
              }
            },
          })) as string

          if (prompts.isCancel(instance)) throw new UI.CancelledError()

          const authMethod = (await prompts.select({
            message: "Authentication method",
            options: [
              { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
              { value: "basic", label: "Basic Auth", hint: "username/password" },
            ],
          })) as string

          if (prompts.isCancel(authMethod)) throw new UI.CancelledError()

          if (authMethod === "oauth") {
            const clientId = (await prompts.text({
              message: "OAuth Client ID",
              placeholder: "32-character hex string from ServiceNow",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client ID is required"
                if (value.length < 32) return "Client ID too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(clientId)) throw new UI.CancelledError()

            const clientSecret = (await prompts.password({
              message: "OAuth Client Secret",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client Secret is required"
                if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(clientSecret)) throw new UI.CancelledError()

            // Run full OAuth flow
            const oauth = new ServiceNowOAuth()
            const result = await oauth.authenticate({
              instance,
              clientId,
              clientSecret,
            })

            if (result.success) {
              // Write to .env file
              await updateEnvFile([
                { key: "SNOW_INSTANCE", value: instance },
                { key: "SNOW_AUTH_METHOD", value: "oauth" },
                { key: "SNOW_CLIENT_ID", value: clientId },
                { key: "SNOW_CLIENT_SECRET", value: clientSecret },
              ])
              // Update SnowCode MCP configs
              await updateSnowCodeMCPConfigs(instance, clientId, clientSecret)
              prompts.log.success("ServiceNow authentication successful")
              prompts.log.info("Credentials saved to .env and SnowCode configs")
            } else {
              prompts.log.error(`Authentication failed: ${result.error}`)
            }
          } else {
            // Basic auth
            const username = (await prompts.text({
              message: "ServiceNow username",
              placeholder: "admin",
              validate: (value) => {
                if (!value || value.trim() === "") return "Username is required"
              },
            })) as string

            if (prompts.isCancel(username)) throw new UI.CancelledError()

            const password = (await prompts.password({
              message: "ServiceNow password",
              validate: (value) => {
                if (!value || value.trim() === "") return "Password is required"
              },
            })) as string

            if (prompts.isCancel(password)) throw new UI.CancelledError()

            // Save to Auth store
            await Auth.set("servicenow", {
              type: "servicenow-basic",
              instance,
              username,
              password,
            })

            // Write to .env file
            await updateEnvFile([
              { key: "SNOW_INSTANCE", value: instance },
              { key: "SNOW_AUTH_METHOD", value: "basic" },
              { key: "SNOW_USERNAME", value: username },
              { key: "SNOW_PASSWORD", value: password },
            ])
            // Note: Basic auth doesn't use OAuth, so we update MCP configs with instance only
            // MCP servers will use username/password from .env instead
            await updateSnowCodeMCPConfigs(instance, "", "")

            prompts.log.success("ServiceNow credentials saved")
            prompts.log.info("Credentials saved to .env and SnowCode configs")
          }

          // If this is a standalone ServiceNow setup (not complete), stop here
          if (authCategory === "servicenow") {
            prompts.log.message("")
            prompts.log.success("✅ ServiceNow authentication complete!")
            prompts.log.message("")
            prompts.log.info("Next steps:")
            prompts.log.message("")
            prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
            prompts.log.message("  • Run: snow-code auth login to configure more credentials")
            prompts.outro("Done")
            await Instance.dispose()
            process.exit(0)
          }

          // For complete setup, ask about Snow-Flow License (optional)
          prompts.log.message("")
          const configureEnterprise = await prompts.confirm({
            message: "Configure Snow-Flow License? (optional - enables Jira, Azure DevOps, Confluence)",
            initialValue: false,
          })

          if (prompts.isCancel(configureEnterprise) || !configureEnterprise) {
            prompts.log.message("")
            prompts.log.success("✅ Authentication complete!")
            prompts.log.message("")
            prompts.log.info("Next steps:")
            prompts.log.message("")
            prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
            prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
            prompts.outro("Done")
            await Instance.dispose()
            process.exit(0)
          }

          // User wants Snow-Flow License, ask which type (same as standalone)
          prompts.log.message("")

          const accountType = await prompts.select({
            message: "Select your account type",
            options: [
              {
                value: "portal",
                label: "Individual / Teams",
                hint: "email-based login (€99/mo or €79/seat)",
              },
              {
                value: "enterprise",
                label: "Enterprise",
                hint: "license key login (custom pricing)",
              },
            ],
          })

          if (prompts.isCancel(accountType)) throw new UI.CancelledError()

          if (accountType === "portal") {
            // Portal authentication (Individual/Teams) - same as standalone
            const authMethod = await prompts.select({
              message: "How would you like to authenticate?",
              options: [
                {
                  value: "browser",
                  label: "Browser",
                  hint: "recommended - opens browser for approval",
                },
                {
                  value: "email",
                  label: "Email & Password",
                  hint: "direct login",
                },
                {
                  value: "magic-link",
                  label: "Magic Link",
                  hint: "passwordless via email",
                },
              ],
            })

            if (prompts.isCancel(authMethod)) throw new UI.CancelledError()

            // Import and run portal auth flow
            const {
              AuthPortalLoginCommand
            } = await import("./auth-portal.js")

            prompts.outro("Starting portal authentication...")

            // Execute the appropriate auth flow based on method
            const portalArgs = { method: authMethod }
            await AuthPortalLoginCommand.handler(portalArgs as any)

            await Instance.dispose()
            process.exit(0)
          }

          // Enterprise - set provider and fall through
          provider = "enterprise"
          // Fall through to Enterprise handler below
        }

        // Handle Enterprise authentication (uses same flow as standalone)
        if (provider === "enterprise") {
          prompts.log.step("Snow-Flow Enterprise Login")
          prompts.log.info("Login with the credentials provided by your admin")
          prompts.log.message("")

          // Enterprise portal URL is fixed
          const portalUrl = "https://portal.snow-flow.dev"
          const mcpServerUrl = "https://enterprise.snow-flow.dev"

          let username: string = ""
          let password: string
          let authData: any
          const machineId = generateMachineId()

          // Login flow
          let loginSuccess = false

          while (!loginSuccess) {
            username = (await prompts.text({
              message: "Username",
              placeholder: "john.doe",
              validate: (value) => {
                if (!value || value.trim() === "") return "Username is required"
              },
            })) as string

            if (prompts.isCancel(username)) throw new UI.CancelledError()

            password = (await prompts.password({
              message: "Password",
              validate: (value) => {
                if (!value || value.trim() === "") return "Password is required"
              },
            })) as string

            if (prompts.isCancel(password)) throw new UI.CancelledError()

            prompts.log.message("")
            const spinner = prompts.spinner()
            spinner.start("Authenticating...")

            try {
              const response = await fetch(`${portalUrl}/api/user-auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
              })

              authData = await response.json()

              if (!response.ok || !authData.success) {
                spinner.stop("Authentication failed", 1)
                prompts.log.error(authData.error || "Invalid username or password")

                const tryAgain = await prompts.confirm({
                  message: "Would you like to try again?",
                  initialValue: true,
                })
                if (prompts.isCancel(tryAgain) || !tryAgain) {
                  prompts.outro("Login cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }
                continue
              }

              spinner.stop("Authentication successful!")
              loginSuccess = true
            } catch (error: any) {
              spinner.stop("Connection error", 1)
              prompts.log.error(`Connection error: ${error.message}`)
              prompts.outro("Login cancelled")
              await Instance.dispose()
              process.exit(1)
            }
          }

          const role = authData.user?.role || "developer"
          const email = authData.user?.email
          const licenseKey = authData.customer?.licenseKey || ""

          // Store enterprise auth
          await Auth.set("enterprise", {
            type: "enterprise",
            licenseKey,
            enterpriseUrl: portalUrl,
            token: authData.token,
            sessionToken: authData.sessionToken,
            username,
            email,
            role: authData.user?.role || role,
            machineId,
          })

          // NOTE: .env writes removed - credentials are fetched from Portal API by enterprise MCP server
          // JWT token is stored in MCP config, no need to store license key in .env

          prompts.log.success(`Welcome, ${username}!`)
          prompts.log.info(`Role: ${authData.user?.role || role}`)
          if (authData.customer?.company) {
            prompts.log.info(`Company: ${authData.customer.company}`)
          }

          // Fetch third-party tool credentials from portal (optional)
          prompts.log.message("")
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking third-party tool integrations...")

          // Track enabled services for documentation generation
          let enabledServices: string[] = []

          // Check if we have a license key to fetch credentials
          if (!licenseKey) {
            fetchSpinner.stop("Could not fetch credentials (no license key)")
            prompts.log.warn("Your customer account may not have a license key configured")
          } else {
            const portalCredentials = await PortalSync.pullFromPortal(licenseKey, portalUrl)

            if (portalCredentials.success && portalCredentials.credentials) {
              const creds = portalCredentials.credentials
              const credCount = (creds.jira ? 1 : 0) + (creds.azureDevOps ? 1 : 0) + (creds.confluence ? 1 : 0)

              if (credCount > 0) {
                fetchSpinner.stop(`Found ${credCount} integration(s)`)
                if (creds.jira) prompts.log.message(`  • Jira: ${creds.jira.baseUrl}`)
                if (creds.azureDevOps) prompts.log.message(`  • Azure DevOps: ${creds.azureDevOps.org}`)
                if (creds.confluence) prompts.log.message(`  • Confluence: ${creds.confluence.baseUrl}`)

                // Build enabled services list based on fetched credentials
                if (creds.jira) enabledServices.push('jira')
                if (creds.azureDevOps) enabledServices.push('azdo')
                if (creds.confluence) enabledServices.push('confluence')
              } else {
                fetchSpinner.stop("No third-party integrations configured in portal")
              }
            } else {
              fetchSpinner.stop("Could not fetch credentials")
              if (portalCredentials.error) {
                prompts.log.warn(`Reason: ${portalCredentials.error}`)
              }
            }
          }

          // For stakeholders, replace docs with read-only version (regardless of integrations)
          await replaceDocumentationForStakeholder(role)

          // Update documentation with enterprise features based on enabled integrations
          if (enabledServices.length > 0) {
            await updateDocumentationWithEnterprise(enabledServices)
          }

          // Configure MCP server
          try {
            const globalSnowCodeDir = path.join(os.homedir(), ".snowcode")
            const configPath = path.join(globalSnowCodeDir, "config.json")
            await Bun.write(path.join(globalSnowCodeDir, ".keep"), "")

            const file = Bun.file(configPath)
            var config: any = {}
            if (await file.exists()) {
              config = JSON.parse(await file.text())
            }
            if (!config.mcp) config.mcp = {}

            const enterpriseProxyPath = await findEnterpriseProxyPath()
            config.mcp["snow-flow-enterprise"] = {
              command: enterpriseProxyPath === "npx" ? "npx" : "node",
              args: enterpriseProxyPath === "npx" ? ["snow-flow-enterprise-proxy"] : [enterpriseProxyPath],
              env: {
                SNOW_LICENSE_KEY: licenseKey,
                SNOW_ENTERPRISE_URL: mcpServerUrl,
              },
            }

            await Bun.write(configPath, JSON.stringify(config, null, 2))
            prompts.log.info("Added snow-flow-enterprise MCP server to config")
          } catch (error: any) {
            prompts.log.warn(`Failed to configure MCP server: ${error.message}`)
          }

          prompts.log.message("")
          prompts.log.success("✅ Enterprise authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message('  • Run: snow-code init to configure Claude Code')
          prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }

        // Model selection step - integrated into the auth flow
        let selectedModel: string | undefined
        if (
          provider !== "other" &&
          provider !== "amazon-bedrock" &&
          provider !== "google-vertex" &&
          provider !== "servicenow" &&
          provider !== "enterprise" &&
          provider !== "midserver-llm"
        ) {
          const providerData = providers[provider]
          if (providerData && providerData.models && Object.keys(providerData.models).length > 0) {
            // Custom sorting for Anthropic: version-based (4.5 → 4.1 → 4 → 3.5 → 3)
            const extractAnthropicVersion = (model: any): number => {
              const match = model.id.match(/claude-(?:opus|sonnet|haiku)-(\d+)(?:\.(\d+))?/)
              if (!match) return 0
              const major = parseInt(match[1]) || 0
              const minor = parseInt(match[2]) || 0
              return major * 10 + minor
            }

            // Custom sorting for OpenAI: version-based (gpt-5 → gpt-4.1 → gpt-4o → o3 → o1)
            const extractOpenAIVersion = (model: any): number => {
              // GPT-5 family (highest priority)
              if (model.id.includes('gpt-5')) {
                if (model.id.includes('pro')) return 5100
                if (model.id.includes('codex')) return 5090
                if (model.id === 'gpt-5') return 5080
                if (model.id.includes('mini')) return 5070
                if (model.id.includes('nano')) return 5060
                return 5000
              }
              // GPT-4.1 family
              if (model.id.includes('gpt-4.1')) {
                if (model.id.includes('mini')) return 4110
                return 4120
              }
              // GPT-4o family (4.x = 4000 + x*10)
              if (model.id.includes('gpt-4o')) {
                if (model.id.includes('mini')) return 4080
                return 4100
              }
              // GPT-4 family
              if (model.id.includes('gpt-4')) {
                if (model.id.includes('turbo')) return 4050
                return 4040
              }
              // O-series (o4 > o3 > o1)
              if (model.id.includes('o4')) {
                if (model.id.includes('mini')) return 3950
                return 3960
              }
              if (model.id.includes('o3')) {
                if (model.id.includes('pro')) return 3920
                if (model.id.includes('mini')) return 3900
                if (model.id.includes('deep-research')) return 3910
                return 3915
              }
              if (model.id.includes('o1')) {
                if (model.id.includes('pro')) return 3850
                if (model.id.includes('mini')) return 3840
                if (model.id.includes('preview')) return 3845
                return 3842
              }
              // GPT-3.5
              if (model.id.includes('gpt-3.5')) return 3500
              // Codex
              if (model.id.includes('codex')) return 3000
              // Default: use release date as fallback
              return parseInt(model.release_date.replace(/-/g, '')) || 0
            }

            // Custom sorting for Google (Gemini): newer versions first
            const extractGeminiVersion = (model: any): number => {
              const match = model.id.match(/gemini-(\d+)(?:\.(\d+))?/)
              if (!match) {
                // Fallback to release date
                return parseInt(model.release_date.replace(/-/g, '')) || 0
              }
              const major = parseInt(match[1]) || 0
              const minor = parseInt(match[2]) || 0
              return major * 100 + minor
            }

            const getSortKey = (provider: string) => {
              if (provider === "anthropic") return (x: any) => -extractAnthropicVersion(x)
              if (provider === "openai") return (x: any) => -extractOpenAIVersion(x)
              if (provider === "google") return (x: any) => -extractGeminiVersion(x)
              return (x: any) => -parseInt(x.release_date.replace(/-/g, '') || '0')
            }

            const modelOptions = pipe(
              providerData.models,
              values(),
              sortBy(
                (x) => (x.status === "alpha" || x.status === "beta" ? 1 : 0),
                getSortKey(provider),
              ),
              map((model) => {
                const contextWindow = model.limit.context ? ` (${(model.limit.context / 1000).toFixed(0)}K context)` : ""
                const status = model.status ? ` [${model.status}]` : ""
                return {
                  label: model.name + contextWindow + status,
                  value: model.id,
                  hint: model.experimental ? "experimental" : undefined,
                }
              }),
            )

            if (modelOptions.length > 0) {
              const modelChoice = await prompts.autocomplete({
                message: `Select default model for ${providerData.name}`,
                maxItems: 10,
                options: modelOptions,
              })

              if (!prompts.isCancel(modelChoice)) {
                selectedModel = `${provider}/${modelChoice}`
                prompts.log.success(`Default model: ${providerData.models[modelChoice]?.name}`)
              }
            }
          }
        }

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          let index = 0
          if (plugin.auth.methods.length > 1) {
            const method = await prompts.select({
              message: "Login method",
              options: [
                ...plugin.auth.methods.map((x: any, index: number) => ({
                  label: x.label,
                  value: index.toString(),
                })),
              ],
            })
            if (prompts.isCancel(method)) throw new UI.CancelledError()
            index = parseInt(method as string)
          }
          const method = plugin.auth.methods[index]
          if (method.type === "oauth") {
            await new Promise((resolve) => setTimeout(resolve, 10))
            const authorize = await method.authorize()

            if (authorize.url) {
              prompts.log.info("Go to: " + authorize.url)
            }

            if (authorize.method === "auto") {
              if (authorize.instructions) {
                prompts.log.info(authorize.instructions)
              }
              const spinner = prompts.spinner()
              spinner.start("Waiting for authorization...")
              const result = await authorize.callback()
              if (result.type === "failed") {
                spinner.stop("Failed to authorize", 1)
              }
              if (result.type === "success") {
                if ("refresh" in result) {
                  await Auth.set(provider, {
                    type: "oauth",
                    refresh: result.refresh,
                    access: result.access,
                    expires: result.expires,
                  })
                }
                if ("key" in result) {
                  await Auth.set(provider, {
                    type: "api",
                    key: result.key,
                  })
                }
                spinner.stop("Login successful")
              }
            }

            if (authorize.method === "code") {
              const code = await prompts.text({
                message: "Paste the authorization code here: ",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(code)) throw new UI.CancelledError()
              const result = await authorize.callback(code)
              if (result.type === "failed") {
                prompts.log.error("Failed to authorize")
              }
              if (result.type === "success") {
                if ("refresh" in result) {
                  await Auth.set(provider, {
                    type: "oauth",
                    refresh: result.refresh,
                    access: result.access,
                    expires: result.expires,
                  })
                }
                if ("key" in result) {
                  await Auth.set(provider, {
                    type: "api",
                    key: result.key,
                  })
                }
                prompts.log.success("Login successful")
              }
            }

            // Save selected model to global config if chosen
            if (selectedModel) {
              try {
                const globalConfigPath = path.join(os.homedir(), ".config", "snow-code", "config.json")
                let globalConfig = {}
                try {
                  const file = Bun.file(globalConfigPath)
                  if (await file.exists()) {
                    globalConfig = JSON.parse(await file.text())
                  }
                } catch {}
                globalConfig = { ...globalConfig, model: selectedModel }
                await Bun.write(globalConfigPath, JSON.stringify(globalConfig, null, 2))
                prompts.log.info(`Saved default model: ${selectedModel}`)
              } catch (err) {
                prompts.log.warn("Could not save model preference to config")
              }
            }

            // If this is a standalone LLM setup (not complete), stop here
            if (authCategory === "llm") {
              prompts.log.message("")
              prompts.log.success("✅ LLM Provider authentication complete!")
              prompts.log.message("")
              prompts.log.info("Next steps:")
              prompts.log.message("")
              prompts.log.message("  • Run: snow-code auth login to configure ServiceNow")
              prompts.log.message("  • Run: snow-code auth list to see configured credentials")
              prompts.outro("Done")
              await Instance.dispose()
              process.exit(0)
            }

            // For complete setup, ServiceNow is already configured at the start
            // Now ask about Snow-Flow License (optional)
            prompts.log.message("")
            const configureEnterpriseAfterLLM = await prompts.confirm({
              message: "Configure Snow-Flow License? (optional - enables Jira, Azure DevOps, Confluence)",
              initialValue: false,
            })

            if (prompts.isCancel(configureEnterpriseAfterLLM) || !configureEnterpriseAfterLLM) {
              prompts.log.message("")
              prompts.log.success("✅ Authentication complete!")
              prompts.log.message("")
              prompts.log.info("Next steps:")
              prompts.log.message("")
              prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
              prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
              prompts.outro("Done")
              await Instance.dispose()
              process.exit(0)
            }

            // User wants Snow-Flow License, ask which type (same as standalone)
            prompts.log.message("")

            const accountTypeAfterLLM = await prompts.select({
              message: "Select your account type",
              options: [
                {
                  value: "portal",
                  label: "Individual / Teams",
                  hint: "email-based login (€99/mo or €79/seat)",
                },
                {
                  value: "enterprise",
                  label: "Enterprise",
                  hint: "license key login (custom pricing)",
                },
              ],
            })

            if (prompts.isCancel(accountTypeAfterLLM)) throw new UI.CancelledError()

            if (accountTypeAfterLLM === "portal") {
              // Portal authentication (Individual/Teams) - same as standalone
              const authMethodAfterLLM = await prompts.select({
                message: "How would you like to authenticate?",
                options: [
                  {
                    value: "browser",
                    label: "Browser",
                    hint: "recommended - opens browser for approval",
                  },
                  {
                    value: "email",
                    label: "Email & Password",
                    hint: "direct login",
                  },
                  {
                    value: "magic-link",
                    label: "Magic Link",
                    hint: "passwordless via email",
                  },
                ],
              })

              if (prompts.isCancel(authMethodAfterLLM)) throw new UI.CancelledError()

              // Import and run portal auth flow
              const {
                AuthPortalLoginCommand
              } = await import("./auth-portal.js")

              prompts.outro("Starting portal authentication...")

              // Execute the appropriate auth flow based on method
              const portalArgsAfterLLM = { method: authMethodAfterLLM }
              await AuthPortalLoginCommand.handler(portalArgsAfterLLM as any)

              await Instance.dispose()
              process.exit(0)
            }

            // Enterprise - simple username/password login (admin creates users)
            prompts.log.step("Snow-Flow Enterprise Login")
            prompts.log.info("Login with the credentials provided by your admin")
            prompts.log.message("")

            // Enterprise portal URL is fixed
            const enterprisePortalUrl = "https://portal.snow-flow.dev"
            const enterpriseMcpUrl = "https://enterprise.snow-flow.dev"

            let enterpriseUser: string = ""
            let enterprisePass: string
            let enterpriseAuthResult: any
            const enterpriseMachineId = generateMachineId()

            // Login flow
            let enterpriseLoginSuccess = false

            while (!enterpriseLoginSuccess) {
              enterpriseUser = (await prompts.text({
                message: "Username",
                placeholder: "john.doe",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Username is required"
                },
              })) as string

              if (prompts.isCancel(enterpriseUser)) throw new UI.CancelledError()

              enterprisePass = (await prompts.password({
                message: "Password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(enterprisePass)) throw new UI.CancelledError()

              prompts.log.message("")
              const enterpriseSpinner = prompts.spinner()
              enterpriseSpinner.start("Authenticating...")

              try {
                const response = await fetch(`${enterprisePortalUrl}/api/user-auth/login`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ username: enterpriseUser, password: enterprisePass }),
                })

                enterpriseAuthResult = await response.json()

                if (!response.ok || !enterpriseAuthResult.success) {
                  enterpriseSpinner.stop("Authentication failed", 1)
                  prompts.log.error(enterpriseAuthResult.error || "Invalid username or password")

                  const tryAgainEnterprise = await prompts.confirm({
                    message: "Would you like to try again?",
                    initialValue: true,
                  })
                  if (prompts.isCancel(tryAgainEnterprise) || !tryAgainEnterprise) {
                    prompts.outro("Login cancelled")
                    await Instance.dispose()
                    process.exit(1)
                  }
                  continue
                }

                enterpriseSpinner.stop("Authentication successful!")
                enterpriseLoginSuccess = true
              } catch (error: any) {
                enterpriseSpinner.stop("Connection error", 1)
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.outro("Login cancelled")
                await Instance.dispose()
                process.exit(1)
              }
            }

            const enterpriseRole = enterpriseAuthResult.user?.role || "developer"
            const enterpriseEmail = enterpriseAuthResult.user?.email
            const enterpriseLicenseKey = enterpriseAuthResult.customer?.licenseKey || ""

            // Store enterprise auth
            await Auth.set("enterprise", {
              type: "enterprise",
              licenseKey: enterpriseLicenseKey,
              enterpriseUrl: enterprisePortalUrl,
              token: enterpriseAuthResult.token,
              sessionToken: enterpriseAuthResult.sessionToken,
              username: enterpriseUser,
              email: enterpriseEmail,
              role: enterpriseAuthResult.user?.role || enterpriseRole,
              machineId: enterpriseMachineId,
            })

            // NOTE: .env writes removed - credentials are fetched from Portal API by enterprise MCP server
            // JWT token is stored in MCP config, no need to store license key in .env

            prompts.log.success(`Welcome, ${enterpriseUser}!`)
            prompts.log.info(`Role: ${enterpriseAuthResult.user?.role || enterpriseRole}`)
            if (enterpriseAuthResult.customer?.company) {
              prompts.log.info(`Company: ${enterpriseAuthResult.customer.company}`)
            }

            // Fetch third-party tool credentials from portal (optional)
            prompts.log.message("")
            const enterpriseFetchSpinner = prompts.spinner()
            enterpriseFetchSpinner.start("Checking third-party tool integrations...")

            // Track enabled services for documentation generation
            let enabledServicesEnterprise: string[] = []

            // Check if we have a license key to fetch credentials
            if (!enterpriseLicenseKey) {
              enterpriseFetchSpinner.stop("Could not fetch credentials (no license key)")
              prompts.log.warn("Your customer account may not have a license key configured")
            } else {
              const enterprisePortalCredentials = await PortalSync.pullFromPortal(enterpriseLicenseKey, enterprisePortalUrl)

              if (enterprisePortalCredentials.success && enterprisePortalCredentials.credentials) {
                const creds = enterprisePortalCredentials.credentials
                const credCount = (creds.jira ? 1 : 0) + (creds.azureDevOps ? 1 : 0) + (creds.confluence ? 1 : 0)

                if (credCount > 0) {
                  enterpriseFetchSpinner.stop(`Found ${credCount} integration(s)`)
                  if (creds.jira) prompts.log.message(`  • Jira: ${creds.jira.baseUrl}`)
                  if (creds.azureDevOps) prompts.log.message(`  • Azure DevOps: ${creds.azureDevOps.org}`)
                  if (creds.confluence) prompts.log.message(`  • Confluence: ${creds.confluence.baseUrl}`)

                  // Build enabled services list based on fetched credentials
                  if (creds.jira) enabledServicesEnterprise.push('jira')
                  if (creds.azureDevOps) enabledServicesEnterprise.push('azdo')
                  if (creds.confluence) enabledServicesEnterprise.push('confluence')
                } else {
                  enterpriseFetchSpinner.stop("No third-party integrations configured in portal")
                }
              } else {
                enterpriseFetchSpinner.stop("Could not fetch credentials")
                if (enterprisePortalCredentials.error) {
                  prompts.log.warn(`Reason: ${enterprisePortalCredentials.error}`)
                }
              }
            }

            // For stakeholders, replace docs with read-only version (regardless of integrations)
            await replaceDocumentationForStakeholder(enterpriseRole)

            // Update documentation with enterprise features based on enabled integrations
            if (enabledServicesEnterprise.length > 0) {
              await updateDocumentationWithEnterprise(enabledServicesEnterprise)
            }

            // Configure MCP server
            try {
              const globalSnowCodeDirEnterprise = path.join(os.homedir(), ".snowcode")
              const configPathEnterprise = path.join(globalSnowCodeDirEnterprise, "config.json")
              await Bun.write(path.join(globalSnowCodeDirEnterprise, ".keep"), "")

              const fileEnterprise = Bun.file(configPathEnterprise)
              var configEnterprise: any = {}
              if (await fileEnterprise.exists()) {
                configEnterprise = JSON.parse(await fileEnterprise.text())
              }
              if (!configEnterprise.mcp) configEnterprise.mcp = {}

              const enterpriseProxyPathLLM = await findEnterpriseProxyPath()
              configEnterprise.mcp["snow-flow-enterprise"] = {
                command: enterpriseProxyPathLLM === "npx" ? "npx" : "node",
                args: enterpriseProxyPathLLM === "npx" ? ["snow-flow-enterprise-proxy"] : [enterpriseProxyPathLLM],
                env: {
                  SNOW_LICENSE_KEY: enterpriseLicenseKey,
                  SNOW_ENTERPRISE_URL: enterpriseMcpUrl,
                },
              }

              await Bun.write(configPathEnterprise, JSON.stringify(configEnterprise, null, 2))
              prompts.log.info("Added snow-flow-enterprise MCP server to config")
            } catch (error: any) {
              prompts.log.warn(`Failed to configure MCP server: ${error.message}`)
            }

            prompts.log.message("")
            prompts.log.success("✅ Enterprise authentication complete!")
            prompts.log.message("")
            prompts.log.info("Next steps:")
            prompts.log.message("")
            prompts.log.message('  • Run: snow-code init to configure Claude Code')
            prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
            prompts.outro("Done")
            await Instance.dispose()
            process.exit(0)
          }
        }

        if (provider === "other") {
          const otherProvider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(otherProvider)) throw new UI.CancelledError()
          provider = (otherProvider as string).replace(/^@ai-sdk\//, "")
          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
          )
          prompts.log.message("")
          prompts.log.success("✅ Authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
          prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }

        if (provider === "google-vertex") {
          prompts.log.info(
            "Google Cloud Vertex AI uses Application Default Credentials. Set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'. Optionally set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (or VERTEX_LOCATION)",
          )
          prompts.log.message("")
          prompts.log.success("✅ Authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
          prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }

        // Handle MID Server LLM configuration
        if (provider === "midserver-llm") {
          prompts.log.step("ServiceNow MID Server LLM Configuration")
          prompts.log.info("Configure access to local LLM models through ServiceNow MID Server")
          prompts.log.message("")
          prompts.log.info("This enables routing LLM requests through your MID Server to access")
          prompts.log.info("on-premise models (Ollama, vLLM, LocalAI) within your corporate network.")
          prompts.log.message("")

          // Check if ServiceNow is already configured
          const existingServiceNow = await Auth.get("servicenow")
          let serviceNowInstance = ""
          let hasOAuthCredentials = false

          if (existingServiceNow && existingServiceNow.type === "servicenow-oauth") {
            serviceNowInstance = existingServiceNow.instance
            hasOAuthCredentials = true
            prompts.log.success(`Using existing ServiceNow instance: ${serviceNowInstance}`)
          } else if (existingServiceNow && existingServiceNow.type === "servicenow-basic") {
            serviceNowInstance = existingServiceNow.instance
            hasOAuthCredentials = false
            prompts.log.success(`Using existing ServiceNow instance: ${serviceNowInstance}`)
            prompts.log.warn("Basic Auth detected - automatic gateway deployment requires OAuth")
            prompts.log.info("You can still configure MID Server LLM, but will need to deploy the gateway manually")
          } else {
            prompts.log.warn("ServiceNow not configured. OAuth is recommended for automatic gateway deployment.")
            const configureNow = await prompts.confirm({
              message: "Would you like to configure ServiceNow OAuth now?",
              initialValue: true,
            })
            if (prompts.isCancel(configureNow) || !configureNow) {
              prompts.outro("MID Server LLM setup cancelled")
              await Instance.dispose()
              process.exit(0)
            }

            // Get ServiceNow instance details
            serviceNowInstance = (await prompts.text({
              message: "ServiceNow instance URL",
              placeholder: "dev12345.service-now.com",
              validate: (value) => {
                if (!value || value.trim() === "") return "Instance URL is required"
                const cleaned = value.replace(/^https?:\/\//, "").replace(/\/$/, "")
                if (!cleaned.includes(".service-now.com") && !cleaned.includes("localhost")) {
                  return "Must be a ServiceNow domain"
                }
              },
            })) as string
            if (prompts.isCancel(serviceNowInstance)) throw new UI.CancelledError()
          }

          // Get MID Server name
          prompts.log.message("")
          const midServerName = (await prompts.text({
            message: "MID Server name",
            placeholder: "my-datacenter-mid-1",
            validate: (value) => {
              if (!value || value.trim() === "") return "MID Server name is required"
            },
          })) as string
          if (prompts.isCancel(midServerName)) throw new UI.CancelledError()

          // Get local LLM endpoint (from MID Server perspective)
          const llmEndpoint = (await prompts.text({
            message: "Local LLM endpoint (from MID Server perspective)",
            placeholder: "http://llm-server.internal:11434",
            validate: (value) => {
              if (!value || value.trim() === "") return "LLM endpoint is required"
              if (!value.startsWith("http://") && !value.startsWith("https://")) {
                return "Must be a valid URL (http:// or https://)"
              }
            },
          })) as string
          if (prompts.isCancel(llmEndpoint)) throw new UI.CancelledError()

          // Get local LLM type
          const llmType = (await prompts.select({
            message: "Local LLM type",
            options: [
              { value: "ollama", label: "Ollama", hint: "port 11434" },
              { value: "vllm", label: "vLLM", hint: "OpenAI-compatible" },
              { value: "localai", label: "LocalAI", hint: "OpenAI-compatible" },
              { value: "lmstudio", label: "LM Studio", hint: "OpenAI-compatible" },
              { value: "other", label: "Other", hint: "OpenAI-compatible API" },
            ],
          })) as string
          if (prompts.isCancel(llmType)) throw new UI.CancelledError()

          // Get model name(s)
          const modelName = (await prompts.text({
            message: "Default model name",
            placeholder: llmType === "ollama" ? "llama3.3" : "default",
            validate: (value) => {
              if (!value || value.trim() === "") return "Model name is required"
            },
          })) as string
          if (prompts.isCancel(modelName)) throw new UI.CancelledError()

          // Ensure instance URL format
          const instanceUrl = serviceNowInstance.startsWith("http")
            ? serviceNowInstance
            : `https://${serviceNowInstance}`

          // Get ServiceNow OAuth credentials for deploying the gateway
          let accessToken: string | undefined
          let clientId: string | undefined
          let clientSecret: string | undefined

          if (existingServiceNow && existingServiceNow.type === "servicenow-oauth") {
            accessToken = existingServiceNow.accessToken
            clientId = existingServiceNow.clientId
            clientSecret = existingServiceNow.clientSecret

            // Check if token needs refresh
            if (existingServiceNow.expiresAt && existingServiceNow.expiresAt < Date.now()) {
              prompts.log.info("Refreshing ServiceNow access token...")
              const oauth = new ServiceNowOAuth()
              const refreshResult = await oauth.refreshAccessToken(
                instanceUrl,
                clientId,
                clientSecret,
                existingServiceNow.refreshToken!
              )
              if (refreshResult.success) {
                accessToken = refreshResult.accessToken
              } else {
                prompts.log.warn("Token refresh failed, will need to re-authenticate")
                accessToken = undefined
              }
            }
          }

          // If we don't have OAuth credentials, ask for them
          if (!accessToken) {
            prompts.log.message("")
            prompts.log.step("ServiceNow Authentication Required")
            prompts.log.info("OAuth credentials needed to deploy the LLM Gateway")

            clientId = (await prompts.text({
              message: "OAuth Client ID",
              placeholder: "32-character hex string from ServiceNow",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client ID is required"
                if (value.length < 32) return "Client ID too short"
              },
            })) as string
            if (prompts.isCancel(clientId)) throw new UI.CancelledError()

            clientSecret = (await prompts.password({
              message: "OAuth Client Secret",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client Secret is required"
              },
            })) as string
            if (prompts.isCancel(clientSecret)) throw new UI.CancelledError()

            // Run OAuth flow
            const oauth = new ServiceNowOAuth()
            const authResult = await oauth.authenticate({
              instance: instanceUrl,
              clientId,
              clientSecret,
            })

            if (!authResult.success) {
              prompts.log.error(`Authentication failed: ${authResult.error}`)
              prompts.outro("MID Server LLM setup cancelled")
              await Instance.dispose()
              process.exit(1)
            }

            accessToken = authResult.accessToken
          }

          // Ask if user wants to deploy the LLM Gateway (only if we have OAuth)
          let gatewayDeployed = false
          let connectivityTested = false

          if (hasOAuthCredentials && accessToken) {
            prompts.log.message("")
            const deployGateway = await prompts.confirm({
              message: "Deploy LLM Gateway to ServiceNow now?",
              initialValue: true,
            })

            if (prompts.isCancel(deployGateway)) throw new UI.CancelledError()

            if (deployGateway) {
              const deploySpinner = prompts.spinner()
              deploySpinner.start("Deploying LLM Gateway to ServiceNow...")

              try {
                // Deploy the LLM Gateway via REST API
                const deployResult = await deployLLMGateway({
                  instanceUrl,
                  accessToken: accessToken!,
                  midServerName,
                  llmEndpoint,
                  llmType,
                })

                if (deployResult.success) {
                  deploySpinner.stop("LLM Gateway deployed successfully!")
                  gatewayDeployed = true

                  // Test connectivity through the MID Server
                  prompts.log.message("")
                  const testConnectivity = await prompts.confirm({
                    message: "Test LLM connectivity through MID Server?",
                    initialValue: true,
                  })

                  if (!prompts.isCancel(testConnectivity) && testConnectivity) {
                    const testSpinner = prompts.spinner()
                    testSpinner.start("Testing LLM connectivity via MID Server...")

                    const testResult = await testLLMConnectivity({
                      instanceUrl,
                      accessToken: accessToken!,
                      midServerName,
                      llmEndpoint,
                      modelName,
                    })

                    if (testResult.success) {
                      testSpinner.stop("LLM connectivity test passed!")
                      connectivityTested = true
                    } else {
                      testSpinner.stop(`Connectivity test failed: ${testResult.error}`)
                      prompts.log.warn("The gateway is deployed but the LLM endpoint may not be reachable from the MID Server")
                    }
                  }
                } else {
                  deploySpinner.stop(`Gateway deployment failed: ${deployResult.error}`)
                  prompts.log.warn("You can try deploying manually later with: snow-flow deploy llm-gateway")
                }
              } catch (error: any) {
                deploySpinner.stop(`Deployment error: ${error.message}`)
              }
            }
          } else {
            // User has Basic Auth - cannot auto-deploy
            prompts.log.message("")
            prompts.log.info("Manual gateway deployment required (OAuth needed for automatic deployment)")
            prompts.log.info("See: docs/MID_SERVER_LLM_ARCHITECTURE.md for deployment instructions")
          }

          // Save the MID Server LLM provider configuration
          const globalConfigPath = path.join(os.homedir(), ".config", "snow-code", "config.json")
          let globalConfig: any = {}
          try {
            const file = Bun.file(globalConfigPath)
            if (await file.exists()) {
              globalConfig = JSON.parse(await file.text())
            }
          } catch {}

          // Add the servicenow-llm provider configuration
          if (!globalConfig.provider) globalConfig.provider = {}
          globalConfig.provider["servicenow-llm"] = {
            npm: "@ai-sdk/openai-compatible",
            name: "ServiceNow LLM Gateway",
            options: {
              baseURL: `${instanceUrl}/api/x_snow_llm/v1`,
              apiKey: "{env:SERVICENOW_LLM_TOKEN}",
            },
            models: {
              [modelName]: {
                name: `${modelName} (via MID Server)`,
              },
            },
          }

          // Also save the MID Server configuration
          if (!globalConfig.midServerLLM) globalConfig.midServerLLM = {}
          globalConfig.midServerLLM = {
            midServer: midServerName,
            llmEndpoint: llmEndpoint,
            llmType: llmType,
            defaultModel: modelName,
            instanceUrl: instanceUrl,
            gatewayDeployed: gatewayDeployed,
            connectivityTested: connectivityTested,
          }

          // Set default model to use MID Server LLM
          globalConfig.model = `servicenow-llm/${modelName}`

          await Bun.write(globalConfigPath, JSON.stringify(globalConfig, null, 2))

          prompts.log.message("")
          prompts.log.success("✅ MID Server LLM configuration complete!")
          prompts.log.message("")
          prompts.log.info("Configuration saved:")
          prompts.log.message(`  • MID Server: ${midServerName}`)
          prompts.log.message(`  • LLM Endpoint: ${llmEndpoint}`)
          prompts.log.message(`  • LLM Type: ${llmType}`)
          prompts.log.message(`  • Default Model: ${modelName}`)
          prompts.log.message(`  • Gateway Deployed: ${gatewayDeployed ? "Yes" : "No"}`)
          prompts.log.message(`  • Connectivity Tested: ${connectivityTested ? "Yes" : "No"}`)
          prompts.log.message("")

          if (gatewayDeployed && connectivityTested) {
            prompts.log.success("🚀 Ready to use! Run: snow-flow agent \"<objective>\"")
          } else if (gatewayDeployed) {
            prompts.log.info("Gateway deployed. Test connectivity manually or start using:")
            prompts.log.message('  snow-flow agent "<objective>"')
          } else {
            prompts.log.info("Next steps:")
            prompts.log.message("  1. Deploy LLM Gateway: snow-flow deploy llm-gateway")
            prompts.log.message('  2. Start developing: snow-flow agent "<objective>"')
          }

          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }

        if (provider === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })

        // Save selected model to global config if chosen
        if (selectedModel) {
          try {
            const globalConfigPath = path.join(os.homedir(), ".config", "snow-code", "config.json")
            let globalConfig = {}
            try {
              const file = Bun.file(globalConfigPath)
              if (await file.exists()) {
                globalConfig = JSON.parse(await file.text())
              }
            } catch {}
            globalConfig = { ...globalConfig, model: selectedModel }
            await Bun.write(globalConfigPath, JSON.stringify(globalConfig, null, 2))
            prompts.log.info(`Saved default model: ${selectedModel}`)
          } catch (err) {
            prompts.log.warn("Could not save model preference to config")
          }
        }

        // If this is a standalone LLM setup (not complete), stop here
        if (authCategory === "llm") {
          prompts.log.message("")
          prompts.log.success("✅ LLM Provider authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message("  • Run: snow-code auth login to configure ServiceNow")
          prompts.log.message("  • Run: snow-code auth list to see configured credentials")
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }

        // For complete setup, ServiceNow is already configured at the start
        // Now ask about Snow-Flow License (optional)
        prompts.log.message("")
        const configureEnterpriseFinal = await prompts.confirm({
          message: "Configure Snow-Flow License? (optional - enables Jira, Azure DevOps, Confluence)",
          initialValue: false,
        })

        if (!prompts.isCancel(configureEnterpriseFinal) && configureEnterpriseFinal) {
          // User wants Snow-Flow License, ask which type (same as standalone)
          prompts.log.message("")

          const accountTypeFinal = await prompts.select({
            message: "Select your account type",
            options: [
              {
                value: "portal",
                label: "Individual / Teams",
                hint: "email-based login (€99/mo or €79/seat)",
              },
              {
                value: "enterprise",
                label: "Enterprise",
                hint: "license key login (custom pricing)",
              },
            ],
          })

          if (prompts.isCancel(accountTypeFinal)) throw new UI.CancelledError()

          if (accountTypeFinal === "portal") {
            // Portal authentication (Individual/Teams) - same as standalone
            const authMethodFinal = await prompts.select({
              message: "How would you like to authenticate?",
              options: [
                {
                  value: "browser",
                  label: "Browser",
                  hint: "recommended - opens browser for approval",
                },
                {
                  value: "email",
                  label: "Email & Password",
                  hint: "direct login",
                },
                {
                  value: "magic-link",
                  label: "Magic Link",
                  hint: "passwordless via email",
                },
              ],
            })

            if (prompts.isCancel(authMethodFinal)) throw new UI.CancelledError()

            // Import and run portal auth flow
            const {
              AuthPortalLoginCommand
            } = await import("./auth-portal.js")

            prompts.outro("Starting portal authentication...")

            // Execute the appropriate auth flow based on method
            const portalArgsFinal = { method: authMethodFinal }
            await AuthPortalLoginCommand.handler(portalArgsFinal as any)

            await Instance.dispose()
            process.exit(0)
          }

          // Enterprise - simple username/password login (admin creates users)
          prompts.log.step("Snow-Flow Enterprise Login")
          prompts.log.info("Login with the credentials provided by your admin")
          prompts.log.message("")

          // Enterprise portal URL is fixed
          const enterprisePortalUrlFinal = "https://portal.snow-flow.dev"
          const enterpriseMcpUrlFinal = "https://enterprise.snow-flow.dev"

          let enterpriseUserFinal: string = ""
          let enterprisePassFinal: string
          let enterpriseAuthResultFinal: any
          const enterpriseMachineIdFinal = generateMachineId()

          // Login flow
          let enterpriseLoginSuccessFinal = false

          while (!enterpriseLoginSuccessFinal) {
            enterpriseUserFinal = (await prompts.text({
              message: "Username",
              placeholder: "john.doe",
              validate: (value) => {
                if (!value || value.trim() === "") return "Username is required"
              },
            })) as string

            if (prompts.isCancel(enterpriseUserFinal)) throw new UI.CancelledError()

            enterprisePassFinal = (await prompts.password({
              message: "Password",
              validate: (value) => {
                if (!value || value.trim() === "") return "Password is required"
              },
            })) as string

            if (prompts.isCancel(enterprisePassFinal)) throw new UI.CancelledError()

            prompts.log.message("")
            const enterpriseSpinnerFinal = prompts.spinner()
            enterpriseSpinnerFinal.start("Authenticating...")

            try {
              const response = await fetch(`${enterprisePortalUrlFinal}/api/user-auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: enterpriseUserFinal, password: enterprisePassFinal }),
              })

              enterpriseAuthResultFinal = await response.json()

              if (!response.ok || !enterpriseAuthResultFinal.success) {
                enterpriseSpinnerFinal.stop("Authentication failed", 1)
                prompts.log.error(enterpriseAuthResultFinal.error || "Invalid username or password")

                const tryAgainFinal = await prompts.confirm({
                  message: "Would you like to try again?",
                  initialValue: true,
                })
                if (prompts.isCancel(tryAgainFinal) || !tryAgainFinal) {
                  prompts.outro("Login cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }
                continue
              }

              enterpriseSpinnerFinal.stop("Authentication successful!")
              enterpriseLoginSuccessFinal = true
            } catch (error: any) {
              enterpriseSpinnerFinal.stop("Connection error", 1)
              prompts.log.error(`Connection error: ${error.message}`)
              prompts.outro("Login cancelled")
              await Instance.dispose()
              process.exit(1)
            }
          }

          const enterpriseRoleFinal = enterpriseAuthResultFinal.user?.role || "developer"
          const enterpriseEmailFinal = enterpriseAuthResultFinal.user?.email
          const enterpriseLicenseKeyFinal = enterpriseAuthResultFinal.customer?.licenseKey || ""

          // Store enterprise auth
          await Auth.set("enterprise", {
            type: "enterprise",
            licenseKey: enterpriseLicenseKeyFinal,
            enterpriseUrl: enterprisePortalUrlFinal,
            token: enterpriseAuthResultFinal.token,
            sessionToken: enterpriseAuthResultFinal.sessionToken,
            username: enterpriseUserFinal,
            email: enterpriseEmailFinal,
            role: enterpriseAuthResultFinal.user?.role || enterpriseRoleFinal,
            machineId: enterpriseMachineIdFinal,
          })

          // NOTE: .env writes removed - credentials are fetched from Portal API by enterprise MCP server
          // JWT token is stored in MCP config, no need to store license key in .env

          prompts.log.success(`Welcome, ${enterpriseUserFinal}!`)
          prompts.log.info(`Role: ${enterpriseAuthResultFinal.user?.role || enterpriseRoleFinal}`)
          if (enterpriseAuthResultFinal.customer?.company) {
            prompts.log.info(`Company: ${enterpriseAuthResultFinal.customer.company}`)
          }

          // Fetch third-party tool credentials from portal (optional)
          prompts.log.message("")
          const enterpriseFetchSpinnerFinal = prompts.spinner()
          enterpriseFetchSpinnerFinal.start("Checking third-party tool integrations...")

          // Track enabled services for documentation generation
          let enabledServicesFinal: string[] = []

          // Check if we have a license key to fetch credentials
          if (!enterpriseLicenseKeyFinal) {
            enterpriseFetchSpinnerFinal.stop("Could not fetch credentials (no license key)")
            prompts.log.warn("Your customer account may not have a license key configured")
          } else {
            const enterprisePortalCredentialsFinal = await PortalSync.pullFromPortal(enterpriseLicenseKeyFinal, enterprisePortalUrlFinal)

            if (enterprisePortalCredentialsFinal.success && enterprisePortalCredentialsFinal.credentials) {
              const creds = enterprisePortalCredentialsFinal.credentials
              const credCount = (creds.jira ? 1 : 0) + (creds.azureDevOps ? 1 : 0) + (creds.confluence ? 1 : 0)

              if (credCount > 0) {
                enterpriseFetchSpinnerFinal.stop(`Found ${credCount} integration(s)`)
                if (creds.jira) prompts.log.message(`  • Jira: ${creds.jira.baseUrl}`)
                if (creds.azureDevOps) prompts.log.message(`  • Azure DevOps: ${creds.azureDevOps.org}`)
                if (creds.confluence) prompts.log.message(`  • Confluence: ${creds.confluence.baseUrl}`)

                // Build enabled services list based on fetched credentials
                if (creds.jira) enabledServicesFinal.push('jira')
                if (creds.azureDevOps) enabledServicesFinal.push('azdo')
                if (creds.confluence) enabledServicesFinal.push('confluence')
              } else {
                enterpriseFetchSpinnerFinal.stop("No third-party integrations configured in portal")
              }
            } else {
              enterpriseFetchSpinnerFinal.stop("Could not fetch credentials")
              if (enterprisePortalCredentialsFinal.error) {
                prompts.log.warn(`Reason: ${enterprisePortalCredentialsFinal.error}`)
              }
            }
          }

          // For stakeholders, replace docs with read-only version (regardless of integrations)
          await replaceDocumentationForStakeholder(enterpriseRoleFinal)

          // Update documentation with enterprise features based on enabled integrations
          if (enabledServicesFinal.length > 0) {
            await updateDocumentationWithEnterprise(enabledServicesFinal)
          }

          // Configure MCP server
          try {
            const globalSnowCodeDirFinal = path.join(os.homedir(), ".snowcode")
            const configPathFinal = path.join(globalSnowCodeDirFinal, "config.json")
            await Bun.write(path.join(globalSnowCodeDirFinal, ".keep"), "")

            const fileFinal = Bun.file(configPathFinal)
            var configFinal: any = {}
            if (await fileFinal.exists()) {
              configFinal = JSON.parse(await fileFinal.text())
            }
            if (!configFinal.mcp) configFinal.mcp = {}

            const enterpriseProxyPathFinal = await findEnterpriseProxyPath()
            configFinal.mcp["snow-flow-enterprise"] = {
              command: enterpriseProxyPathFinal === "npx" ? "npx" : "node",
              args: enterpriseProxyPathFinal === "npx" ? ["snow-flow-enterprise-proxy"] : [enterpriseProxyPathFinal],
              env: {
                SNOW_LICENSE_KEY: enterpriseLicenseKeyFinal,
                SNOW_ENTERPRISE_URL: enterpriseMcpUrlFinal,
              },
            }

            await Bun.write(configPathFinal, JSON.stringify(configFinal, null, 2))
            prompts.log.info("Added snow-flow-enterprise MCP server to config")
          } catch (error: any) {
            prompts.log.warn(`Failed to configure MCP server: ${error.message}`)
          }

          prompts.log.message("")
          prompts.log.success("✅ Enterprise authentication complete!")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("")
          prompts.log.message('  • Run: snow-code init to configure Claude Code')
          prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(0)
        }


        // If enterprise was not configured, show completion here
        prompts.log.message("")
        prompts.log.success("✅ Authentication complete!")
        prompts.log.message("")
        prompts.log.info("Next steps:")
        prompts.log.message("")
        prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
        prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
        prompts.outro("Done")
        await Instance.dispose()
        process.exit(0)
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
