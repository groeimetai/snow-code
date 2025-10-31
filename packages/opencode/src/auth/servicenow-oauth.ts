/**
 * ServiceNow OAuth Authentication for SnowCode
 * Handles OAuth2 flow for ServiceNow integration
 */

import crypto from "crypto"
import * as prompts from "@clack/prompts"
import { Auth } from "./index"

/**
 * OAuth HTML Templates with Snow-Flow minimalist branding
 */
const baseStyles = `
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #1E2531;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #FFFFFF;
    }

    .container {
      max-width: 600px;
      width: 100%;
      text-align: center;
    }

    .logo {
      margin-bottom: 3rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }

    .logo-svg {
      width: 150px;
      height: auto;
    }

    .logo-text {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }

    .snow {
      color: #FFFFFF;
    }

    .flow {
      color: #00D9FF;
    }

    .status-icon {
      font-size: 4rem;
      margin-bottom: 2rem;
      display: block;
    }

    h1 {
      font-size: 3rem;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 1.5rem;
      letter-spacing: -0.02em;
    }

    .success-text {
      color: #00D9FF;
    }

    .error-text {
      color: #f5222d;
    }

    p {
      font-size: 1.25rem;
      color: #94A3B8;
      line-height: 1.6;
      margin-bottom: 1rem;
    }

    .instruction {
      font-size: 1.125rem;
      color: #FFFFFF;
      margin-top: 2rem;
      padding: 1.5rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .error-details {
      margin-top: 2rem;
      padding: 1.5rem;
      background: rgba(245, 34, 45, 0.1);
      border-radius: 12px;
      border: 1px solid rgba(245, 34, 45, 0.3);
      font-family: 'Courier New', monospace;
      font-size: 0.875rem;
      color: #f5222d;
      word-break: break-word;
    }

    .footer {
      margin-top: 3rem;
      font-size: 0.875rem;
      color: #64748B;
    }

    @media (max-width: 768px) {
      h1 {
        font-size: 2rem;
      }

      .status-icon {
        font-size: 3rem;
      }

      .logo-text {
        font-size: 1.5rem;
      }
    }
  </style>
`;

const logoSVG = `
  <svg class="logo-svg" viewBox="0 0 100 70" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Mountain gradient (white to cyan) -->
      <linearGradient id="mountain-v" x1="50" y1="8" x2="50" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#FFFFFF"/>
        <stop offset="100%" stop-color="#00D9FF"/>
      </linearGradient>
    </defs>

    <!-- Icon centered and scaled up -->
    <g transform="translate(26, 2)">
      <!-- Mountain peaks (geometric, clear) - scaled up and better centered -->
      <path d="M6 26 L15 6 L24 16 L33 6 L42 26 Z"
            fill="url(#mountain-v)"
            stroke="#00D9FF"
            stroke-width="1.5"
            stroke-linejoin="round"/>
    </g>

    <!-- Text SNOW centered -->
    <text x="50" y="50" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" fill="#FFFFFF" letter-spacing="-0.02em">SNOW</text>

    <!-- Text FLOW centered -->
    <text x="50" y="66" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" fill="#00D9FF" letter-spacing="-0.02em">FLOW</text>
  </svg>
`;

