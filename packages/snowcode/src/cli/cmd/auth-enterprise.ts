/**
 * Snow-Code Enterprise Authentication via Device Authorization Flow
 *
 * Simplified browser-based authentication for enterprise users.
 * No password, no license key input - just approve in browser and paste code.
 */

import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import os from "os"
import path from "path"
import fs from "fs"
import open from "open"
import { UI } from "../ui"

// Enterprise portal URL
const PORTAL_URL = process.env.SNOW_FLOW_PORTAL_URL || "https://portal.snow-flow.dev"
const API_URL = process.env.SNOW_FLOW_API_URL || "https://portal.snow-flow.dev"

// Config directory
const CONFIG_DIR = path.join(os.homedir(), ".snow-code")
const ENTERPRISE_CONFIG_FILE = path.join(CONFIG_DIR, "enterprise.json")

interface ServiceNowInstanceConfig {
  id: number
  instanceName: string
  instanceUrl: string
  environmentType: string
  clientId: string
  clientSecret: string
  isDefault: boolean
  enabled: boolean
}

interface EnterpriseConfig {
  token: string
  customerId: number
  customerName: string
  company: string
  licenseKey: string
  credentials: {
    jira?: {
      baseUrl: string
      email: string
      apiToken: string
      enabled: boolean
    }
    "azure-devops"?: {
      baseUrl: string
      username?: string
      apiToken: string
      enabled: boolean
    }
    confluence?: {
      baseUrl: string
      email: string
      apiToken: string
      enabled: boolean
    }
  }
  servicenowInstances?: ServiceNowInstanceConfig[]
  mcpServerUrl: string
  lastSynced: number
}

/**
 * Read enterprise config from disk
 */
function readEnterpriseConfig(): EnterpriseConfig | null {
  try {
    if (!fs.existsSync(ENTERPRISE_CONFIG_FILE)) {
      return null
    }
    const data = fs.readFileSync(ENTERPRISE_CONFIG_FILE, "utf-8")
    return JSON.parse(data)
  } catch (error) {
    console.error("Failed to read enterprise config:", error)
    return null
  }
}

/**
 * Save enterprise config to disk
 */
