/**
 * ServiceNow OAuth Authentication for SnowCode
 * Handles OAuth2 flow for ServiceNow integration
 */

import crypto from "crypto"
import * as prompts from "@clack/prompts"
import { Auth } from "./index"

export interface ServiceNowAuthResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
}

export interface ServiceNowOAuthOptions {
  instance: string
  clientId: string
  clientSecret: string
}

export class ServiceNowOAuth {
  private stateParameter?: string
  private codeVerifier?: string
  private codeChallenge?: string

  // Rate limiting
  private lastTokenRequest: number = 0
  private tokenRequestCount: number = 0
  private readonly TOKEN_REQUEST_WINDOW_MS = 60000 // 1 minute
  private readonly MAX_TOKEN_REQUESTS_PER_WINDOW = 10

  /**
   * Check rate limiting for token requests
   */
  private checkTokenRequestRateLimit(): boolean {
    const now = Date.now()

    if (now - this.lastTokenRequest > this.TOKEN_REQUEST_WINDOW_MS) {
      this.tokenRequestCount = 0
      this.lastTokenRequest = now
    }

    if (this.tokenRequestCount >= this.MAX_TOKEN_REQUESTS_PER_WINDOW) {
      prompts.log.warn("Rate limit exceeded: Too many token requests. Please wait before retrying.")
      return false
    }

    this.tokenRequestCount++
    return true
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  private generateState(): string {
    return crypto.randomBytes(16).toString("base64url")
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE() {
    this.codeVerifier = crypto.randomBytes(32).toString("base64url")
    const hash = crypto.createHash("sha256")
    hash.update(this.codeVerifier)
    this.codeChallenge = hash.digest("base64url")
  }

  /**
   * Normalize instance URL
   */
  private normalizeInstanceUrl(instance: string): string {
    let normalized = instance.replace(/\/+$/, "")

    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      normalized = `https://${normalized}`
    }

    if (
      !normalized.includes(".service-now.com") &&
      !normalized.includes("localhost") &&
      !normalized.includes("127.0.0.1")
    ) {
      const instanceName = normalized.replace("https://", "").replace("http://", "")
      normalized = `https://${instanceName}.service-now.com`
    }

    return normalized
  }

  /**
   * Validate client secret format
   */
  private validateClientSecret(secret: string): { valid: boolean; reason?: string } {
    if (!secret || secret.trim() === "") {
      return { valid: false, reason: "Client secret is required" }
    }

    if (secret.length < 32) {
      return {
        valid: false,
        reason: "Client secret is too short (should be 32+ characters)",
      }
    }

    const commonPasswords = ["password", "admin", "secret", "client", "snow"]
    const lowerSecret = secret.toLowerCase()
    for (const common of commonPasswords) {
      if (lowerSecret.includes(common)) {
        return {
          valid: false,
          reason: `Client secret appears to be a common password - it should be a random string from ServiceNow`,
        }
      }
    }

    return { valid: true }
  }

  /**
   * Generate authorization URL
   */
  private generateAuthUrl(instance: string, clientId: string): string {
    const baseUrl = instance.startsWith("http") ? instance : `https://${instance}`

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      state: this.stateParameter!,
      code_challenge: this.codeChallenge!,
      code_challenge_method: "S256",
    })

