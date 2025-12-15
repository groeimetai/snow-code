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

type CredentialSource = 'user' | 'org'

interface CredentialPreferences {
  jira?: CredentialSource
  'azure-devops'?: CredentialSource
  confluence?: CredentialSource
  servicenow?: CredentialSource
  github?: CredentialSource
  gitlab?: CredentialSource
}

interface EnterpriseConfig {
  token: string
  customerId: number
  customerName: string
  company: string
  licenseKey?: string
  // Auth method: 'browser' for enterprise user login, 'license-key' for admin login
  authMethod: 'browser' | 'license-key'
  // Enterprise user info (when authMethod is 'browser')
  userId?: string
  username?: string
  email?: string
  role?: string
  // Credential preferences per service
  credentialPreferences?: CredentialPreferences
  credentials: {
    jira?: {
      baseUrl: string
      email: string
      apiToken: string
      enabled: boolean
      source?: CredentialSource
    }
    "azure-devops"?: {
      baseUrl: string
      username?: string
      apiToken: string
      enabled: boolean
      source?: CredentialSource
    }
    confluence?: {
      baseUrl: string
      email: string
      apiToken: string
      enabled: boolean
      source?: CredentialSource
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

      const verifyData = await verifyResponse.json()
      const { token, authType, customer, user } = verifyData

      prompts.log.success("✓ Authorization verified!")
      prompts.log.info("")

      // Determine if this is an enterprise user or admin (license key) login
      const isEnterpriseUser = authType === 'enterprise-user'
      const isEnterpriseAdmin = authType === 'enterprise'

      if (!isEnterpriseUser && !isEnterpriseAdmin) {
        // Portal user tried enterprise login - redirect them
        prompts.log.warn("This account is not associated with an Enterprise subscription.")
        prompts.log.info("Use 'snow-code auth portal-login' for Individual/Teams plans.")
        prompts.log.info("")
        process.exit(0)
      }

      // Step 5: Fetch enterprise credentials with user ID for credential selection
      prompts.log.step("Syncing enterprise credentials...")

      // For enterprise users, use fetch-for-cli to get both user and org credentials
      const credentialsResponse = isEnterpriseUser
        ? await fetch(`${API_URL}/api/credentials/fetch-for-cli`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              licenseKey: customer.licenseKey,
              userId: user?.id
            })
          })
        : await fetch(`${API_URL}/api/auth/enterprise/credentials`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
          })

      if (!credentialsResponse.ok) {
        const error = await credentialsResponse.json()
        throw new Error(error.error || "Failed to fetch enterprise credentials")
      }

      const credentialsData = await credentialsResponse.json()

      // For enterprise users, handle credential selection
      let credentials = credentialsData.credentials || {}
      let servicenowInstances = credentialsData.servicenowInstances || []
      let mcpServerUrl = credentialsData.mcpServerUrl || ""
      let credentialPreferences: CredentialPreferences = {}

      // Check if user has credentials from multiple sources
      if (isEnterpriseUser && credentialsData.availableCredentials) {
        const { user: userCreds, org: orgCreds } = credentialsData.availableCredentials

        // Find services available from both sources
        const sharedServices = (userCreds || []).filter((s: string) => (orgCreds || []).includes(s))

        if (sharedServices.length > 0) {
          prompts.log.info("")
          prompts.log.info("📋 You have credentials available from multiple sources.")
          prompts.log.info("")

          // Ask user to select for each shared service
          for (const service of sharedServices) {
            const serviceLabel = service === 'azure-devops' ? 'Azure DevOps' :
                                service.charAt(0).toUpperCase() + service.slice(1)

            // Find the credentials for display
            const userCred = (credentialsData.credentials || []).find(
              (c: any) => c.service === service && c.source === 'user'
            )
            const orgCred = (credentialsData.credentials || []).find(
              (c: any) => c.service === service && c.source === 'org'
            )

            const choice = await prompts.select({
              message: `Which ${serviceLabel} credentials do you want to use?`,
              options: [
                {
                  value: 'user',
                  label: `Personal (${userCred?.baseUrl || 'your personal credentials'})`
                },
                {
                  value: 'org',
                  label: `Organization (${orgCred?.baseUrl || 'company credentials'})`
                }
              ]
            })

            if (prompts.isCancel(choice)) {
              prompts.log.info("")
              prompts.log.warn("⚠️  Credential selection cancelled")
              process.exit(0)
            }

            credentialPreferences[service as keyof CredentialPreferences] = choice as CredentialSource
          }

          // Set preferences for services only available from one source
          for (const service of userCreds || []) {
            if (!sharedServices.includes(service)) {
              credentialPreferences[service as keyof CredentialPreferences] = 'user'
            }
          }
          for (const service of orgCreds || []) {
            if (!sharedServices.includes(service)) {
              credentialPreferences[service as keyof CredentialPreferences] = 'org'
            }
          }
        }
      }

      // Transform credentials array to object format for config
      const credentialsObj: EnterpriseConfig['credentials'] = {}
      const credsArray = Array.isArray(credentialsData.credentials)
        ? credentialsData.credentials
        : []

      for (const cred of credsArray) {
        const serviceKey = cred.service as keyof typeof credentialsObj
        const preferredSource = credentialPreferences[serviceKey as keyof CredentialPreferences]

        // If no preference set or this is the preferred source, use it
        if (!preferredSource || cred.source === preferredSource || !credentialsObj[serviceKey]) {
          if (serviceKey === 'jira') {
            credentialsObj.jira = {
              baseUrl: cred.baseUrl,
              email: cred.email || '',
              apiToken: cred.apiToken || '',
              enabled: cred.enabled !== false,
              source: cred.source
            }
          } else if (serviceKey === 'azure-devops') {
            credentialsObj['azure-devops'] = {
              baseUrl: cred.baseUrl,
              username: cred.username,
              apiToken: cred.apiToken || '',
              enabled: cred.enabled !== false,
              source: cred.source
            }
          } else if (serviceKey === 'confluence') {
            credentialsObj.confluence = {
              baseUrl: cred.baseUrl,
              email: cred.email || '',
              apiToken: cred.apiToken || '',
              enabled: cred.enabled !== false,
              source: cred.source
            }
          }
        }
      }

      // Use object format if we got that directly (for admin login)
      if (!Array.isArray(credentialsData.credentials) && credentialsData.credentials) {
        Object.assign(credentialsObj, credentialsData.credentials)
      }

      // Step 6: Save configuration
      const enterpriseConfig: EnterpriseConfig = {
        token,
        customerId: customer.id,
        customerName: customer.name,
        company: customer.company,
        licenseKey: customer.licenseKey,
        authMethod: isEnterpriseUser ? 'browser' : 'license-key',
        ...(isEnterpriseUser && user && {
          userId: String(user.id),
          username: user.username,
          email: user.email,
          role: user.role
        }),
        credentialPreferences: Object.keys(credentialPreferences).length > 0 ? credentialPreferences : undefined,
        credentials: credentialsObj,
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

      if (isEnterpriseUser && user) {
        prompts.log.info(`   User:     ${user.username || user.email}`)
        prompts.log.info(`   Role:     ${user.role}`)
      }
      prompts.log.info(`   Customer: ${customer.name}`)
      prompts.log.info(`   Company:  ${customer.company}`)
      prompts.log.info("")
      prompts.log.info("   Available Tools:")

      if (credentialsObj.jira?.enabled) {
        const source = credentialsObj.jira.source ? ` [${credentialsObj.jira.source}]` : ''
        prompts.log.info(`   ✓ Jira (${credentialsObj.jira.baseUrl})${source}`)
      }
      if (credentialsObj["azure-devops"]?.enabled) {
        const source = credentialsObj["azure-devops"].source ? ` [${credentialsObj["azure-devops"].source}]` : ''
        prompts.log.info(`   ✓ Azure DevOps (${credentialsObj["azure-devops"].baseUrl})${source}`)
      }
      if (credentialsObj.confluence?.enabled) {
        const source = credentialsObj.confluence.source ? ` [${credentialsObj.confluence.source}]` : ''
        prompts.log.info(`   ✓ Confluence (${credentialsObj.confluence.baseUrl})${source}`)
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

      // For enterprise users, use fetch-for-cli to get both user and org credentials
      const isEnterpriseUser = existingConfig.authMethod === 'browser' && existingConfig.userId

      const credentialsResponse = isEnterpriseUser && existingConfig.licenseKey
        ? await fetch(`${API_URL}/api/credentials/fetch-for-cli`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${existingConfig.token}`
            },
            body: JSON.stringify({
              licenseKey: existingConfig.licenseKey,
              userId: existingConfig.userId,
              serviceSelection: existingConfig.credentialPreferences
            })
          })
        : await fetch(`${API_URL}/api/auth/enterprise/credentials`, {
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

      const credentialsData = await credentialsResponse.json()

      // Transform credentials based on format
      let credentialsObj: EnterpriseConfig['credentials'] = {}
      const servicenowInstances = credentialsData.servicenowInstances || []
      const mcpServerUrl = credentialsData.mcpServerUrl || ""

      if (Array.isArray(credentialsData.credentials)) {
        // Array format from fetch-for-cli - apply preferences
        for (const cred of credentialsData.credentials) {
          const serviceKey = cred.service as keyof typeof credentialsObj
          const preferredSource = existingConfig.credentialPreferences?.[serviceKey as keyof CredentialPreferences]

          // If this is the preferred source or no preference/no existing, use it
          if (!preferredSource || cred.source === preferredSource || !credentialsObj[serviceKey]) {
            if (serviceKey === 'jira') {
              credentialsObj.jira = {
                baseUrl: cred.baseUrl,
                email: cred.email || '',
                apiToken: cred.apiToken || '',
                enabled: cred.enabled !== false,
                source: cred.source
              }
            } else if (serviceKey === 'azure-devops') {
              credentialsObj['azure-devops'] = {
                baseUrl: cred.baseUrl,
                username: cred.username,
                apiToken: cred.apiToken || '',
                enabled: cred.enabled !== false,
                source: cred.source
              }
            } else if (serviceKey === 'confluence') {
              credentialsObj.confluence = {
                baseUrl: cred.baseUrl,
                email: cred.email || '',
                apiToken: cred.apiToken || '',
                enabled: cred.enabled !== false,
                source: cred.source
              }
            }
          }
        }
      } else {
        // Object format from enterprise/credentials
        credentialsObj = credentialsData.credentials || {}
      }

      // Update config
      const updatedConfig: EnterpriseConfig = {
        ...existingConfig,
        credentials: credentialsObj,
        servicenowInstances: servicenowInstances || [],
        mcpServerUrl,
        lastSynced: Date.now()
      }

      saveEnterpriseConfig(updatedConfig)

      prompts.log.success("✓ Credentials synced successfully!")
      prompts.log.info("")

      // Show updated credentials
      prompts.log.info("   Updated Credentials:")

      if (credentialsObj.jira?.enabled) {
        const source = credentialsObj.jira.source ? ` [${credentialsObj.jira.source}]` : ''
        prompts.log.info(`   ✓ Jira (${credentialsObj.jira.baseUrl})${source}`)
      } else {
        prompts.log.info(`   ✗ Jira (not configured)`)
      }

      if (credentialsObj["azure-devops"]?.enabled) {
        const source = credentialsObj["azure-devops"].source ? ` [${credentialsObj["azure-devops"].source}]` : ''
        prompts.log.info(`   ✓ Azure DevOps (${credentialsObj["azure-devops"].baseUrl})${source}`)
      } else {
        prompts.log.info(`   ✗ Azure DevOps (not configured)`)
      }

      if (credentialsObj.confluence?.enabled) {
        const source = credentialsObj.confluence.source ? ` [${credentialsObj.confluence.source}]` : ''
        prompts.log.info(`   ✓ Confluence (${credentialsObj.confluence.baseUrl})${source}`)
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

    // Show user info for enterprise users
    if (config.authMethod === 'browser' && config.username) {
      prompts.log.info(`   User:     ${config.username}${config.email ? ` (${config.email})` : ''}`)
      prompts.log.info(`   Role:     ${config.role || 'user'}`)
      prompts.log.info("")
    }

    // Show status
    prompts.log.info(`   Customer: ${config.customerName}`)
    prompts.log.info(`   Company:  ${config.company}`)
    if (config.licenseKey) {
      prompts.log.info(`   License:  ${config.licenseKey}`)
    }
    prompts.log.info(`   Auth:     ${config.authMethod === 'browser' ? 'Browser login' : 'License key'}`)
    prompts.log.info("")
    prompts.log.info("   Configured Tools:")

    if (config.credentials.jira?.enabled) {
      const source = config.credentials.jira.source ? ` [${config.credentials.jira.source}]` : ''
      prompts.log.info(`   ✓ Jira (${config.credentials.jira.baseUrl})${source}`)
    } else {
      prompts.log.info(`   ✗ Jira (not configured)`)
    }

    if (config.credentials["azure-devops"]?.enabled) {
      const source = config.credentials["azure-devops"].source ? ` [${config.credentials["azure-devops"].source}]` : ''
      prompts.log.info(`   ✓ Azure DevOps (${config.credentials["azure-devops"].baseUrl})${source}`)
    } else {
      prompts.log.info(`   ✗ Azure DevOps (not configured)`)
    }

    if (config.credentials.confluence?.enabled) {
      const source = config.credentials.confluence.source ? ` [${config.credentials.confluence.source}]` : ''
      prompts.log.info(`   ✓ Confluence (${config.credentials.confluence.baseUrl})${source}`)
    } else {
      prompts.log.info(`   ✗ Confluence (not configured)`)
    }

    // Show ServiceNow instances
    if (config.servicenowInstances && config.servicenowInstances.length > 0) {
      prompts.log.info("")
      prompts.log.info("   ServiceNow Instances:")
      for (const inst of config.servicenowInstances) {
        const defaultTag = inst.isDefault ? " (default)" : ""
        prompts.log.info(`   ✓ ${inst.instanceName} [${inst.environmentType}]${defaultTag}`)
      }
    }

    prompts.log.info("")
    prompts.log.info(`   MCP Server: ${config.mcpServerUrl}`)
    prompts.log.info(`   Last Synced: ${new Date(config.lastSynced).toLocaleString()}`)
    prompts.log.info("")
  }
})

// Export for use in main auth command
export { readEnterpriseConfig }