function saveEnterpriseConfig(config: EnterpriseConfig): void {
  try {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(ENTERPRISE_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8")
  } catch (error) {
    console.error("Failed to save enterprise config:", error)
    throw error
  }
}

/**
 * Get machine info for device authorization
 */
function getMachineInfo(): string {
  const hostname = os.hostname()
  const platform = os.platform()
  const username = os.userInfo().username
  return `${username}@${hostname} (${platform})`
}

/**
 * Enterprise Login Command
 * Uses device authorization flow with browser-based approval
 */
export const AuthEnterpriseLoginCommand = cmd({
  command: "enterprise-login",
  describe: "Authenticate with Snow-Flow Enterprise using browser",
  async handler() {
    prompts.log.info("")
    prompts.log.info("🚀 Snow-Flow Enterprise Authentication")
    prompts.log.info("")

    try {
      // Step 1: Request device authorization session
      prompts.log.step("Requesting device authorization...")

      const machineInfo = getMachineInfo()
      const requestResponse = await fetch(`${API_URL}/api/auth/device/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineInfo })
      })

      if (!requestResponse.ok) {
        const error = await requestResponse.json()
        throw new Error(error.error || "Failed to request device authorization")
      }

      const { sessionId, verificationUrl, expiresIn } = await requestResponse.json()

      // Step 2: Open browser for user approval
      prompts.log.info("")
      prompts.log.success("✓ Device authorization session created")
      prompts.log.info("")
      prompts.log.info("🌐 Opening browser for authorization...")
      prompts.log.info("")
      prompts.log.info(`   If browser doesn't open automatically, visit:`)
      prompts.log.info(`   ${verificationUrl}`)
      prompts.log.info("")

      // Open browser
      try {
        await open(verificationUrl)
      } catch (openError) {
        prompts.log.warn("   ⚠️  Could not open browser automatically")
      }

      // Step 3: Wait for user to approve and paste code
      prompts.log.info("📋 After approving in the browser, you'll receive a code.")
      prompts.log.info("   Please paste it below:")
      prompts.log.info("")

      const authCodeResponse = await prompts.text({
        message: "Enter authorization code:",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Authorization code is required"
          }
          return undefined
        }
      })

      if (prompts.isCancel(authCodeResponse)) {
        prompts.log.info("")
        prompts.log.warn("⚠️  Authorization cancelled")
        process.exit(0)
      }

      const authCode = (authCodeResponse as string).trim()

      // Step 4: Verify code and get token
      prompts.log.step("Verifying authorization code...")

      const verifyResponse = await fetch(`${API_URL}/api/auth/device/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, authCode })
      })

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json()
        throw new Error(error.error || "Failed to verify authorization code")
      }

      const { token, customer } = await verifyResponse.json()

      prompts.log.success("✓ Authorization verified!")
      prompts.log.info("")

      // Step 5: Fetch enterprise credentials
      prompts.log.step("Syncing enterprise credentials...")

      const credentialsResponse = await fetch(`${API_URL}/api/auth/enterprise/credentials`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` }
      })

      if (!credentialsResponse.ok) {
        const error = await credentialsResponse.json()
        throw new Error(error.error || "Failed to fetch enterprise credentials")
      }

      const { credentials, servicenowInstances, mcpServerUrl } = await credentialsResponse.json()

      // Step 6: Save configuration
      const enterpriseConfig: EnterpriseConfig = {
        token,
        customerId: customer.id,
        customerName: customer.name,
        company: customer.company,
        licenseKey: customer.licenseKey,
        credentials,
        servicenowInstances: servicenowInstances || [],
        mcpServerUrl,
        lastSynced: Date.now()
      }

      saveEnterpriseConfig(enterpriseConfig)

      prompts.log.success("✓ Enterprise credentials synced!")
      prompts.log.info("")

      // Step 7: Show summary
      prompts.log.info("")
      prompts.log.info(UI.logoEnterprise("Authenticated"))
      prompts.log.info("")
      prompts.log.info(`   Customer: ${customer.name}`)
      prompts.log.info(`   Company:  ${customer.company}`)
      prompts.log.info("")
      prompts.log.info("   Available Tools:")

      if (credentials.jira?.enabled) {
        prompts.log.info(`   ✓ Jira (${credentials.jira.baseUrl})`)
      }
      if (credentials["azure-devops"]?.enabled) {
        prompts.log.info(`   ✓ Azure DevOps (${credentials["azure-devops"].baseUrl})`)
      }
      if (credentials.confluence?.enabled) {
        prompts.log.info(`   ✓ Confluence (${credentials.confluence.baseUrl})`)
      }

      // Show ServiceNow instances
      if (servicenowInstances && servicenowInstances.length > 0) {
        prompts.log.info("")
        prompts.log.info("   ServiceNow Instances:")
        for (const inst of servicenowInstances) {
          const defaultTag = inst.isDefault ? " (default)" : ""
          prompts.log.info(`   ✓ ${inst.instanceName} [${inst.environmentType}]${defaultTag}`)
          prompts.log.info(`     ${inst.instanceUrl}`)
        }
      }

      prompts.log.info("")
      prompts.log.info(`   MCP Server: ${mcpServerUrl}`)
      prompts.log.info("")
      prompts.log.info("   Next: Run 'snow-code init' to configure Claude Code")
      prompts.log.info("")

    } catch (error: any) {
      prompts.log.error("")
      prompts.log.error(`❌ Authentication failed: ${error.message}`)
      prompts.log.error("")
      process.exit(1)
    }
  }
})

/**
 * Enterprise Sync Command
 * Re-fetches credentials from portal (if they were updated)
 */