const OAuthTemplates = {
  success: `
    <html>
      <head>
        <title>Snow-Flow - Authentication Successful</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${baseStyles}
      </head>
      <body>
        <div class="container">
          <div class="logo">
            ${logoSVG}
          </div>

          <span class="status-icon">✓</span>

          <h1 class="success-text">
            Connected!
          </h1>

          <p>
            Your ServiceNow instance is now connected to Snow-Flow.
          </p>

          <div class="instruction">
            You can close this window and return to your terminal.
          </div>

          <div class="footer">
            Snow-Flow: ServiceNow Multi-Agent Development Framework
          </div>
        </div>
      </body>
    </html>
  `,

  error: (error: string) => `
    <html>
      <head>
        <title>Snow-Flow - Authentication Error</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${baseStyles}
      </head>
      <body>
        <div class="container">
          <div class="logo">
            ${logoSVG}
          </div>

          <span class="status-icon error-text">✕</span>

          <h1 class="error-text">
            Authentication Failed
          </h1>

          <p>
            We couldn't complete the authentication process.
          </p>

          <div class="error-details">
            ${error}
          </div>

          <div class="instruction">
            Please close this window and try again.
          </div>

          <div class="footer">
            Need help? Check the Snow-Flow documentation.
          </div>
        </div>
      </body>
    </html>
  `,

  securityError: `
    <html>
      <head>
        <title>Snow-Flow - Security Error</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${baseStyles}
      </head>
      <body>
        <div class="container">
          <div class="logo">
            ${logoSVG}
          </div>

          <span class="status-icon error-text">⚠</span>

          <h1 class="error-text">
            Security Error
          </h1>

          <p>
            Invalid state parameter detected - possible CSRF attack.
          </p>

          <div class="instruction">
            Please close this window and start the authentication process again.
          </div>

          <div class="footer">
            Your security is our priority.
          </div>
        </div>
      </body>
    </html>
  `,

  missingCode: `
    <html>
      <head>
        <title>Snow-Flow - Missing Authorization Code</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${baseStyles}
      </head>
      <body>
        <div class="container">
          <div class="logo">
            ${logoSVG}
          </div>

          <span class="status-icon error-text">✕</span>

          <h1 class="error-text">
            Missing Authorization
          </h1>

          <p>
            No authorization code was received from ServiceNow.
          </p>

          <div class="instruction">
            Make sure you approve the authorization request in ServiceNow, then try again.
          </div>

          <div class="footer">
            Snow-Flow: ServiceNow Multi-Agent Development Framework
          </div>
        </div>
      </body>
    </html>
  `,

  tokenExchangeFailed: (error: string) => `
    <html>
      <head>
        <title>Snow-Flow - Token Exchange Failed</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${baseStyles}
      </head>
      <body>
        <div class="container">
          <div class="logo">
            ${logoSVG}
          </div>

          <span class="status-icon error-text">✕</span>

          <h1 class="error-text">
            Token Exchange Failed
          </h1>

          <p>
            Unable to exchange authorization code for access token.
          </p>

          <div class="error-details">
            ${error}
          </div>

          <div class="instruction">
            Please verify your OAuth configuration (Client ID and Client Secret) and try again.
          </div>

          <div class="footer">
            Snow-Flow: ServiceNow Multi-Agent Development Framework
          </div>
        </div>
      </body>
    </html>
  `
}

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
      redirect_uri: "http://localhost:3005/callback",
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
   * Main authentication flow with localhost callback server
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
        prompts.log.message("   4. Set Redirect URL to: http://localhost:3005/callback")
        prompts.log.message("   5. Copy the generated Client Secret")
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

      // Start localhost callback server
      const port = 3005
      const redirectUri = `http://localhost:${port}/callback`

      // Generate authorization URL
      const authUrl = this.generateAuthUrlWithCallback(normalizedInstance, options.clientId, redirectUri)

      prompts.log.message("")
      prompts.log.step("Opening browser for authentication...")
      prompts.log.info(`Authorization URL: ${authUrl}`)
      prompts.log.message("")

      // Auto-open browser
      this.openBrowser(authUrl)

      // Start callback server and wait for code
      const result = await this.startCallbackServer(port, normalizedInstance, options.clientId, options.clientSecret)

      if (result.success && result.accessToken) {
        // Save to SnowCode auth store
        await Auth.set("servicenow", {
          type: "servicenow-oauth",
          instance: normalizedInstance,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined,
        })

        prompts.log.success("Tokens saved securely")
      }

      return result
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
   * Generate authorization URL with localhost callback
   */
  private generateAuthUrlWithCallback(instance: string, clientId: string, redirectUri: string): string {
    const baseUrl = instance.startsWith("http") ? instance : `https://${instance}`

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: this.stateParameter!,
      code_challenge: this.codeChallenge!,
      code_challenge_method: "S256",
    })

    return `${baseUrl}/oauth_auth.do?${params.toString()}`
  }

  /**
   * Auto-open browser
   */
  private openBrowser(url: string): void {
    try {
      const { spawn } = require("child_process")
      let browserProcess: any

      if (process.platform === "darwin") {
        browserProcess = spawn("open", [url], { detached: true, stdio: "ignore" })
      } else if (process.platform === "win32") {
        browserProcess = spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" })
      } else if (process.platform === "linux") {
        // Try multiple Linux browser openers
        const openers = ["xdg-open", "gnome-open", "kde-open"]
        for (const opener of openers) {
          try {
            browserProcess = spawn(opener, [url], { detached: true, stdio: "ignore" })
            break
          } catch (e) {
            continue
          }
        }
      }

      if (browserProcess && browserProcess.unref) {
        browserProcess.unref()
      }
    } catch (err) {
      prompts.log.warn("Could not auto-open browser. Please manually open the URL above.")
    }
  }

  /**
   * Start localhost callback server
   */
  private async startCallbackServer(
    port: number,
    instance: string,
    clientId: string,
    clientSecret: string,
  ): Promise<ServiceNowAuthResult> {
    return new Promise((resolve) => {
      const { createServer } = require("http")
      const { URL } = require("url")

      const server = createServer(async (req: any, res: any) => {
        try {
          const url = new URL(req.url!, `http://localhost:${port}`)

          if (url.pathname === "/callback") {
            const code = url.searchParams.get("code")
            const error = url.searchParams.get("error")
            const state = url.searchParams.get("state")

            // Validate state parameter
            if (state !== this.stateParameter) {
              res.writeHead(400, { "Content-Type": "text/html" })
              res.end(OAuthTemplates.securityError)
              server.close()
              resolve({ success: false, error: "Invalid state parameter" })
              return
            }

            if (error) {
              res.writeHead(400, { "Content-Type": "text/html" })
              res.end(OAuthTemplates.error(`OAuth error: ${error}`))
              server.close()
              resolve({ success: false, error: `OAuth error: ${error}` })
              return
            }

            if (!code) {
              res.writeHead(400, { "Content-Type": "text/html" })
              res.end(OAuthTemplates.missingCode)
              server.close()
              resolve({ success: false, error: "No authorization code received" })
              return
            }

            // Exchange code for tokens
            const spinner = prompts.spinner()
            spinner.start("Exchanging authorization code for tokens")
            const tokenResult = await this.exchangeCodeForTokens(instance, clientId, clientSecret, code)

            if (tokenResult.success) {
              res.writeHead(200, { "Content-Type": "text/html" })
              res.end(OAuthTemplates.success)
              spinner.stop("Authentication successful")
              server.close()
              resolve(tokenResult)
            } else {
              res.writeHead(500, { "Content-Type": "text/html" })
              res.end(OAuthTemplates.tokenExchangeFailed(tokenResult.error || "Unknown error"))
              spinner.stop("Token exchange failed")
              server.close()
              resolve(tokenResult)
            }
          } else {
            res.writeHead(404, { "Content-Type": "text/plain" })
            res.end("Not Found")
          }
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/plain" })
          res.end("Internal Server Error")
          server.close()
          resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

      server.listen(port, () => {
        prompts.log.info(`Callback server started on http://localhost:${port}/callback`)
        prompts.log.info("Waiting for OAuth callback...")
      })

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close()
        resolve({
          success: false,
          error: "Authentication timeout (5 minutes)",
        })
      }, 300000)
    })
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
