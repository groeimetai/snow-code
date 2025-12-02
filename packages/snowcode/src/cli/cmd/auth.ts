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

          // Write to .env file
          const envUpdates: Array<{ key: string; value: string }> = [
            { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: licenseKey },
            { key: "SNOW_ENTERPRISE_URL", value: portalUrl },
          ]
          await updateEnvFile(envUpdates)

          prompts.log.success(`Welcome, ${username}!`)
          prompts.log.info(`Role: ${authData.user?.role || role}`)
          if (authData.customer?.company) {
            prompts.log.info(`Company: ${authData.customer.company}`)
          }

          // Fetch third-party tool credentials from portal (optional)
          prompts.log.message("")
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking third-party tool integrations...")

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

          // Write to .env file
          const envUpdates: Array<{ key: string; value: string }> = [
            { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: licenseKey },
            { key: "SNOW_ENTERPRISE_URL", value: portalUrl },
          ]
          await updateEnvFile(envUpdates)

          prompts.log.success(`Welcome, ${username}!`)
          prompts.log.info(`Role: ${authData.user?.role || role}`)
          if (authData.customer?.company) {
            prompts.log.info(`Company: ${authData.customer.company}`)
          }

          // Fetch third-party tool credentials from portal (optional)
          prompts.log.message("")
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking third-party tool integrations...")

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

        // Old enterprise registration/login code has been removed.
        // The new flow uses simple username/password login (admin creates users).
        // This placeholder prevents syntax errors while we clean up the dead code.
        if (false && "DEAD_CODE_MARKER") {
          const accountAction = "login"

          // Placeholder variables for dead code (TypeScript needs these)
          const licenseKey = ""
          const portalUrl = ""
          const licenseServerUrl = ""
          const mcpServerUrl = ""

          let username: string = ""
          let email: string | undefined
          let password: string
          let role: "developer" | "stakeholder" | "admin" = "developer"
          let authData: any

          // Generate machine ID for device binding
          const machineId = generateMachineId()

          if (accountAction === "register") {
            // New user registration with retry loop
            let registrationSuccess = false

            while (!registrationSuccess) {
              prompts.log.info("Creating your user account...")

              // Username validation with availability check
              let usernameValid = false
              while (!usernameValid) {
                username = (await prompts.text({
                  message: "Choose a username",
                  placeholder: "john.doe",
                  validate: (value) => {
                    if (!value || value.trim() === "") return "Username is required"
                    if (value.length < 3) return "Username must be at least 3 characters"
                  },
                })) as string

                if (prompts.isCancel(username)) throw new UI.CancelledError()

                // Check if username is available
                try {
                  const checkResponse = await fetch(
                    `${portalUrl}/api/user-auth/check-availability?username=${encodeURIComponent(username)}&licenseKey=${encodeURIComponent(licenseKey)}`,
                    { method: "GET", signal: AbortSignal.timeout(10000) }
                  )

                  if (checkResponse.ok) {
                    const checkData = await checkResponse.json()
                    if (!checkData.usernameAvailable) {
                      prompts.log.error("⚠️  Username already taken")
                      prompts.log.message("")
                      continue // Ask for username again
                    }
                    usernameValid = true
                  } else {
                    // If check fails, proceed anyway (server might not have endpoint yet)
                    usernameValid = true
                  }
                } catch (error) {
                  // Network error - proceed anyway
                  usernameValid = true
                }
              }

              // Email validation with availability check
              let emailValid = false
              while (!emailValid) {
                email = (await prompts.text({
                  message: "Your email",
                  placeholder: "john.doe@company.com",
                  validate: (value) => {
                    if (!value || value.trim() === "") return "Email is required"
                    if (!value.includes("@")) return "Please enter a valid email"
                  },
                })) as string

                if (prompts.isCancel(email)) throw new UI.CancelledError()

                // Check if email is available
                try {
                  const checkResponse = await fetch(
                    `${portalUrl}/api/user-auth/check-availability?email=${encodeURIComponent(email)}&licenseKey=${encodeURIComponent(licenseKey)}`,
                    { method: "GET", signal: AbortSignal.timeout(10000) }
                  )

                  if (checkResponse.ok) {
                    const checkData = await checkResponse.json()
                    if (!checkData.emailAvailable) {
                      prompts.log.error("⚠️  Email already registered")
                      prompts.log.message("")
                      continue // Ask for email again
                    }
                    emailValid = true
                  } else {
                    // If check fails, proceed anyway (server might not have endpoint yet)
                    emailValid = true
                  }
                } catch (error) {
                  // Network error - proceed anyway
                  emailValid = true
                }
              }

              password = (await prompts.password({
                message: "Choose a password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                  if (value.length < 8) return "Password must be at least 8 characters"
                },
              })) as string

              if (prompts.isCancel(password)) throw new UI.CancelledError()

              const passwordConfirm = (await prompts.password({
                message: "Confirm password",
                validate: (value) => {
                  if (value !== password) return "Passwords do not match"
                },
              })) as string

              if (prompts.isCancel(passwordConfirm)) throw new UI.CancelledError()

              const roleChoice = (await prompts.select({
                message: "Select your role",
                options: [
                  {
                    value: "developer",
                    label: "Developer",
                    hint: "Full MCP access + ServiceNow tools",
                  },
                  {
                    value: "stakeholder",
                    label: "Stakeholder",
                    hint: "Portal-only access for monitoring",
                  },
                ],
              })) as string

              if (prompts.isCancel(roleChoice)) throw new UI.CancelledError()
              role = roleChoice as "developer" | "stakeholder" | "admin"

              // Check seat availability BEFORE collecting user info
              prompts.log.message("")
              const seatCheckSpinner = prompts.spinner()
              seatCheckSpinner.start(`Checking ${role} seat availability...`)

              try {
                const seatCheckResponse = await fetch(
                  `${portalUrl}/api/user-auth/check-seats?licenseKey=${encodeURIComponent(licenseKey)}&role=${role}`
                )

                const seatCheck = await seatCheckResponse.json()

                if (!seatCheckResponse.ok || !seatCheck.success) {
                  seatCheckSpinner.stop("Seat check failed", 1)
                  prompts.log.error(seatCheck.error || "Failed to check seat availability")
                  prompts.outro("Registration cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                if (!seatCheck.seatsAvailable) {
                  seatCheckSpinner.stop("No seats available", 1)
                  prompts.log.error(seatCheck.message || `No ${role} seats available`)
                  if (!seatCheck.unlimited && seatCheck.totalSeats) {
                    prompts.log.info(`Current usage: ${seatCheck.usedSeats}/${seatCheck.totalSeats} seats used`)
                  }
                  prompts.log.message("")
                  prompts.log.warn("Please contact your administrator to increase seat allocation")
                  prompts.outro("Registration cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                seatCheckSpinner.stop(seatCheck.message || "Seats available")
                if (!seatCheck.unlimited && seatCheck.totalSeats) {
                  prompts.log.info(`Available seats: ${seatCheck.availableSeats}/${seatCheck.totalSeats}`)
                }
              } catch (error: any) {
                seatCheckSpinner.stop("Connection error", 1)
                prompts.log.error(`Failed to check seat availability: ${error.message}`)
                prompts.log.warn("Continuing with registration (seat check unavailable)")
              }

              prompts.log.info(`Machine ID: ${machineId.substring(0, 16)}...`)

              // Register with enterprise backend
              prompts.log.message("")
              const spinner = prompts.spinner()
              spinner.start("Registering user account...")

              try {
                const response = await fetch(`${portalUrl}/api/user-auth/register`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    licenseKey,
                    username,
                    email,
                    password,
                    role,
                  }),
                })

                authData = await response.json()

                if (!response.ok || !authData.success) {
                  spinner.stop("Registration failed", 1)
                  prompts.log.error(authData.error || "Unknown error")
                  prompts.log.message("")

                  // Ask if user wants to try again
                  const tryAgain = await prompts.confirm({
                    message: "Would you like to try again with different credentials?",
                    initialValue: true,
                  })

                  if (prompts.isCancel(tryAgain) || !tryAgain) {
                    prompts.outro("Registration cancelled")
                    await Instance.dispose()
                    process.exit(1)
                  }

                  prompts.log.message("")
                  continue  // Retry registration
                }

                spinner.stop("Registration successful!")
                registrationSuccess = true
              } catch (error: any) {
                spinner.stop("Connection error", 1)
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.log.message("")
                prompts.log.warn("Unable to connect to enterprise server")
                prompts.log.info(`URL: ${portalUrl}/api/user-auth/register`)
                prompts.log.message("")

                // Ask if user wants to try again
                const tryAgain = await prompts.confirm({
                  message: "Would you like to try again?",
                  initialValue: true,
                })

                if (prompts.isCancel(tryAgain) || !tryAgain) {
                  prompts.outro("Registration cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                prompts.log.message("")
                continue  // Retry registration
              }
            }
          } else {
            // Existing user login with retry loop
            let loginSuccess = false

            while (!loginSuccess) {
              prompts.log.info("Logging in with existing account...")

              username = (await prompts.text({
                message: "Your username",
                placeholder: "john.doe",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Username is required"
                },
              })) as string

              if (prompts.isCancel(username)) throw new UI.CancelledError()

              password = (await prompts.password({
                message: "Your password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(password)) throw new UI.CancelledError()

              prompts.log.info(`Machine ID: ${machineId.substring(0, 16)}...`)

              // Login with enterprise backend
              prompts.log.message("")
              const spinner = prompts.spinner()
              spinner.start("Authenticating...")

              try {
                const response = await fetch(`${portalUrl}/api/user-auth/login`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    licenseKey,
                    username,
                    password,
                  }),
                })

                authData = await response.json()

                if (!response.ok || !authData.success) {
                  spinner.stop("Authentication failed", 1)
                  prompts.log.error(authData.error || "Invalid username or password")
                  prompts.log.message("")

                  // Ask if user wants to try again
                  const tryAgain = await prompts.confirm({
                    message: "Would you like to try again?",
                    initialValue: true,
                  })

                  if (prompts.isCancel(tryAgain) || !tryAgain) {
                    prompts.outro("Login cancelled")
                    await Instance.dispose()
                    process.exit(1)
                  }

                  prompts.log.message("")
                  continue  // Retry login
                }

                spinner.stop("Authentication successful!")
                loginSuccess = true

                // Extract role and email from response
                role = authData.user?.role || "developer"
                email = authData.user?.email

                // 🔐 CHECK IF PASSWORD RESET IS REQUIRED
                try {
                const userId = authData.user?.userId || crypto.createHash('sha256').update(email || username).digest('hex')
                const resetCheckResponse = await fetch(`${portalUrl}/api/user-auth/password-reset-required?userId=${userId}`, {
                  signal: AbortSignal.timeout(5000),
                })

                if (resetCheckResponse.ok) {
                  const resetData = await resetCheckResponse.json()

                  if (resetData.passwordResetRequired) {
                    prompts.log.message("")
                    prompts.log.warn("⚠️  Password reset required")
                    prompts.log.info("You must change your temporary password before continuing")
                    prompts.log.message("")

                    const newPassword = (await prompts.password({
                      message: "Enter your new password",
                      validate: (value) => {
                        if (!value || value.trim() === "") return "Password is required"
                        if (value.length < 8) return "Password must be at least 8 characters"
                        if (value === password) return "New password must be different from current password"
                      },
                    })) as string

                    if (prompts.isCancel(newPassword)) {
                      prompts.log.error("Password reset cancelled")
                      prompts.outro("Done")
                      await Instance.dispose()
                      process.exit(1)
                    }

                    const confirmPassword = (await prompts.password({
                      message: "Confirm your new password",
                      validate: (value) => {
                        if (value !== newPassword) return "Passwords do not match"
                      },
                    })) as string

                    if (prompts.isCancel(confirmPassword)) {
                      prompts.log.error("Password reset cancelled")
                      prompts.outro("Done")
                      await Instance.dispose()
                      process.exit(1)
                    }

                    // Reset password
                    prompts.log.message("")
                    const resetSpinner = prompts.spinner()
                    resetSpinner.start("Resetting password...")

                    try {
                      const resetResponse = await fetch(`${portalUrl}/api/user-auth/reset-password`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          userId,
                          currentPassword: password,
                          newPassword,
                        }),
                        signal: AbortSignal.timeout(10000),
                      })

                      const resetResult = await resetResponse.json()

                      if (!resetResponse.ok || !resetResult.success) {
                        resetSpinner.stop("Password reset failed", 1)
                        prompts.log.error(resetResult.error || "Failed to reset password")
                        prompts.log.warn("Please try again or contact support")
                        prompts.outro("Done")
                        await Instance.dispose()
                        process.exit(1)
                      }

                      resetSpinner.stop("Password reset successful!")
                      prompts.log.success("✅ Your password has been updated")
                      prompts.log.info("You can now use your new password for future logins")

                      // Update password variable for storage
                      password = newPassword
                    } catch (resetError: any) {
                      resetSpinner.stop("Password reset failed", 1)
                      prompts.log.error(`Connection error: ${resetError.message}`)
                      prompts.log.warn("Unable to reset password. Please try again later.")
                      prompts.outro("Done")
                      await Instance.dispose()
                      process.exit(1)
                    }
                  }
                }
                } catch (checkError) {
                  // Silently continue if password reset check fails
                  // This ensures backward compatibility if endpoint doesn't exist
                }
              } catch (error: any) {
                spinner.stop("Connection error", 1)
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.log.message("")
                prompts.log.warn("Unable to connect to enterprise server")
                prompts.log.info(`URL: ${portalUrl}/api/user-auth/login`)
                prompts.log.message("")

                // Ask if user wants to try again
                const tryAgain = await prompts.confirm({
                  message: "Would you like to try again?",
                  initialValue: true,
                })

                if (prompts.isCancel(tryAgain) || !tryAgain) {
                  prompts.outro("Login cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                prompts.log.message("")
                continue  // Retry login
              }
            }
          }

          // Store enterprise auth with user info
          await Auth.set("enterprise", {
            type: "enterprise",
            licenseKey,
            enterpriseUrl: portalUrl || undefined,
            token: authData.token,
            sessionToken: authData.sessionToken,
            username,
            email,
            role: authData.user?.role || role,
            machineId,
          })

          prompts.log.success(`Welcome, ${username}!`)
          prompts.log.info(`Role: ${authData.user?.role || role}`)
          if (authData.customer?.company) {
            prompts.log.info(`Company: ${authData.customer.company}`)
          }
          if (authData.user?.activeSessions !== undefined) {
            prompts.log.info(`Active sessions: ${authData.user.activeSessions} (max 1 per user)`)
          }

          let jiraBaseUrl: string | undefined
          let confluenceUrl: string | undefined
          let atlassianEmail: string | undefined
          let atlassianApiToken: string | undefined
          let azureOrg: string | undefined
          let azureProject: string | undefined
          let azurePat: string | undefined

          // Check for existing credentials in portal
          prompts.log.message("")
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking for existing credentials in portal...")

          const portalCredentials = await PortalSync.pullFromPortal(licenseKey, portalUrl)

          if (portalCredentials.success && portalCredentials.credentials) {
            const creds = portalCredentials.credentials
            const credCount = (creds.jira ? 1 : 0) + (creds.azureDevOps ? 1 : 0) + (creds.confluence ? 1 : 0)

            if (credCount > 0) {
              fetchSpinner.stop(`Found ${credCount} credential(s) in portal`)

              // Show what credentials are available
              prompts.log.message("")
              if (creds.jira) prompts.log.message(`  • Jira: ${creds.jira.baseUrl}`)
              if (creds.azureDevOps) prompts.log.message(`  • Azure DevOps: ${creds.azureDevOps.org}`)
              if (creds.confluence) prompts.log.message(`  • Confluence: ${creds.confluence.baseUrl}`)
              prompts.log.message("")

              const usePortalCreds = await prompts.confirm({
                message: "Use these credentials from portal?",
                initialValue: true,
              })

              if (!prompts.isCancel(usePortalCreds) && usePortalCreds) {
                // Apply portal credentials
                if (creds.jira) {
                  jiraBaseUrl = creds.jira.baseUrl
                  atlassianEmail = atlassianEmail || creds.jira.email
                  atlassianApiToken = atlassianApiToken || creds.jira.apiToken
                }
                if (creds.azureDevOps) {
                  azureOrg = creds.azureDevOps.org
                  azurePat = creds.azureDevOps.pat
                }
                if (creds.confluence) {
                  confluenceUrl = creds.confluence.baseUrl
                  atlassianEmail = atlassianEmail || creds.confluence.email
                  atlassianApiToken = atlassianApiToken || creds.confluence.apiToken
                }

                prompts.log.success("Portal credentials applied")
              }
            } else {
              fetchSpinner.stop("No credentials found in portal")
            }
          } else {
            fetchSpinner.stop("Could not fetch portal credentials")
          }

          // Optional integrations (only ask if not all credentials are set)
          const hasAllCredentials = jiraBaseUrl && azureOrg && confluenceUrl
          const configureIntegrations = hasAllCredentials ? false : await prompts.confirm({
            message: "Configure additional integrations (Jira, Azure DevOps, Confluence)?",
            initialValue: false,
          })

          if (!prompts.isCancel(configureIntegrations) && configureIntegrations) {
            const integrations = await prompts.multiselect({
              message: "Select integrations to configure",
              options: [
                { value: "jira", label: "Jira" },
                { value: "azure", label: "Azure DevOps" },
                { value: "confluence", label: "Confluence" },
              ],
            }) as string[]

            if (!prompts.isCancel(integrations)) {
              // Atlassian credentials (shared by Jira and Confluence)
              const needsAtlassian = integrations.includes("jira") || integrations.includes("confluence")
              if (needsAtlassian) {
                atlassianEmail = (await prompts.text({
                  message: "Atlassian Email (used for both Jira and Confluence)",
                  placeholder: "admin@company.com",
                })) as string

                if (!prompts.isCancel(atlassianEmail)) {
                  atlassianApiToken = (await prompts.password({
                    message: "Atlassian API Token (get from https://id.atlassian.com/manage-profile/security/api-tokens)",
                  })) as string
                }
              }

              // Jira configuration (only base URL)
              if (integrations.includes("jira") && atlassianApiToken) {
                jiraBaseUrl = (await prompts.text({
                  message: "Jira Base URL",
                  placeholder: "https://company.atlassian.net",
                })) as string
              }

              // Confluence configuration (only base URL)
              if (integrations.includes("confluence") && atlassianApiToken) {
                confluenceUrl = (await prompts.text({
                  message: "Confluence Base URL",
                  placeholder: "https://company.atlassian.net/wiki",
                })) as string
              }

              // Azure DevOps configuration
              if (integrations.includes("azure")) {
                azureOrg = (await prompts.text({
                  message: "Azure DevOps Organization",
                  placeholder: "mycompany",
                })) as string

                if (!prompts.isCancel(azureOrg) && azureOrg) {
                  azureProject = (await prompts.text({
                    message: "Azure DevOps Project",
                    placeholder: "MyProject",
                  })) as string

                  if (!prompts.isCancel(azureProject)) {
                    azurePat = (await prompts.password({
                      message: "Azure Personal Access Token (PAT)",
                    })) as string
                  }
                }
              }
            }
          }

          // Merge integration credentials with existing auth data
          const existingAuth = await Auth.get("enterprise")
          await Auth.set("enterprise", {
            ...existingAuth, // Preserve token, sessionToken, username, email, role, machineId
            type: "enterprise",
            licenseKey,
            enterpriseUrl: portalUrl || undefined,
            jiraBaseUrl: jiraBaseUrl || undefined,
            confluenceUrl: confluenceUrl || undefined,
            atlassianEmail: atlassianEmail || undefined,
            atlassianApiToken: atlassianApiToken || undefined,
            azureOrg: azureOrg || undefined,
            azureProject: azureProject || undefined,
            azurePat: azurePat || undefined,
          })

          // Sync credentials to enterprise portal (works with license key, no token needed!)
          if (licenseKey && (jiraBaseUrl || azureOrg || confluenceUrl)) {
            try {
              const syncSpinner = prompts.spinner()
              syncSpinner.start("Syncing credentials to enterprise portal...")

              // Build credentials array
              const credentials = []

              // Jira credentials
              if (jiraBaseUrl && atlassianApiToken) {
                credentials.push({
                  service: "jira",
                  credentialType: "api_token",
                  baseUrl: jiraBaseUrl,
                  email: atlassianEmail,
                  apiToken: atlassianApiToken
                })
              }

              // Azure DevOps credentials
              if (azureOrg && azurePat) {
                credentials.push({
                  service: "azure-devops",
                  credentialType: "api_token",
                  baseUrl: `https://dev.azure.com/${azureOrg}`,
                  apiToken: azurePat
                })
              }

              // Confluence credentials
              if (confluenceUrl && atlassianApiToken) {
                credentials.push({
                  service: "confluence",
                  credentialType: "api_token",
                  baseUrl: confluenceUrl,
                  email: atlassianEmail,
                  apiToken: atlassianApiToken
                })
              }

              // Sync all credentials to portal in one call (uses license key, no token needed!)
              if (credentials.length > 0) {
                const syncResponse = await fetch(`${portalUrl}/api/credentials/sync-from-cli`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    licenseKey,
                    credentials
                  }),
                  signal: AbortSignal.timeout(15000)
                })

                const syncData = await syncResponse.json()

                if (syncResponse.ok && syncData.success) {
                  const successCount = syncData.results?.filter((r: any) => r.success).length || 0
                  const totalCount = syncData.results?.length || 0
                  syncSpinner.stop(`✅ Synced ${successCount}/${totalCount} credentials to portal`)
                } else {
                  syncSpinner.stop("⚠️  Failed to sync credentials to portal", 1)
                  prompts.log.info(`Error: ${syncData.error || 'Unknown error'}`)
                  prompts.log.info("Credentials saved locally, but not synced to portal")
                }
              } else {
                syncSpinner.stop()
              }
            } catch (error: any) {
              prompts.log.warn(`Failed to sync credentials: ${error.message}`)
              prompts.log.info("Credentials saved locally, but not synced to portal")
            }
          }

          // Write to .env file
          const envUpdates: Array<{ key: string; value: string }> = [
            { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: licenseKey },
          ]
          if (portalUrl) envUpdates.push({ key: "SNOW_ENTERPRISE_URL", value: portalUrl })
          if (jiraBaseUrl) envUpdates.push({ key: "SNOW_JIRA_BASE_URL", value: jiraBaseUrl })
          if (confluenceUrl) envUpdates.push({ key: "SNOW_CONFLUENCE_URL", value: confluenceUrl })
          if (atlassianEmail) envUpdates.push({ key: "SNOW_ATLASSIAN_EMAIL", value: atlassianEmail })
          if (atlassianApiToken) envUpdates.push({ key: "SNOW_ATLASSIAN_API_TOKEN", value: atlassianApiToken })
          if (azureOrg) envUpdates.push({ key: "SNOW_AZURE_ORG", value: azureOrg })
          if (azureProject) envUpdates.push({ key: "SNOW_AZURE_PROJECT", value: azureProject })
          if (azurePat) envUpdates.push({ key: "SNOW_AZURE_PAT", value: azurePat })
          await updateEnvFile(envUpdates)

          // Add snow-flow-enterprise MCP server to SnowCode config
          // Uses stdio proxy architecture: SnowCode → Enterprise Proxy (stdio) → Enterprise Backend (HTTPS)
          try {
            const globalSnowCodeDir = path.join(os.homedir(), ".snowcode")
            const configPath = path.join(globalSnowCodeDir, "config.json")

            // Ensure .snowcode directory exists
            await Bun.write(path.join(globalSnowCodeDir, ".keep"), "")

            // Read existing config or create new one
            const file = Bun.file(configPath)
            var config: any = {}
            if (await file.exists()) {
              const configText = await file.text()
              config = JSON.parse(configText)
            }

            // Initialize mcp section if it doesn't exist
            if (!config.mcp) config.mcp = {}

            // Find the enterprise proxy path (installed via snow-flow package)
            const enterpriseProxyPath = await findEnterpriseProxyPath()

            // Build environment variables for the proxy
            const env: Record<string, string> = {
              SNOW_LICENSE_KEY: licenseKey,
              SNOW_ENTERPRISE_URL: mcpServerUrl,
            }

            // Add Atlassian credentials if provided
            if (atlassianEmail && atlassianApiToken) {
              env.ATLASSIAN_EMAIL = atlassianEmail
              env.ATLASSIAN_API_TOKEN = atlassianApiToken
            }

            // Add Jira/Confluence hosts if provided
            if (jiraBaseUrl) {
              env.JIRA_HOST = jiraBaseUrl
            }
            if (confluenceUrl) {
              env.CONFLUENCE_HOST = confluenceUrl
            }

            // Configure stdio proxy (correct architecture!)
            config.mcp["snow-flow-enterprise"] = {
              command: enterpriseProxyPath === "npx" ? "npx" : "node",
              args: enterpriseProxyPath === "npx" ? ["snow-flow-enterprise-proxy"] : [enterpriseProxyPath],
              env,
            }

            // Write updated config
            await Bun.write(configPath, JSON.stringify(config, null, 2))
            prompts.log.info("Added snow-flow-enterprise MCP server to config")
          } catch (error: any) {
            prompts.log.warn(`Failed to add enterprise MCP server: ${error.message}`)
            prompts.log.info("You can configure it later with: snow-flow enterprise setup")
          }

          // Validate license key with enterprise server
          try {
            const validationSpinner = prompts.spinner()
            validationSpinner.start("Validating enterprise license...")

            // Validate license key (no auth token needed - license key validates itself)
            // Uses portal server (licenseServerUrl = portalUrl)
            const validation = await validateLicenseKey(licenseKey, licenseServerUrl)

            if (!validation.valid) {
              validationSpinner.stop("⚠️  License validation failed", 1)
              prompts.log.warn(`License validation failed: ${validation.error}`)
              prompts.log.info("Continuing with local configuration only")
            } else {
              validationSpinner.stop("License validated")

              // Generate JWT token for MCP authentication
              const crypto = await import("crypto")
              const machineId = crypto.createHash("sha256").update(os.hostname()).digest("hex")

              const jwtResponse = await fetch(`${licenseServerUrl}/api/auth/mcp/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  licenseKey,
                  machineId,
                  role: "developer",
                }),
              })

              if (!jwtResponse.ok) {
                const errorData: any = await jwtResponse.json().catch(() => ({ error: "Unknown error" }))
                throw new Error(`Failed to generate JWT: ${errorData.error || jwtResponse.statusText}`)
              }

              const jwtData: any = await jwtResponse.json()
              if (!jwtData.success || !jwtData.token) {
                throw new Error(`Failed to generate JWT: ${jwtData.error || "No token received"}`)
              }

              const jwtToken = jwtData.token

              // Configure enterprise MCP server with JWT token
              await addEnterpriseMcpServer({
                licenseKey: jwtToken,
                serverUrl: mcpServerUrl,
                credentials: {
                  atlassian: atlassianEmail && atlassianApiToken
                    ? { email: atlassianEmail, apiToken: atlassianApiToken }
                    : undefined,
                  jira: jiraBaseUrl
                    ? { host: jiraBaseUrl }
                    : undefined,
                  azure: azureOrg && azurePat
                    ? { organization: azureOrg, project: azureProject, pat: azurePat }
                    : undefined,
                  confluence: confluenceUrl
                    ? { host: confluenceUrl }
                    : undefined,
                },
              })

              // Update documentation with enterprise features
              // Determine which services are enabled based on provided credentials
              // Note: Jira and Confluence share Atlassian credentials, so if one is configured,
              // include documentation for both (user has the credentials to use either)
              const enabledServices: string[] = []
              const hasAtlassianCredentials = atlassianEmail && atlassianApiToken
              const hasJiraOrConfluence = jiraBaseUrl || confluenceUrl

              if (hasAtlassianCredentials && hasJiraOrConfluence) {
                // Include both Jira and Confluence docs since they share credentials
                enabledServices.push('jira')
                enabledServices.push('confluence')
              }
              if (azureOrg && azurePat) enabledServices.push('azdo')

              // For stakeholders, replace documentation with read-only version BEFORE adding enterprise features
              await replaceDocumentationForStakeholder(role)
              await updateDocumentationWithEnterprise(enabledServices)
            }
          } catch (error: any) {
            prompts.log.warn(`Enterprise setup warning: ${error.message}`)
            prompts.log.info("Local configuration saved, but enterprise validation skipped")
          }

          // Auto-sync any existing credentials to the portal
          // This ensures credentials from previous sessions are synced
          try {
            const syncResult = await PortalSync.syncToPortal(licenseKey, portalUrl)
            if (syncResult.success && syncResult.results && syncResult.results.length > 0) {
              const successCount = syncResult.results.filter(r => r.success).length
              prompts.log.info(`✅ Synced ${successCount} credential(s) to portal`)
            }
          } catch (syncError) {
            // Silently ignore sync errors - don't block the login flow
          }

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

        // Model selection step - integrated into the auth flow
        let selectedModel: string | undefined
        if (
          provider !== "other" &&
          provider !== "amazon-bedrock" &&
          provider !== "google-vertex" &&
          provider !== "servicenow" &&
          provider !== "enterprise"
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

            // For complete setup, continue to ServiceNow
            prompts.log.message("")
            prompts.log.step("ServiceNow Configuration")
            prompts.log.info("Snow-Flow requires ServiceNow connection for development")
            prompts.log.message("")

            // Run ServiceNow setup directly (handler was already passed earlier)
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

            if (prompts.isCancel(snowInstance)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            const snowAuthMethod = (await prompts.select({
              message: "Authentication method",
              options: [
                { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
                { value: "basic", label: "Basic Auth", hint: "username/password" },
              ],
            })) as string

            if (prompts.isCancel(snowAuthMethod)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            if (snowAuthMethod === "oauth") {
              const snowClientId = (await prompts.text({
                message: "OAuth Client ID",
                placeholder: "32-character hex string from ServiceNow",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Client ID is required"
                  if (value.length < 32) return "Client ID too short (expected 32+ characters)"
                },
              })) as string

              if (prompts.isCancel(snowClientId)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const snowClientSecret = (await prompts.password({
                message: "OAuth Client Secret",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Client Secret is required"
                  if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
                },
              })) as string

              if (prompts.isCancel(snowClientSecret)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              // Run full OAuth flow
              const oauth = new ServiceNowOAuth()
              const result = await oauth.authenticate({
                instance: snowInstance,
                clientId: snowClientId,
                clientSecret: snowClientSecret,
              })

              if (result.success) {
                // Write to .env file
                await updateEnvFile([
                  { key: "SNOW_INSTANCE", value: snowInstance },
                  { key: "SNOW_AUTH_METHOD", value: "oauth" },
                  { key: "SNOW_CLIENT_ID", value: snowClientId },
                  { key: "SNOW_CLIENT_SECRET", value: snowClientSecret },
                ])
                // Update SnowCode MCP configs
                await updateSnowCodeMCPConfigs(snowInstance, snowClientId, snowClientSecret)
                prompts.log.success("ServiceNow authentication successful")
                prompts.log.info("Credentials saved to .env and SnowCode configs")
              } else {
                prompts.log.error(`Authentication failed: ${result.error}`)
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

              if (prompts.isCancel(snowUsername)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const snowPassword = (await prompts.password({
                message: "ServiceNow password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(snowPassword)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

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
              // Note: Basic auth doesn't use OAuth, so we update MCP configs with instance only
              await updateSnowCodeMCPConfigs(snowInstance, "", "")

              prompts.log.success("ServiceNow credentials saved")
              prompts.log.info("Credentials saved to .env and SnowCode configs")
            }

            // After ServiceNow setup, ask about Snow-Flow License (optional)
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

            // User wants Enterprise - handle it directly
            prompts.log.message("")
            prompts.log.step("Snow-Flow License Setup")

            const enterpriseLicenseKey = (await prompts.password({
              message: "Enterprise License Key (format: SNOW-ENT-*-* or SNOW-SI-*-*)",
              validate: (value) => {
                if (!value || value.trim() === "") return "License key is required"
                if (!value.startsWith("SNOW-ENT-") && !value.startsWith("SNOW-SI-")) {
                  return "Invalid license key format (should start with SNOW-ENT- or SNOW-SI-)"
                }
              },
            })) as string

            if (prompts.isCancel(enterpriseLicenseKey)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            // Enterprise portal URL is fixed
            const enterpriseServerUrl = "https://portal.snow-flow.dev"

            // Test connection to enterprise server first
            prompts.log.message("")
            const enterpriseTestSpinner = prompts.spinner()
            enterpriseTestSpinner.start("Testing connection to enterprise server...")

            try {
              const testResponse = await fetch(`${enterpriseServerUrl}/api/health`, {
                method: "GET",
                signal: AbortSignal.timeout(5000), // 5 second timeout
              })
              enterpriseTestSpinner.stop("Connection successful!")
            } catch (testError: any) {
              enterpriseTestSpinner.stop("Connection failed", 1)
              prompts.log.warn(`Unable to reach ${enterpriseServerUrl}`)
              prompts.log.message("")

              const skipEnterpriseSetup = await prompts.confirm({
                message: "Enterprise server is not accessible. Skip enterprise setup?",
                initialValue: true,
              })

              if (prompts.isCancel(skipEnterpriseSetup) || skipEnterpriseSetup) {
                prompts.log.message("")
                prompts.log.success("✅ Authentication complete! (without enterprise features)")
                prompts.log.message("")
                prompts.log.info("Next steps:")
                prompts.log.message("")
                prompts.log.message('  • Run: snow-flow agent "<objective>" to start developing')
                prompts.log.message("  • Run: snow-flow auth list to see configured credentials")
                prompts.outro("Done")
                await Instance.dispose()
                process.exit(0)
              }

              // User wants to continue anyway - proceed with setup
              prompts.log.warn("Continuing with enterprise setup...")
            }

            // User Registration/Login Flow
            prompts.log.message("")
            prompts.log.step("User Account Setup")

            const enterpriseAccountAction = await prompts.select({
              message: "Do you want to login or register?",
              options: [
                {
                  value: "register",
                  label: "Register",
                  hint: "Create a new user account",
                },
                {
                  value: "login",
                  label: "Login",
                  hint: "Login with existing account",
                },
              ],
            })

            if (prompts.isCancel(enterpriseAccountAction)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            let enterpriseUsername: string = ""
            let enterpriseEmail: string | undefined
            let enterprisePassword: string = ""
            let enterpriseRole: "developer" | "stakeholder" | "admin" = "developer"
            let enterpriseAuthData: any

            // Generate machine ID for device binding
            const enterpriseMachineId = generateMachineId()

            if (enterpriseAccountAction === "register") {
              // New user registration with retry loop
              let enterpriseRegistrationSuccess = false

              while (!enterpriseRegistrationSuccess) {
                prompts.log.info("Creating your user account...")

                // Username validation with availability check
                let enterpriseUsernameValid = false
                while (!enterpriseUsernameValid) {
                  enterpriseUsername = (await prompts.text({
                    message: "Choose a username",
                    placeholder: "john.doe",
                    validate: (value) => {
                      if (!value || value.trim() === "") return "Username is required"
                      if (value.length < 3) return "Username must be at least 3 characters"
                    },
                  })) as string

                  if (prompts.isCancel(enterpriseUsername)) {
                    prompts.outro("Done")
                    await Instance.dispose()
                    return
                  }

                  // Check if username is available
                  try {
                    const checkResponse = await fetch(
                      `${enterpriseServerUrl}/api/user-auth/check-availability?username=${encodeURIComponent(enterpriseUsername)}&licenseKey=${encodeURIComponent(enterpriseLicenseKey)}`,
                      { method: "GET", signal: AbortSignal.timeout(10000) }
                    )

                    if (checkResponse.ok) {
                      const checkData = await checkResponse.json()
                      if (!checkData.usernameAvailable) {
                        prompts.log.error("⚠️  Username already taken")
                        prompts.log.message("")
                        continue // Ask for username again
                      }
                      enterpriseUsernameValid = true
                    } else {
                      // If check fails, proceed anyway (server might not have endpoint yet)
                      enterpriseUsernameValid = true
                    }
                  } catch (error) {
                    // Network error - proceed anyway
                    enterpriseUsernameValid = true
                  }
                }

                // Email validation with availability check
                let enterpriseEmailValid = false
                while (!enterpriseEmailValid) {
                  enterpriseEmail = (await prompts.text({
                    message: "Your email",
                    placeholder: "john.doe@company.com",
                    validate: (value) => {
                      if (!value || value.trim() === "") return "Email is required"
                      if (!value.includes("@")) return "Please enter a valid email"
                    },
                  })) as string

                  if (prompts.isCancel(enterpriseEmail)) {
                    prompts.outro("Done")
                    await Instance.dispose()
                    return
                  }

                  // Check if email is available
                  try {
                    const checkResponse = await fetch(
                      `${enterpriseServerUrl}/api/user-auth/check-availability?email=${encodeURIComponent(enterpriseEmail)}&licenseKey=${encodeURIComponent(enterpriseLicenseKey)}`,
                      { method: "GET", signal: AbortSignal.timeout(10000) }
                    )

                    if (checkResponse.ok) {
                      const checkData = await checkResponse.json()
                      if (!checkData.emailAvailable) {
                        prompts.log.error("⚠️  Email already registered")
                        prompts.log.message("")
                        continue // Ask for email again
                      }
                      enterpriseEmailValid = true
                    } else {
                      // If check fails, proceed anyway
                      enterpriseEmailValid = true
                    }
                  } catch (error) {
                    // Network error - proceed anyway
                    enterpriseEmailValid = true
                  }
                }

              enterprisePassword = (await prompts.password({
                message: "Choose a password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                  if (value.length < 8) return "Password must be at least 8 characters"
                },
              })) as string

              if (prompts.isCancel(enterprisePassword)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const enterprisePasswordConfirm = (await prompts.password({
                message: "Confirm password",
                validate: (value) => {
                  if (value !== enterprisePassword) return "Passwords do not match"
                },
              })) as string

              if (prompts.isCancel(enterprisePasswordConfirm)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const enterpriseRoleChoice = (await prompts.select({
                message: "Select your role",
                options: [
                  {
                    value: "developer",
                    label: "Developer",
                    hint: "Full MCP access + ServiceNow tools",
                  },
                  {
                    value: "stakeholder",
                    label: "Stakeholder",
                    hint: "Portal-only access for monitoring",
                  },
                ],
              })) as string

              if (prompts.isCancel(enterpriseRoleChoice)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }
              enterpriseRole = enterpriseRoleChoice as "developer" | "stakeholder" | "admin"

              // Check seat availability BEFORE registration
              prompts.log.message("")
              const entSeatCheckSpinner = prompts.spinner()
              entSeatCheckSpinner.start(`Checking ${enterpriseRole} seat availability...`)

              try {
                const entSeatCheckResponse = await fetch(
                  `${enterpriseServerUrl}/api/user-auth/check-seats?licenseKey=${encodeURIComponent(enterpriseLicenseKey)}&role=${enterpriseRole}`
                )

                const entSeatCheck = await entSeatCheckResponse.json()

                if (!entSeatCheckResponse.ok || !entSeatCheck.success) {
                  entSeatCheckSpinner.stop("Seat check failed", 1)
                  prompts.log.error(entSeatCheck.error || "Failed to check seat availability")
                  prompts.outro("Registration cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                if (!entSeatCheck.seatsAvailable) {
                  entSeatCheckSpinner.stop("No seats available", 1)
                  prompts.log.error(entSeatCheck.message || `No ${enterpriseRole} seats available`)
                  if (!entSeatCheck.unlimited && entSeatCheck.totalSeats) {
                    prompts.log.info(`Current usage: ${entSeatCheck.usedSeats}/${entSeatCheck.totalSeats} seats used`)
                  }
                  prompts.log.message("")
                  prompts.log.warn("Please contact your administrator to increase seat allocation")
                  prompts.outro("Registration cancelled")
                  await Instance.dispose()
                  process.exit(1)
                }

                entSeatCheckSpinner.stop(entSeatCheck.message || "Seats available")
                if (!entSeatCheck.unlimited && entSeatCheck.totalSeats) {
                  prompts.log.info(`Available seats: ${entSeatCheck.availableSeats}/${entSeatCheck.totalSeats}`)
                }
              } catch (error: any) {
                entSeatCheckSpinner.stop("Connection error", 1)
                prompts.log.error(`Failed to check seat availability: ${error.message}`)
                prompts.log.warn("Continuing with registration (seat check unavailable)")
              }

              prompts.log.info(`Machine ID: ${enterpriseMachineId.substring(0, 16)}...`)

              // Register with enterprise backend
              prompts.log.message("")
              const enterpriseSpinner = prompts.spinner()
              enterpriseSpinner.start("Registering user account...")

              try {
                const response = await fetch(`${enterpriseServerUrl}/api/user-auth/register`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    licenseKey: enterpriseLicenseKey,
                    username: enterpriseUsername,
                    email: enterpriseEmail,
                    password: enterprisePassword,
                    role: enterpriseRole,
                  }),
                })

                enterpriseAuthData = await response.json()

                if (!response.ok || !enterpriseAuthData.success) {
                  enterpriseSpinner.stop("Registration failed", 1)
                  prompts.log.error(enterpriseAuthData.error || "Unknown error")

                  // Check if error is due to duplicate username/email
                  if (enterpriseAuthData.error && (
                    enterpriseAuthData.error.includes("username") ||
                    enterpriseAuthData.error.includes("email") ||
                    enterpriseAuthData.error.includes("already exists")
                  )) {
                    prompts.log.message("")
                    prompts.log.warn("Please try a different username or email")
                    prompts.log.message("")
                    continue // Retry registration with different credentials
                  }

                  // Other errors - exit
                  prompts.outro("Done")
                  await Instance.dispose()
                  process.exit(1)
                }

                enterpriseSpinner.stop("Registration successful!")
                enterpriseRegistrationSuccess = true // Break out of retry loop
              } catch (error: any) {
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.log.message("")
                prompts.log.warn("Unable to connect to enterprise server")
                prompts.log.info(`URL: ${enterpriseServerUrl}/api/user-auth/register`)
                prompts.outro("Done")
                await Instance.dispose()
                process.exit(1)
              }
            } // End of while (!enterpriseRegistrationSuccess) loop
            } else {
              // Existing user login
              prompts.log.info("Logging in with existing account...")

              enterpriseUsername = (await prompts.text({
                message: "Your username",
                placeholder: "john.doe",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Username is required"
                },
              })) as string

              if (prompts.isCancel(enterpriseUsername)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              enterprisePassword = (await prompts.password({
                message: "Your password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(enterprisePassword)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              prompts.log.info(`Machine ID: ${enterpriseMachineId.substring(0, 16)}...`)

              // Login with enterprise backend
              prompts.log.message("")
              const enterpriseSpinner = prompts.spinner()
              enterpriseSpinner.start("Authenticating...")

              try {
                const response = await fetch(`${enterpriseServerUrl}/api/user-auth/login`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    licenseKey: enterpriseLicenseKey,
                    username: enterpriseUsername,
                    password: enterprisePassword,
                  }),
                })

                enterpriseAuthData = await response.json()

                if (!response.ok || !enterpriseAuthData.success) {
                  enterpriseSpinner.stop("Authentication failed", 1)
                  prompts.log.error(enterpriseAuthData.error || "Invalid username or password")
                  prompts.outro("Done")
                  await Instance.dispose()
                  process.exit(1)
                }

                enterpriseSpinner.stop("Authentication successful!")

                // Extract role and email from response
                enterpriseRole = enterpriseAuthData.user?.role || "developer"
                enterpriseEmail = enterpriseAuthData.user?.email

                // 🔐 CHECK IF PASSWORD RESET IS REQUIRED
                try {
                  const userId = enterpriseAuthData.user?.userId || crypto.createHash('sha256').update(enterpriseEmail || enterpriseUsername).digest('hex')
                  const resetCheckResponse = await fetch(`${enterpriseServerUrl}/api/user-auth/password-reset-required?userId=${userId}`, {
                    signal: AbortSignal.timeout(5000),
                  })

                  if (resetCheckResponse.ok) {
                    const resetData = await resetCheckResponse.json()

                    if (resetData.passwordResetRequired) {
                      prompts.log.message("")
                      prompts.log.warn("⚠️  Password reset required")
                      prompts.log.info("You must change your temporary password before continuing")
                      prompts.log.message("")

                      const newPassword = (await prompts.password({
                        message: "Enter your new password",
                        validate: (value) => {
                          if (!value || value.trim() === "") return "Password is required"
                          if (value.length < 8) return "Password must be at least 8 characters"
                          if (value === enterprisePassword) return "New password must be different from current password"
                        },
                      })) as string

                      if (prompts.isCancel(newPassword)) {
                        prompts.log.error("Password reset cancelled")
                        prompts.outro("Done")
                        await Instance.dispose()
                        process.exit(1)
                      }

                      const confirmPassword = (await prompts.password({
                        message: "Confirm your new password",
                        validate: (value) => {
                          if (value !== newPassword) return "Passwords do not match"
                        },
                      })) as string

                      if (prompts.isCancel(confirmPassword)) {
                        prompts.log.error("Password reset cancelled")
                        prompts.outro("Done")
                        await Instance.dispose()
                        process.exit(1)
                      }

                      // Reset password
                      prompts.log.message("")
                      const resetSpinner = prompts.spinner()
                      resetSpinner.start("Resetting password...")

                      try {
                        const resetResponse = await fetch(`${enterpriseServerUrl}/api/user-auth/reset-password`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            userId,
                            currentPassword: enterprisePassword,
                            newPassword,
                          }),
                          signal: AbortSignal.timeout(10000),
                        })

                        const resetResult = await resetResponse.json()

                        if (!resetResponse.ok || !resetResult.success) {
                          resetSpinner.stop("Password reset failed", 1)
                          prompts.log.error(resetResult.error || "Failed to reset password")
                          prompts.log.warn("Please try again or contact support")
                          prompts.outro("Done")
                          await Instance.dispose()
                          process.exit(1)
                        }

                        resetSpinner.stop("Password reset successful!")
                        prompts.log.success("✅ Your password has been updated")
                        prompts.log.info("You can now use your new password for future logins")

                        // Update password variable for storage
                        enterprisePassword = newPassword
                      } catch (resetError: any) {
                        resetSpinner.stop("Password reset failed", 1)
                        prompts.log.error(`Connection error: ${resetError.message}`)
                        prompts.log.warn("Unable to reset password. Please try again later.")
                        prompts.outro("Done")
                        await Instance.dispose()
                        process.exit(1)
                      }
                    }
                  }
                } catch (checkError) {
                  // Silently continue if password reset check fails
                  // This ensures backward compatibility if endpoint doesn't exist
                }
              } catch (error: any) {
                prompts.log.error(`Connection error: ${error.message}`)
                prompts.log.message("")
                prompts.log.warn("Unable to connect to enterprise server")
                prompts.log.info(`URL: ${enterpriseServerUrl}/api/user-auth/login`)
                prompts.outro("Done")
                await Instance.dispose()
                process.exit(1)
              }
            }

            // Update enterprise auth storage with user info and token
            const existingEnterpriseAuth = await Auth.all().then(x => x["enterprise"])
            await Auth.set("enterprise", {
              ...(existingEnterpriseAuth || {}),
              type: "enterprise",
              licenseKey: enterpriseLicenseKey,
              enterpriseUrl: enterpriseServerUrl || undefined,
              token: enterpriseAuthData.token,
              sessionToken: enterpriseAuthData.sessionToken,
              username: enterpriseUsername,
              email: enterpriseEmail,
              role: enterpriseAuthData.user?.role || enterpriseRole,
              machineId: enterpriseMachineId,
            })

            prompts.log.success(`Welcome, ${enterpriseUsername}!`)
            prompts.log.info(`Role: ${enterpriseAuthData.user?.role || enterpriseRole}`)
            if (enterpriseAuthData.customer?.company) {
              prompts.log.info(`Company: ${enterpriseAuthData.customer.company}`)
            }
            if (enterpriseAuthData.user?.activeSessions !== undefined) {
              prompts.log.info(`Active sessions: ${enterpriseAuthData.user.activeSessions} (max 1 per user)`)
            }

            // Optional integrations
            const configureJira = await prompts.confirm({
              message: "Configure optional integrations (Jira, Azure DevOps, Confluence)?",
              initialValue: false,
            })

            let enterpriseJiraBaseUrl: string | undefined
            let enterpriseAtlassianEmail: string | undefined
            let enterpriseAtlassianApiToken: string | undefined

            if (!prompts.isCancel(configureJira) && configureJira) {
              enterpriseAtlassianEmail = (await prompts.text({
                message: "Atlassian Email (for Jira/Confluence)",
                placeholder: "admin@company.com",
              })) as string

              if (!prompts.isCancel(enterpriseAtlassianEmail)) {
                enterpriseAtlassianApiToken = (await prompts.password({
                  message: "Atlassian API Token",
                })) as string

                if (!prompts.isCancel(enterpriseAtlassianApiToken)) {
                  enterpriseJiraBaseUrl = (await prompts.text({
                    message: "Jira Base URL (optional)",
                    placeholder: "https://company.atlassian.net",
                  })) as string
                }
              }
            }

            // Save Enterprise config to Auth store (preserve existing fields like token, username, etc.)
            const currentEnterpriseAuth = await Auth.get("enterprise")
            await Auth.set("enterprise", {
              ...currentEnterpriseAuth, // Preserve token, username, email, role, machineId, sessionToken
              type: "enterprise",
              licenseKey: enterpriseLicenseKey,
              enterpriseUrl: enterpriseServerUrl || undefined,
              jiraBaseUrl: enterpriseJiraBaseUrl || undefined,
              atlassianEmail: enterpriseAtlassianEmail || undefined,
              atlassianApiToken: enterpriseAtlassianApiToken || undefined,
            })

            // Write to .env file
            const envUpdates: Array<{ key: string; value: string }> = [
              { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: enterpriseLicenseKey },
            ]
            if (enterpriseServerUrl)
              envUpdates.push({ key: "SNOW_ENTERPRISE_URL", value: enterpriseServerUrl })
            if (enterpriseJiraBaseUrl)
              envUpdates.push({ key: "SNOW_JIRA_BASE_URL", value: enterpriseJiraBaseUrl })
            if (enterpriseAtlassianEmail)
              envUpdates.push({ key: "SNOW_ATLASSIAN_EMAIL", value: enterpriseAtlassianEmail })
            if (enterpriseAtlassianApiToken)
              envUpdates.push({ key: "SNOW_ATLASSIAN_API_TOKEN", value: enterpriseAtlassianApiToken })
            await updateEnvFile(envUpdates)

            // Validate license key with enterprise server
            try {
              const validationSpinner = prompts.spinner()
              validationSpinner.start("Validating enterprise license...")

              // Validate license key (no auth token needed - license key validates itself)
              // Uses portal server (enterpriseServerUrl)
              const validation = await validateLicenseKey(enterpriseLicenseKey, enterpriseServerUrl)

              if (!validation.valid) {
                validationSpinner.stop("⚠️  License validation failed", 1)
                prompts.log.warn(`License validation failed: ${validation.error}`)
                prompts.log.info("Continuing with local configuration only")
              } else {
                validationSpinner.stop("License validated")

                // Generate JWT token for MCP authentication
                const crypto = await import("crypto")
                const machineId = crypto.createHash("sha256").update(os.hostname()).digest("hex")

                const jwtResponse = await fetch(`${enterpriseServerUrl}/api/auth/mcp/login`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    licenseKey: enterpriseLicenseKey,
                    machineId,
                    role: "developer",
                  }),
                })

                if (!jwtResponse.ok) {
                  throw new Error(`Failed to generate JWT: ${jwtResponse.statusText}`)
                }

                const jwtData: any = await jwtResponse.json()
                const jwtToken = jwtData.token

                // Configure enterprise MCP server with validated credentials
                await addEnterpriseMcpServer({
                  licenseKey: jwtToken,
                  serverUrl: "https://enterprise.snow-flow.dev",
                  credentials: {
                    atlassian: enterpriseAtlassianEmail && enterpriseAtlassianApiToken
                      ? { email: enterpriseAtlassianEmail, apiToken: enterpriseAtlassianApiToken }
                      : undefined,
                    jira: enterpriseJiraBaseUrl
                      ? { host: enterpriseJiraBaseUrl }
                      : undefined,
                  },
                })

                // Update documentation with enterprise features
                // Determine which services are enabled based on provided credentials
                const enabledServices2: string[] = []
                if (enterpriseJiraBaseUrl && enterpriseAtlassianEmail && enterpriseAtlassianApiToken) enabledServices2.push('jira')
                // Note: Azure DevOps and Confluence not available in this flow

                // For stakeholders, replace documentation with read-only version BEFORE adding enterprise features
                await replaceDocumentationForStakeholder(enterpriseRole)
                await updateDocumentationWithEnterprise(enabledServices2)
              }
            } catch (error: any) {
              prompts.log.warn(`Enterprise setup warning: ${error.message}`)
              prompts.log.info("Local configuration saved, but enterprise validation skipped")
            }

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

        // For complete setup, continue to ServiceNow
        prompts.log.message("")
        prompts.log.step("ServiceNow Configuration")
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

        if (prompts.isCancel(snowInstance)) {
          prompts.outro("Done")
          await Instance.dispose()
          return
        }

        const snowAuthMethod = (await prompts.select({
          message: "Authentication method",
          options: [
            { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
            { value: "basic", label: "Basic Auth", hint: "username/password" },
          ],
        })) as string

        if (prompts.isCancel(snowAuthMethod)) {
          prompts.outro("Done")
          await Instance.dispose()
          return
        }

        if (snowAuthMethod === "oauth") {
          const snowClientId = (await prompts.text({
            message: "OAuth Client ID",
            placeholder: "32-character hex string from ServiceNow",
            validate: (value) => {
              if (!value || value.trim() === "") return "Client ID is required"
              if (value.length < 32) return "Client ID too short (expected 32+ characters)"
            },
          })) as string

          if (prompts.isCancel(snowClientId)) {
            prompts.outro("Done")
            await Instance.dispose()
            return
          }

          const snowClientSecret = (await prompts.password({
            message: "OAuth Client Secret",
            validate: (value) => {
              if (!value || value.trim() === "") return "Client Secret is required"
              if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
            },
          })) as string

          if (prompts.isCancel(snowClientSecret)) {
            prompts.outro("Done")
            await Instance.dispose()
            return
          }

          // Run full OAuth flow
          const oauth = new ServiceNowOAuth()
          const result = await oauth.authenticate({
            instance: snowInstance,
            clientId: snowClientId,
            clientSecret: snowClientSecret,
          })

          if (result.success) {
            // Write to .env file
            await updateEnvFile([
              { key: "SNOW_INSTANCE", value: snowInstance },
              { key: "SNOW_AUTH_METHOD", value: "oauth" },
              { key: "SNOW_CLIENT_ID", value: snowClientId },
              { key: "SNOW_CLIENT_SECRET", value: snowClientSecret },
            ])
            // Update SnowCode MCP configs
            await updateSnowCodeMCPConfigs(snowInstance, snowClientId, snowClientSecret)
            prompts.log.success("ServiceNow authentication successful")
            prompts.log.info("Credentials saved to .env and SnowCode configs")
          } else {
            prompts.log.error(`Authentication failed: ${result.error}`)
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

          if (prompts.isCancel(snowUsername)) {
            prompts.outro("Done")
            await Instance.dispose()
            return
          }

          const snowPassword = (await prompts.password({
            message: "ServiceNow password",
            validate: (value) => {
              if (!value || value.trim() === "") return "Password is required"
            },
          })) as string

          if (prompts.isCancel(snowPassword)) {
            prompts.outro("Done")
            await Instance.dispose()
            return
          }

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
          // Note: Basic auth doesn't use OAuth, so we update MCP configs with instance only
          await updateSnowCodeMCPConfigs(snowInstance, "", "")

          prompts.log.success("ServiceNow credentials saved")
          prompts.log.info("Credentials saved to .env and SnowCode configs")
        }

        // After ServiceNow setup, ask about Snow-Flow License (optional)
        prompts.log.message("")
        const configureEnterprise = await prompts.confirm({
          message: "Configure Snow-Flow License? (optional - enables Jira, Azure DevOps, Confluence)",
          initialValue: false,
        })

        if (!prompts.isCancel(configureEnterprise) && configureEnterprise) {
          prompts.log.message("")
          prompts.log.step("Snow-Flow License Setup")

          const licenseKey = (await prompts.password({
            message: "Enterprise License Key (format: SNOW-ENT-*-* or SNOW-SI-*-*)",
            validate: (value) => {
              if (!value || value.trim() === "") return "License key is required"
              if (!value.startsWith("SNOW-ENT-") && !value.startsWith("SNOW-SI-")) {
                return "Invalid license key format (should start with SNOW-ENT- or SNOW-SI-)"
              }
            },
          })) as string

          if (!prompts.isCancel(licenseKey)) {
            // Enterprise portal URL is fixed
            const enterpriseUrl = "https://portal.snow-flow.dev"

            // External integrations configuration
            const configureExternal = await prompts.confirm({
              message: "Configure external integrations? (optional)",
              initialValue: false,
            })

            let jiraBaseUrl, confluenceUrl, atlassianEmail, atlassianApiToken
            let azureOrg, azureProject, azurePat

            if (!prompts.isCancel(configureExternal) && configureExternal) {
              const integrations = await prompts.multiselect({
                message: "Select integrations to configure",
                options: [
                  { value: "jira", label: "Jira" },
                  { value: "azure", label: "Azure DevOps" },
                  { value: "confluence", label: "Confluence" },
                ],
              }) as string[]

              if (!prompts.isCancel(integrations)) {
                // Atlassian credentials (shared by Jira and Confluence)
                const needsAtlassian = integrations.includes("jira") || integrations.includes("confluence")
                if (needsAtlassian) {
                  atlassianEmail = (await prompts.text({
                    message: "Atlassian Email (used for both Jira and Confluence)",
                    placeholder: "admin@company.com",
                  })) as string

                  if (!prompts.isCancel(atlassianEmail)) {
                    atlassianApiToken = (await prompts.password({
                      message: "Atlassian API Token (get from https://id.atlassian.com/manage-profile/security/api-tokens)",
                    })) as string
                  }
                }

                // Jira configuration (only base URL)
                if (integrations.includes("jira") && atlassianApiToken) {
                  jiraBaseUrl = (await prompts.text({
                    message: "Jira Base URL",
                    placeholder: "https://company.atlassian.net",
                  })) as string
                }

                // Confluence configuration (only base URL)
                if (integrations.includes("confluence") && atlassianApiToken) {
                  confluenceUrl = (await prompts.text({
                    message: "Confluence Base URL",
                    placeholder: "https://company.atlassian.net/wiki",
                  })) as string
                }

                // Azure DevOps configuration
                if (integrations.includes("azure")) {
                  azureOrg = (await prompts.text({
                    message: "Azure DevOps Organization",
                    placeholder: "mycompany",
                  })) as string

                  if (!prompts.isCancel(azureOrg) && azureOrg) {
                    azureProject = (await prompts.text({
                      message: "Azure DevOps Project",
                      placeholder: "MyProject",
                    })) as string

                    if (!prompts.isCancel(azureProject)) {
                      azurePat = (await prompts.password({
                        message: "Azure Personal Access Token (PAT)",
                      })) as string
                    }
                  }
                }
              }
            }

            // Merge integration credentials with existing auth data
            const existingRegAuth = await Auth.get("enterprise")
            await Auth.set("enterprise", {
              ...existingRegAuth, // Preserve token, sessionToken, username, email, role, machineId
              type: "enterprise",
              licenseKey,
              enterpriseUrl: enterpriseUrl || undefined,
              jiraBaseUrl: jiraBaseUrl || undefined,
              confluenceUrl: confluenceUrl || undefined,
              atlassianEmail: atlassianEmail || undefined,
              atlassianApiToken: atlassianApiToken || undefined,
              azureOrg: azureOrg || undefined,
              azureProject: azureProject || undefined,
              azurePat: azurePat || undefined,
            })

            // Write to .env file
            const envUpdates: Array<{ key: string; value: string }> = [
              { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: licenseKey },
            ]
            if (enterpriseUrl) envUpdates.push({ key: "SNOW_ENTERPRISE_URL", value: enterpriseUrl })
            if (jiraBaseUrl) envUpdates.push({ key: "SNOW_JIRA_BASE_URL", value: jiraBaseUrl })
            if (confluenceUrl) envUpdates.push({ key: "SNOW_CONFLUENCE_URL", value: confluenceUrl })
            if (atlassianEmail) envUpdates.push({ key: "SNOW_ATLASSIAN_EMAIL", value: atlassianEmail })
            if (atlassianApiToken) envUpdates.push({ key: "SNOW_ATLASSIAN_API_TOKEN", value: atlassianApiToken })
            if (azureOrg) envUpdates.push({ key: "SNOW_AZURE_ORG", value: azureOrg })
            if (azureProject) envUpdates.push({ key: "SNOW_AZURE_PROJECT", value: azureProject })
            if (azurePat) envUpdates.push({ key: "SNOW_AZURE_PAT", value: azurePat })
            await updateEnvFile(envUpdates)

            // Sync credentials to enterprise backend dashboard
            if (existingRegAuth && existingRegAuth.type === "enterprise" && existingRegAuth.token) {
              try {
                const syncSpinner = prompts.spinner()
                syncSpinner.start("Syncing credentials to enterprise dashboard...")

                const credentialPromises = []

                // Sync Jira credentials
                if (jiraBaseUrl && atlassianApiToken) {
                  credentialPromises.push(
                    fetch(`https://enterprise.snow-flow.dev/mcp/auth/credentials`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        licenseKey,
                        service: "jira",
                        baseUrl: jiraBaseUrl,
                        email: atlassianEmail,
                        apiToken: atlassianApiToken
                      }),
                      signal: AbortSignal.timeout(10000)
                    })
                  )
                }

                // Sync Azure DevOps credentials
                if (azureOrg && azurePat) {
                  credentialPromises.push(
                    fetch(`https://enterprise.snow-flow.dev/mcp/auth/credentials`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        licenseKey,
                        service: "azure-devops",
                        baseUrl: `https://dev.azure.com/${azureOrg}`,
                        email: azureOrg,
                        apiToken: azurePat
                      }),
                      signal: AbortSignal.timeout(10000)
                    })
                  )
                }

                // Sync Confluence credentials
                if (confluenceUrl && atlassianApiToken) {
                  credentialPromises.push(
                    fetch(`https://enterprise.snow-flow.dev/mcp/auth/credentials`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        licenseKey,
                        service: "confluence",
                        baseUrl: confluenceUrl,
                        email: atlassianEmail,
                        apiToken: atlassianApiToken
                      }),
                      signal: AbortSignal.timeout(10000)
                    })
                  )
                }

                // Wait for all syncs to complete
                const results = await Promise.allSettled(credentialPromises)
                const failed = results.filter(r => r.status === "rejected").length

                if (failed === 0 && results.length > 0) {
                  syncSpinner.stop("✅ Credentials synced to dashboard")
                } else if (failed > 0) {
                  syncSpinner.stop("⚠️  Some credentials failed to sync", 1)
                  prompts.log.info("Credentials saved locally, but not all synced to dashboard")
                } else {
                  syncSpinner.stop()
                }
              } catch (error: any) {
                prompts.log.warn(`Failed to sync credentials: ${error.message}`)
                prompts.log.info("Credentials saved locally, but not synced to dashboard")
              }
            }

            // Validate license key with enterprise server
            try {
              const validationSpinner = prompts.spinner()
              validationSpinner.start("Validating enterprise license...")

              // Validate license key (no auth token needed - license key validates itself)
              // Uses portal server (enterpriseUrl)
              const validation = await validateLicenseKey(licenseKey, enterpriseUrl)

              if (!validation.valid) {
                validationSpinner.stop("⚠️  License validation failed", 1)
                prompts.log.warn(`License validation failed: ${validation.error}`)
                prompts.log.info("Continuing with local configuration only")
              } else {
                validationSpinner.stop("License validated")

                // Generate JWT token for MCP authentication
                const crypto = await import("crypto")
                const machineId = crypto.createHash("sha256").update(os.hostname()).digest("hex")

                const jwtResponse = await fetch(`${enterpriseUrl}/api/auth/mcp/login`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    licenseKey,
                    machineId,
                    role: "developer",
                  }),
                })

                if (!jwtResponse.ok) {
                  throw new Error(`Failed to generate JWT: ${jwtResponse.statusText}`)
                }

                const jwtData: any = await jwtResponse.json()
                const jwtToken = jwtData.token

                // Configure enterprise MCP server with validated credentials
                await addEnterpriseMcpServer({
                  licenseKey: jwtToken,
                  serverUrl: "https://enterprise.snow-flow.dev",
                  credentials: {
                    atlassian: atlassianEmail && atlassianApiToken
                      ? { email: atlassianEmail, apiToken: atlassianApiToken }
                      : undefined,
                    jira: jiraBaseUrl
                      ? { host: jiraBaseUrl }
                      : undefined,
                    azure: azureOrg && azurePat
                      ? { organization: azureOrg, project: azureProject, pat: azurePat }
                      : undefined,
                    confluence: confluenceUrl
                      ? { host: confluenceUrl }
                      : undefined,
                  },
                })

                // Update documentation with enterprise features
                // Determine which services are enabled based on provided credentials
                const enabledServices3: string[] = []
                if (jiraBaseUrl && atlassianEmail && atlassianApiToken) enabledServices3.push('jira')
                if (azureOrg && azurePat) enabledServices3.push('azdo')
                if (confluenceUrl && atlassianEmail && atlassianApiToken) enabledServices3.push('confluence')

                // For stakeholders, replace documentation with read-only version BEFORE adding enterprise features
                // Use role from JWT data if available, otherwise default to "developer"
                const userRole = jwtData?.role || "developer"
                await replaceDocumentationForStakeholder(userRole)
                await updateDocumentationWithEnterprise(enabledServices3)
              }
            } catch (error: any) {
              prompts.log.warn(`Enterprise setup warning: ${error.message}`)
              prompts.log.info("Local configuration saved, but enterprise validation skipped")
            }

            // Show completion and exit
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