export const AuthEnterpriseSyncCommand = cmd({
  command: "enterprise-sync",
  describe: "Re-sync enterprise credentials from portal",
  async handler() {
    prompts.log.info("")
    prompts.log.info("🔄 Snow-Flow Enterprise Credential Sync")
    prompts.log.info("")

    try {
      // Read existing config
      const existingConfig = readEnterpriseConfig()
      if (!existingConfig) {
        prompts.log.error("❌ No enterprise configuration found")
        prompts.log.info("")
        prompts.log.info("   Run 'snow-code auth enterprise-login' first")
        prompts.log.info("")
        process.exit(1)
      }

      // Fetch fresh credentials
      prompts.log.step("Fetching latest credentials...")

      const credentialsResponse = await fetch(`${API_URL}/api/auth/enterprise/credentials`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${existingConfig.token}` }
      })

      if (!credentialsResponse.ok) {
        const error = await credentialsResponse.json()

        // If unauthorized, token might be expired
        if (credentialsResponse.status === 401) {
          prompts.log.error("❌ Authentication token expired")
          prompts.log.info("")
          prompts.log.info("   Run 'snow-code auth enterprise-login' to re-authenticate")
          prompts.log.info("")
          process.exit(1)
        }

        throw new Error(error.error || "Failed to fetch enterprise credentials")
      }

      const { credentials, servicenowInstances, mcpServerUrl } = await credentialsResponse.json()

      // Update config
      const updatedConfig: EnterpriseConfig = {
        ...existingConfig,
        credentials,
        servicenowInstances: servicenowInstances || [],
        mcpServerUrl,
        lastSynced: Date.now()
      }

      saveEnterpriseConfig(updatedConfig)

      prompts.log.success("✓ Credentials synced successfully!")
      prompts.log.info("")

      // Show updated credentials
      prompts.log.info("   Updated Credentials:")

      if (credentials.jira?.enabled) {
        prompts.log.info(`   ✓ Jira (${credentials.jira.baseUrl})`)
      } else {
        prompts.log.info(`   ✗ Jira (not configured)`)
      }

      if (credentials["azure-devops"]?.enabled) {
        prompts.log.info(`   ✓ Azure DevOps (${credentials["azure-devops"].baseUrl})`)
      } else {
        prompts.log.info(`   ✗ Azure DevOps (not configured)`)
      }

      if (credentials.confluence?.enabled) {
        prompts.log.info(`   ✓ Confluence (${credentials.confluence.baseUrl})`)
      } else {
        prompts.log.info(`   ✗ Confluence (not configured)`)
      }

      // Show ServiceNow instances
      if (servicenowInstances && servicenowInstances.length > 0) {
        prompts.log.info("")
        prompts.log.info("   ServiceNow Instances:")
        for (const inst of servicenowInstances) {
          const defaultTag = inst.isDefault ? " (default)" : ""
          prompts.log.info(`   ✓ ${inst.instanceName} [${inst.environmentType}]${defaultTag}`)
        }
      } else {
        prompts.log.info(`   ✗ ServiceNow (no instances configured)`)
      }

      prompts.log.info("")

    } catch (error: any) {
      prompts.log.error("")
      prompts.log.error(`❌ Sync failed: ${error.message}`)
      prompts.log.error("")
      process.exit(1)
    }
  }
})

/**
 * Enterprise Status Command
 * Show current enterprise authentication status
 */
export const AuthEnterpriseStatusCommand = cmd({
  command: "enterprise-status",
  describe: "Show enterprise authentication status",
  async handler() {
    prompts.log.info("")
    prompts.log.info("📊 Snow-Flow Enterprise Status")
    prompts.log.info("")

    const config = readEnterpriseConfig()

    if (!config) {
      prompts.log.warn("⚠️  Not authenticated with Snow-Flow Enterprise")
      prompts.log.info("")
      prompts.log.info("   Run 'snow-code auth enterprise-login' to get started")
      prompts.log.info("")
      return
    }

    // Show status
    prompts.log.info(`   Customer: ${config.customerName}`)
    prompts.log.info(`   Company:  ${config.company}`)
    prompts.log.info(`   License:  ${config.licenseKey}`)
    prompts.log.info("")
    prompts.log.info("   Configured Tools:")

    if (config.credentials.jira?.enabled) {
      prompts.log.info(`   ✓ Jira (${config.credentials.jira.baseUrl})`)
    } else {
      prompts.log.info(`   ✗ Jira (not configured)`)
    }

    if (config.credentials["azure-devops"]?.enabled) {
      prompts.log.info(`   ✓ Azure DevOps (${config.credentials["azure-devops"].baseUrl})`)
    } else {
      prompts.log.info(`   ✗ Azure DevOps (not configured)`)
    }

    if (config.credentials.confluence?.enabled) {
      prompts.log.info(`   ✓ Confluence (${config.credentials.confluence.baseUrl})`)
    } else {
      prompts.log.info(`   ✗ Confluence (not configured)`)
    }

    prompts.log.info("")
    prompts.log.info(`   MCP Server: ${config.mcpServerUrl}`)
    prompts.log.info(`   Last Synced: ${new Date(config.lastSynced).toLocaleString()}`)
    prompts.log.info("")
  }
})

// Export for use in main auth command
export { readEnterpriseConfig }
