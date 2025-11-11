/**
 * Authentication flow functions for Snow-Flow
 * Extracted from auth.ts for better modularity and reusability
 */

import { Auth } from "../../auth"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import crypto from "crypto"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { ServiceNowOAuth } from "../../auth/servicenow-oauth"

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

/**
 * Provider authentication flow
 * Handles LLM provider selection and authentication (Claude, GPT, etc.)
 * @returns Selected provider ID and model (if applicable)
 */
export async function runProviderFlow(): Promise<{
  provider: string
  selectedModel?: string
  success: boolean
}> {
  try {
    await ModelsDev.refresh().catch(() => {})
    const providers = await ModelsDev.get()
    const priority: Record<string, number> = {
      anthropic: 0,
      "github-copilot": 1,
      openai: 2,
      google: 3,
      openrouter: 4,
      vercel: 5,
      opencode: 99,
    }

    let provider = await prompts.autocomplete({
      message: "Select provider",
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

    if (prompts.isCancel(provider)) {
      return { provider: "", success: false }
    }

    // Handle special providers that skip normal flow
    if (provider === "servicenow" || provider === "enterprise") {
      // These are handled by their own flows
      return { provider: provider as string, success: true }
    }

    // Model selection step - integrated into the auth flow
    let selectedModel: string | undefined
    if (
      provider !== "other" &&
      provider !== "amazon-bedrock" &&
      provider !== "google-vertex"
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
        if (prompts.isCancel(method)) {
          return { provider: "", success: false }
        }
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
            return { provider: "", success: false }
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
          if (prompts.isCancel(code)) {
            return { provider: "", success: false }
          }
          const result = await authorize.callback(code)
          if (result.type === "failed") {
            prompts.log.error("Failed to authorize")
            return { provider: "", success: false }
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
            const globalConfigPath = path.join(os.homedir(), ".config", "snowcode", "config.json")
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

        return { provider: provider as string, selectedModel, success: true }
      }
    }

    if (provider === "other") {
      provider = await prompts.text({
        message: "Enter provider id",
        validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
      })
      if (prompts.isCancel(provider)) {
        return { provider: "", success: false }
      }
      provider = provider.replace(/^@ai-sdk\//, "")
      prompts.log.warn(
        `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
      )
    }

    if (provider === "amazon-bedrock") {
      prompts.log.info(
        "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
      )
      return { provider: provider as string, success: true }
    }

    if (provider === "google-vertex") {
      prompts.log.info(
        "Google Cloud Vertex AI uses Application Default Credentials. Set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'. Optionally set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (or VERTEX_LOCATION)",
      )
      return { provider: provider as string, success: true }
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
    if (prompts.isCancel(key)) {
      return { provider: "", success: false }
    }
    await Auth.set(provider, {
      type: "api",
      key,
    })

    // Save selected model to global config if chosen
    if (selectedModel) {
      try {
        const globalConfigPath = path.join(os.homedir(), ".config", "snowcode", "config.json")
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

    return { provider: provider as string, selectedModel, success: true }
  } catch (error) {
    prompts.log.error(`Provider authentication failed: ${error}`)
    return { provider: "", success: false }
  }
}

/**
 * ServiceNow authentication flow
 * Handles ServiceNow instance OAuth or basic authentication
 * @returns Success status
 */
export async function runServiceNowFlow(): Promise<{ success: boolean }> {
  try {
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

    if (prompts.isCancel(instance)) {
      return { success: false }
    }

    const authMethod = (await prompts.select({
      message: "Authentication method",
      options: [
        { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
        { value: "basic", label: "Basic Auth", hint: "username/password" },
      ],
    })) as string

    if (prompts.isCancel(authMethod)) {
      return { success: false }
    }

    if (authMethod === "oauth") {
      const clientId = (await prompts.text({
        message: "OAuth Client ID",
        placeholder: "32-character hex string from ServiceNow",
        validate: (value) => {
          if (!value || value.trim() === "") return "Client ID is required"
          if (value.length < 32) return "Client ID too short (expected 32+ characters)"
        },
      })) as string

      if (prompts.isCancel(clientId)) {
        return { success: false }
      }

      const clientSecret = (await prompts.password({
        message: "OAuth Client Secret",
        validate: (value) => {
          if (!value || value.trim() === "") return "Client Secret is required"
          if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
        },
      })) as string

      if (prompts.isCancel(clientSecret)) {
        return { success: false }
      }

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
        return { success: true }
      } else {
        prompts.log.error(`Authentication failed: ${result.error}`)
        return { success: false }
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

      if (prompts.isCancel(username)) {
        return { success: false }
      }

      const password = (await prompts.password({
        message: "ServiceNow password",
        validate: (value) => {
          if (!value || value.trim() === "") return "Password is required"
        },
      })) as string

      if (prompts.isCancel(password)) {
        return { success: false }
      }

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
      return { success: true }
    }
  } catch (error) {
    prompts.log.error(`ServiceNow authentication failed: ${error}`)
    return { success: false }
  }
}

/**
 * Enterprise authentication flow
 * Handles Snow-Flow Enterprise license, user registration/login, and integrations
 * @returns Success status
 */
export async function runEnterpriseFlow(): Promise<{ success: boolean }> {
  try {
    prompts.log.step("Snow-Flow Enterprise Setup")

    let licenseKey = (await prompts.password({
      message: "Enterprise License Key (format: SNOW-ENT-*-* or SNOW-SI-*-*)",
      validate: (value) => {
        if (!value || value.trim() === "") return "License key is required"
        const trimmed = value.trim()
        if (!trimmed.startsWith("SNOW-ENT-") && !trimmed.startsWith("SNOW-SI-")) {
          return "Invalid license key format (should start with SNOW-ENT- or SNOW-SI-)"
        }
      },
    })) as string

    if (prompts.isCancel(licenseKey)) {
      return { success: false }
    }

    // Trim whitespace from license key
    licenseKey = licenseKey.trim()

    const enterpriseUrl = (await prompts.text({
      message: "Enterprise License Server URL (optional)",
      placeholder: "https://portal.snow-flow.dev",
      initialValue: "https://portal.snow-flow.dev",
      validate: (value) => {
        if (!value || value.trim() === "") return "URL is required"
        try {
          new URL(value)
        } catch {
          return "Invalid URL format (must include https://)"
        }
      },
    })) as string

    if (prompts.isCancel(enterpriseUrl)) {
      return { success: false }
    }

    // ✅ VALIDATE LICENSE KEY IMMEDIATELY (before user account setup)
    prompts.log.message("")
    const licenseSpinner = prompts.spinner()
    licenseSpinner.start("Validating license key...")

    try {
      const licenseResponse = await fetch(`${enterpriseUrl}/api/license/validate`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${licenseKey}`,
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })

      const licenseData = await licenseResponse.json()

      // Check ONLY HTTP status (like old method) - portal backend doesn't return 'success' field
      if (!licenseResponse.ok) {
        licenseSpinner.stop("License key validation failed", 1)
        prompts.log.error(licenseData.error || "Invalid license key")
        prompts.log.message("")
        prompts.log.warn("Please check your license key and try again")
        prompts.log.info("License key format: SNOW-ENT-*-* or SNOW-SI-*-*")
        return { success: false }
      }

      licenseSpinner.stop("License key valid!")

      // Show license details if available
      if (licenseData.license) {
        prompts.log.message("")
        prompts.log.success(`License: ${licenseData.license.type || 'Enterprise'}`)
        if (licenseData.license.company) {
          prompts.log.info(`Company: ${licenseData.license.company}`)
        }
        if (licenseData.license.expiresAt) {
          const expiryDate = new Date(licenseData.license.expiresAt)
          prompts.log.info(`Expires: ${expiryDate.toLocaleDateString()}`)
        }
      }
    } catch (licenseError: any) {
      licenseSpinner.stop("License validation failed", 1)
      prompts.log.error(`Connection error: ${licenseError.message}`)
      prompts.log.message("")
      prompts.log.warn("Unable to validate license key with enterprise server")
      prompts.log.info(`URL: ${enterpriseUrl}/api/license/validate`)

      const continueAnyway = await prompts.confirm({
        message: "Continue anyway? (License will be validated during registration)",
        initialValue: false,
      })

      if (prompts.isCancel(continueAnyway) || !continueAnyway) {
        return { success: false }
      }

      prompts.log.warn("Continuing without license validation...")
    }

    // Test connection to enterprise server first
    prompts.log.message("")
    const testSpinner = prompts.spinner()
    testSpinner.start("Testing connection to enterprise server...")

    try {
      const testResponse = await fetch(`${enterpriseUrl}/api/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      })
      testSpinner.stop("Connection successful!")
    } catch (testError: any) {
      testSpinner.stop("Connection failed", 1)
      prompts.log.warn(`Unable to reach ${enterpriseUrl}`)
      prompts.log.message("")

      const skipEnterprise = await prompts.confirm({
        message: "Enterprise server is not accessible. Skip enterprise setup?",
        initialValue: true,
      })

      if (prompts.isCancel(skipEnterprise) || skipEnterprise) {
        return { success: false }
      }

      // User wants to continue anyway - proceed with setup
      prompts.log.warn("Continuing with enterprise setup...")
    }

    // User Registration/Login Flow
    prompts.log.message("")
    prompts.log.step("User Account Setup")

    const accountAction = await prompts.select({
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

    if (prompts.isCancel(accountAction)) {
      return { success: false }
    }

    let username: string
    let email: string | undefined
    let password: string
    let role: "developer" | "stakeholder" | "admin"
    let authData: any

    // Generate machine ID for device binding
    const machineId = generateMachineId()

    if (accountAction === "register") {
      // New user registration
      prompts.log.info("Creating your user account...")

      username = (await prompts.text({
        message: "Choose a username",
        placeholder: "john.doe",
        validate: (value) => {
          if (!value || value.trim() === "") return "Username is required"
          if (value.length < 3) return "Username must be at least 3 characters"
        },
      })) as string

      if (prompts.isCancel(username)) {
        return { success: false }
      }

      email = (await prompts.text({
        message: "Your email",
        placeholder: "john.doe@company.com",
        validate: (value) => {
          if (!value || value.trim() === "") return "Email is required"
          if (!value.includes("@")) return "Please enter a valid email"
        },
      })) as string

      if (prompts.isCancel(email)) {
        return { success: false }
      }

      password = (await prompts.password({
        message: "Choose a password",
        validate: (value) => {
          if (!value || value.trim() === "") return "Password is required"
          if (value.length < 8) return "Password must be at least 8 characters"
        },
      })) as string

      if (prompts.isCancel(password)) {
        return { success: false }
      }

      const passwordConfirm = (await prompts.password({
        message: "Confirm password",
        validate: (value) => {
          if (value !== password) return "Passwords do not match"
        },
      })) as string

      if (prompts.isCancel(passwordConfirm)) {
        return { success: false }
      }

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

      if (prompts.isCancel(roleChoice)) {
        return { success: false }
      }
      role = roleChoice as "developer" | "stakeholder" | "admin"

      prompts.log.info(`Machine ID: ${machineId.substring(0, 16)}...`)

      // Register with enterprise backend
      prompts.log.message("")
      const spinner = prompts.spinner()
      spinner.start("Registering user account...")

      try {
        const response = await fetch(`${enterpriseUrl}/api/user-auth/register`, {
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
          return { success: false }
        }

        spinner.stop("Registration successful!")
      } catch (error: any) {
        prompts.log.error(`Connection error: ${error.message}`)
        prompts.log.message("")
        prompts.log.warn("Unable to connect to enterprise server")
        prompts.log.info(`URL: ${enterpriseUrl}/api/user-auth/register`)
        return { success: false }
      }
    } else {
      // Existing user login
      prompts.log.info("Logging in with existing account...")

      username = (await prompts.text({
        message: "Your username",
        placeholder: "john.doe",
        validate: (value) => {
          if (!value || value.trim() === "") return "Username is required"
        },
      })) as string

      if (prompts.isCancel(username)) {
        return { success: false }
      }

      password = (await prompts.password({
        message: "Your password",
        validate: (value) => {
          if (!value || value.trim() === "") return "Password is required"
        },
      })) as string

      if (prompts.isCancel(password)) {
        return { success: false }
      }

      prompts.log.info(`Machine ID: ${machineId.substring(0, 16)}...`)

      // Login with enterprise backend
      prompts.log.message("")
      const spinner = prompts.spinner()
      spinner.start("Authenticating...")

      try {
        const response = await fetch(`${enterpriseUrl}/api/user-auth/login`, {
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
          return { success: false }
        }

        spinner.stop("Authentication successful!")

        // Extract role and email from response
        role = authData.user?.role || "developer"
        email = authData.user?.email
      } catch (error: any) {
        prompts.log.error(`Connection error: ${error.message}`)
        prompts.log.message("")
        prompts.log.warn("Unable to connect to enterprise server")
        prompts.log.info(`URL: ${enterpriseUrl}/api/user-auth/login`)
        return { success: false }
      }
    }

    // Store enterprise auth with user info
    await Auth.set("enterprise", {
      type: "enterprise",
      licenseKey,
      enterpriseUrl: enterpriseUrl || undefined,
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

    // Optional integrations
    const configureIntegrations = await prompts.confirm({
      message: "Configure optional integrations (Jira, Azure DevOps)?",
      initialValue: false,
    })

    let jiraBaseUrl: string | undefined
    let jiraEmail: string | undefined
    let jiraApiToken: string | undefined

    if (!prompts.isCancel(configureIntegrations) && configureIntegrations) {
      jiraBaseUrl = (await prompts.text({
        message: "Jira Base URL (optional)",
        placeholder: "https://company.atlassian.net",
      })) as string

      if (!prompts.isCancel(jiraBaseUrl) && jiraBaseUrl) {
        jiraEmail = (await prompts.text({
          message: "Jira Email",
          placeholder: "admin@company.com",
        })) as string

        if (!prompts.isCancel(jiraEmail)) {
          jiraApiToken = (await prompts.password({
            message: "Jira API Token",
          })) as string
        }
      }
    }

    // Save to Auth store
    await Auth.set("enterprise", {
      type: "enterprise",
      licenseKey,
      enterpriseUrl: enterpriseUrl || undefined,
      jiraBaseUrl: jiraBaseUrl || undefined,
      jiraEmail: jiraEmail || undefined,
      jiraApiToken: jiraApiToken || undefined,
    })

    // Write to .env file
    const envUpdates: Array<{ key: string; value: string }> = [
      { key: "SNOW_ENTERPRISE_LICENSE_KEY", value: licenseKey },
    ]
    if (enterpriseUrl) envUpdates.push({ key: "SNOW_ENTERPRISE_URL", value: enterpriseUrl })
    if (jiraBaseUrl) envUpdates.push({ key: "SNOW_JIRA_BASE_URL", value: jiraBaseUrl })
    if (jiraEmail) envUpdates.push({ key: "SNOW_JIRA_EMAIL", value: jiraEmail })
    if (jiraApiToken) envUpdates.push({ key: "SNOW_JIRA_API_TOKEN", value: jiraApiToken })
    await updateEnvFile(envUpdates)

    // Add snow-flow-enterprise MCP server to SnowCode config
    const globalSnowCodeDir = path.join(os.homedir(), ".snowcode")
    const configPath = path.join(globalSnowCodeDir, "snowcode.json")
    try {
      const file = Bun.file(configPath)
      if (await file.exists()) {
        const configText = await file.text()
        const config = JSON.parse(configText)
        if (!config.mcp) config.mcp = {}
        config.mcp["snow-flow-enterprise"] = {
          type: "remote",
          url: "https://enterprise.snow-flow.dev/mcp/sse",
          headers: { Authorization: `Bearer ${licenseKey}` },
          enabled: true,
        }
        await Bun.write(configPath, JSON.stringify(config, null, 2))
        prompts.log.info("Added snow-flow-enterprise MCP server to config")
      }
    } catch (error: any) {
      // Silently skip enterprise MCP configuration errors
    }

    prompts.log.message("")
    prompts.log.success("Enterprise configuration saved")
    prompts.log.info("Credentials saved to .env file")

    return { success: true }
  } catch (error) {
    prompts.log.error(`Enterprise authentication failed: ${error}`)
    return { success: false }
  }
}
