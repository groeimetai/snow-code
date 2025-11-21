/**
 * Portal Credential Synchronization
 *
 * Synchronizes local credentials (auth.json) to the Enterprise Portal
 * so users can manage their third-party integrations via the web UI.
 */

import { Auth } from "./index"
import type z from "zod/v4"

export namespace PortalSync {
  interface CredentialPayload {
    service: string
    credentialType?: 'api_token' | 'basic_auth'
    baseUrl: string
    email?: string
    username?: string
    apiToken?: string
    password?: string
  }

  /**
   * Extract third-party credentials from Enterprise auth and format for portal
   */
  function extractCredentialsFromAuth(auth: z.infer<typeof Auth.Enterprise>): CredentialPayload[] {
    const credentials: CredentialPayload[] = []

    // Jira credentials (uses unified Atlassian credentials)
    if (auth.jiraBaseUrl && auth.atlassianApiToken) {
      credentials.push({
        service: 'jira',
        credentialType: 'api_token',
        baseUrl: auth.jiraBaseUrl,
        email: auth.atlassianEmail,
        apiToken: auth.atlassianApiToken
      })
    }

    // Azure DevOps credentials
    if (auth.azureOrg && auth.azurePat) {
      const baseUrl = `https://dev.azure.com/${auth.azureOrg}`
      credentials.push({
        service: 'azure-devops',
        credentialType: 'api_token',
        baseUrl,
        apiToken: auth.azurePat
      })
    }

    // Confluence credentials (uses unified Atlassian credentials)
    if (auth.confluenceUrl && auth.atlassianApiToken) {
      credentials.push({
        service: 'confluence',
        credentialType: 'api_token',
        baseUrl: auth.confluenceUrl,
        email: auth.atlassianEmail,
        apiToken: auth.atlassianApiToken
      })
    }

    return credentials
  }

  /**
   * Sync credentials from local auth.json to Enterprise Portal
   *
   * @param licenseKey - Enterprise license key for authentication
   * @param portalUrl - Optional custom portal URL (defaults to production)
   * @returns Success status and sync results
   */
  export async function syncToPortal(
    licenseKey: string,
    portalUrl?: string
  ): Promise<{
    success: boolean
    message?: string
    results?: Array<{ service: string; success: boolean; action?: string; error?: string }>
    error?: string
  }> {
    try {
      // Get enterprise auth from local storage
      const auth = await Auth.get("enterprise")

      if (!auth || auth.type !== "enterprise") {
        return {
          success: false,
          error: "No enterprise authentication found in local storage"
        }
      }

      // Extract third-party credentials
      const credentials = extractCredentialsFromAuth(auth)

      if (credentials.length === 0) {
        return {
          success: true,
          message: "No third-party credentials to sync"
        }
      }

      // Determine portal URL
      const baseUrl = portalUrl || process.env.SNOW_FLOW_PORTAL_URL || "https://portal.snow-flow.dev"
      const syncUrl = `${baseUrl}/api/credentials/sync-from-cli`

      // Send credentials to portal
      const response = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          licenseKey,
          credentials
        })
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`
        }
      }

      return {
        success: true,
        message: data.message || "Credentials synced successfully",
        results: data.results
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Quick sync helper - automatically syncs if enterprise auth exists
   */
  export async function autoSync(portalUrl?: string): Promise<void> {
    const auth = await Auth.get("enterprise")

    if (!auth || auth.type !== "enterprise") {
      // Silently skip if no enterprise auth
      return
    }

    if (!auth.licenseKey) {
      console.warn("Enterprise auth found but no license key - skipping portal sync")
      return
    }

    const result = await syncToPortal(auth.licenseKey, portalUrl)

    if (result.success) {
      console.log(`✓ Synced ${result.results?.length || 0} credentials to portal`)
    } else {
      console.warn(`⚠ Failed to sync credentials to portal: ${result.error}`)
    }
  }
}
