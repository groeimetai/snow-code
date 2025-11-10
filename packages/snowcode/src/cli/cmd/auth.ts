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
import { runProviderFlow, runServiceNowFlow, runEnterpriseFlow } from "./auth-flows"

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
  const projectSnowCodeDir = path.join(process.cwd(), ".snowcode")
  const globalSnowCodeDir = path.join(os.homedir(), ".snowcode")
  const globalConfigDir = path.join(os.homedir(), ".config", "snowcode")

  // Ensure instance is a full URL
  const instanceUrl = instance.startsWith("http") ? instance : `https://${instance}`

  // Update both project-level and global configs (all possible locations)
  const configPaths = [
    // Project-level (created by snow-flow init)
    path.join(projectSnowCodeDir, "opencode.json"),
    path.join(projectSnowCodeDir, "config.json"),
    // Global SnowCode dirs
    path.join(globalSnowCodeDir, "opencode.json"),
    path.join(globalSnowCodeDir, "snowcode.json"),
    path.join(globalSnowCodeDir, "config.json"),
    // Global OpenCode standard location (~/.config/snowcode/)
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

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthProviderCommand)
      .command(AuthServiceNowCommand)
      .command(AuthEnterpriseCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
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

/**
 * Provider authentication command
 * Handles LLM provider selection and authentication (Claude, GPT, Gemini, etc.)
 */
export const AuthProviderCommand = cmd({
  command: "provider",
  describe: "configure LLM provider (Claude, GPT, Gemini, etc.)",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Configure LLM Provider")

        const result = await runProviderFlow()

        if (result.success) {
          prompts.log.message("")
          prompts.log.success("✅ Provider configured successfully")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("  • Run: snow-code auth servicenow - Configure ServiceNow")
          prompts.log.message("  • Run: snow-code auth enterprise - Configure Enterprise (optional)")
          prompts.log.message('  • Run: snow-flow swarm "<objective>" - Start developing')
          prompts.outro("Done")
        } else {
          prompts.log.error("Provider configuration failed")
          prompts.outro("Done")
        }

        await Instance.dispose()
        process.exit(result.success ? 0 : 1)
      },
    })
  },
})

/**
 * ServiceNow authentication command
 * Handles ServiceNow instance OAuth or basic authentication
 */
export const AuthServiceNowCommand = cmd({
  command: "servicenow",
  describe: "configure ServiceNow instance OAuth credentials",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Configure ServiceNow")

        const result = await runServiceNowFlow()

        if (result.success) {
          prompts.log.message("")
          prompts.log.success("✅ ServiceNow configured successfully")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message("  • Run: snow-code auth enterprise - Configure Enterprise (optional)")
          prompts.log.message('  • Run: snow-flow swarm "<objective>" - Start developing')
          prompts.outro("Done")
        } else {
          prompts.log.error("ServiceNow configuration failed")
          prompts.outro("Done")
        }

        await Instance.dispose()
        process.exit(result.success ? 0 : 1)
      },
    })
  },
})

/**
 * Enterprise authentication command
 * Handles Snow-Flow Enterprise license, user registration/login, and integrations
 */
export const AuthEnterpriseCommand = cmd({
  command: "enterprise",
  describe: "configure Snow-Flow Enterprise license (Jira, Azure DevOps, Confluence)",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Configure Snow-Flow Enterprise")

        const result = await runEnterpriseFlow()

        if (result.success) {
          prompts.log.message("")
          prompts.log.success("✅ Enterprise configured successfully")
          prompts.log.message("")
          prompts.log.info("Next steps:")
          prompts.log.message('  • Run: snow-flow swarm "<objective>" - Start developing with enterprise tools')
          prompts.log.message("  • Run: snow-flow portal - Open enterprise portal")
          prompts.outro("Done")
        } else {
          prompts.log.error("Enterprise configuration failed")
          prompts.outro("Done")
        }

        await Instance.dispose()
        process.exit(result.success ? 0 : 1)
      },
    })
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "complete authentication: Provider + ServiceNow + Enterprise",
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
        prompts.intro("Complete Authentication Flow")

        // Handle wellknown OAuth provider (e.g., GitHub OAuth)
        if (args.url) {
          try {
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
          } catch (error: any) {
            prompts.log.error(`Failed to authenticate with ${args.url}: ${error.message}`)
            prompts.outro("Done")
            await Instance.dispose()
            process.exit(1)
          }
        }

        // Standard flow: Provider → ServiceNow → Enterprise (optional)
        prompts.log.message("")
        prompts.log.info("This will configure:")
        prompts.log.message("  1️⃣  LLM Provider (Claude, GPT, Gemini, etc.)")
        prompts.log.message("  2️⃣  ServiceNow Instance OAuth")
        prompts.log.message("  3️⃣  Snow-Flow Enterprise (optional)")
        prompts.log.message("")

        // Step 1: Provider Authentication
        prompts.log.step("Step 1: LLM Provider")
        const providerResult = await runProviderFlow()

        if (!providerResult.success) {
          prompts.log.error("Provider configuration failed")
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(1)
        }

        // Step 2: ServiceNow Authentication
        prompts.log.message("")
        prompts.log.step("Step 2: ServiceNow Configuration")
        prompts.log.info("Snow-Flow requires ServiceNow connection for development")
        prompts.log.message("")

        const servicenowResult = await runServiceNowFlow()

        if (!servicenowResult.success) {
          prompts.log.error("ServiceNow configuration failed")
          prompts.outro("Done")
          await Instance.dispose()
          process.exit(1)
        }

        // Step 3: Enterprise (Optional)
        prompts.log.message("")
        const configureEnterprise = await prompts.confirm({
          message: "Configure Snow-Flow Enterprise? (optional)",
          initialValue: false,
        })

        if (!prompts.isCancel(configureEnterprise) && configureEnterprise) {
          prompts.log.message("")
          prompts.log.step("Step 3: Snow-Flow Enterprise")
          const enterpriseResult = await runEnterpriseFlow()

          if (!enterpriseResult.success) {
            prompts.log.warn("Enterprise configuration failed - continuing without enterprise features")
          }
        }

        // All done!
        prompts.log.message("")
        prompts.log.success("✅ Authentication complete!")
        prompts.log.message("")
        prompts.log.info("Next steps:")
        prompts.log.message("")
        prompts.log.message('  • Run: snow-flow swarm "<objective>" to start developing')
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