    return `${baseUrl}/oauth_auth.do?${params.toString()}`
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(
    instance: string,
    clientId: string,
    clientSecret: string,
    code: string,
  ): Promise<ServiceNowAuthResult> {
    if (!this.checkTokenRequestRateLimit()) {
      return {
        success: false,
        error: "Rate limit exceeded. Please wait before retrying.",
      }
    }

    const baseUrl = instance.startsWith("http") ? instance : `https://${instance}`
    const tokenUrl = `${baseUrl}/oauth_token.do`

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: this.codeVerifier!,
    })

    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `Token exchange failed: ${response.status} ${errorText}`,
        }
      }

      const data = await response.json()

      if (data.error) {
        return {
          success: false,
          error: `OAuth error: ${data.error} - ${data.error_description || ""}`,
        }
      }

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Main authentication flow with code paste
   */
  async authenticate(options: ServiceNowOAuthOptions): Promise<ServiceNowAuthResult> {
    try {
      const normalizedInstance = this.normalizeInstanceUrl(options.instance)

      // Validate client secret
      const secretValidation = this.validateClientSecret(options.clientSecret)
      if (!secretValidation.valid) {
        prompts.log.error(`Invalid OAuth Client Secret: ${secretValidation.reason}`)
        prompts.log.info("To get a valid OAuth secret:")
        prompts.log.message("   1. Log into ServiceNow as admin")
        prompts.log.message("   2. Navigate to: System OAuth > Application Registry")
        prompts.log.message("   3. Create a new OAuth application")
        prompts.log.message("   4. Copy the generated Client Secret")
        return {
          success: false,
          error: secretValidation.reason,
        }
      }

      prompts.log.step("Starting ServiceNow OAuth flow")
      prompts.log.info(`Instance: ${normalizedInstance}`)

      // Generate state and PKCE
      this.stateParameter = this.generateState()
      this.generatePKCE()

      // Generate authorization URL
      const authUrl = this.generateAuthUrl(normalizedInstance, options.clientId)

      prompts.log.message("")
      prompts.log.step("Authorization URL generated")
      prompts.log.message(`\n${authUrl}\n`)
      prompts.log.warn(`Go to: ${authUrl}`)
      prompts.log.message("")

      const authCode = (await prompts.text({
        message: "Paste the authorization code here",
        placeholder: "Enter the code from the browser after authorizing",
        validate: (value) => {
          if (!value || value.trim() === "") return "Authorization code is required"
          if (value.length < 10) return "Code seems too short"
        },
      })) as string

      if (prompts.isCancel(authCode)) {
        return {
          success: false,
          error: "Authentication cancelled by user",
        }
      }

      // Extract code if user pasted full URL
      let code = authCode.trim()
      if (code.includes("code=")) {
        const match = code.match(/code=([^&]+)/)
        if (match) {
          code = match[1]
        }
      }

      // Exchange code for tokens
      const spinner = prompts.spinner()
      spinner.start("Exchanging authorization code for tokens")

      const tokenResult = await this.exchangeCodeForTokens(
        normalizedInstance,
        options.clientId,
        options.clientSecret,
        code,
      )

      if (tokenResult.success && tokenResult.accessToken) {
        // Save to SnowCode auth store
        await Auth.set("servicenow", {
          type: "servicenow-oauth",
          instance: normalizedInstance,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          expiresAt: tokenResult.expiresIn ? Date.now() + tokenResult.expiresIn * 1000 : undefined,
        })

        spinner.stop("Authentication successful")
        prompts.log.success("Tokens saved securely")
      } else {
        spinner.stop("Token exchange failed")
      }

      return tokenResult
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      prompts.log.error(`Authentication failed: ${errorMessage}`)
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    instance: string,
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<ServiceNowAuthResult> {
    if (!this.checkTokenRequestRateLimit()) {
      return {
        success: false,
        error: "Rate limit exceeded",
      }
    }

    const baseUrl = instance.startsWith("http") ? instance : `https://${instance}`
    const tokenUrl = `${baseUrl}/oauth_token.do`

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })

    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      })

      if (!response.ok) {
        return {
          success: false,
          error: `Token refresh failed: ${response.status}`,
        }
      }

      const data = await response.json()

      if (data.error) {
        return {
          success: false,
          error: `OAuth error: ${data.error}`,
        }
      }

      // Update stored tokens
      await Auth.set("servicenow", {
        type: "servicenow-oauth",
        instance,
        clientId,
        clientSecret,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      })

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
