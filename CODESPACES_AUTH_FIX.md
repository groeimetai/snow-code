# GitHub Codespaces OAuth Fix

## Problem
The previous implementation attempted to use `urn:ietf:wg:oauth:2.0:oob` (out-of-band OAuth flow) for GitHub Codespaces, but **ServiceNow does not support this OAuth flow**. This caused authentication to fail in Codespaces.

## Solution
Use GitHub Codespaces' **automatic port forwarding** feature. When running in a Codespace, GitHub automatically exposes localhost ports as public HTTPS URLs.

### How It Works

1. **Detection**: Detect Codespace environment via environment variables:
   - `CODESPACES=true`
   - `CODESPACE_NAME`
   - `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`

2. **Redirect URI**: Use Codespace forwarded URL instead of localhost:
   ```
   Normal:     http://localhost:3005/callback
   Codespace:  https://{codespace-name}-3005.{forwarding-domain}/callback
   ```

3. **Callback Server**: Start HTTP server on localhost:3005 (same as normal flow)

4. **Port Forwarding**: GitHub automatically forwards HTTPS traffic from public URL to localhost:3005

5. **OAuth Flow**:
   - ServiceNow redirects to: `https://{codespace-name}-3005.{domain}/callback?code=...`
   - GitHub forwards to: `http://localhost:3005/callback?code=...`
   - Callback server receives the code and exchanges it for tokens

### User Configuration Required

Users must add the Codespace redirect URL to their ServiceNow OAuth Application:

```
1. Log into ServiceNow as admin
2. Navigate to: System OAuth > Application Registry
3. Open your OAuth application
4. Add redirect URL: https://{codespace-name}-3005.{domain}/callback
5. Save configuration
```

The CLI now automatically:
- Detects Codespace environment
- Computes the correct redirect URL
- Displays it to the user
- Prompts for confirmation before proceeding

## Technical Details

### Files Changed
- `packages/opencode/src/auth/servicenow-oauth.ts`

### Key Changes

1. **Redirect URI Selection** (line 627-640):
   ```typescript
   let redirectUri: string
   if (inCodespace) {
     const forwardedUrl = this.getCodespaceForwardedUrl()
     redirectUri = forwardedUrl  // https://...
   } else {
     redirectUri = `http://localhost:${port}/callback`
   }
   ```

2. **User Prompt** (line 644-668):
   - Show the exact redirect URL to configure
   - Provide step-by-step instructions
   - Require confirmation before proceeding

3. **Unified Callback Server** (line 681-683):
   - Use same `startCallbackServer` for both environments
   - Pass `redirectUri` parameter for correct token exchange
   - GitHub auto-forwards traffic in Codespaces

4. **Token Exchange** (line 874-880):
   - Use actual `redirectUri` instead of hardcoded localhost
   - OAuth spec requires redirect_uri to match authorization request

### Why This Works

GitHub Codespaces automatically forwards ports to public HTTPS URLs:
- Port 3005 → `https://{name}-3005.{domain}`
- Traffic to public URL → localhost:3005 inside Codespace
- No manual tunneling or proxy required

### What Doesn't Work (Previous Approaches)

❌ **Out-of-band flow** (`urn:ietf:wg:oauth:2.0:oob`): ServiceNow doesn't support this
❌ **Manual code entry**: Poor UX, error-prone
❌ **Localhost callback**: ServiceNow can't reach localhost from internet

✅ **Codespace port forwarding**: Built-in, automatic, secure

## Testing

To test in Codespaces:

```bash
# In GitHub Codespace
snow-code auth login

# Expected flow:
# 1. Detects Codespace environment
# 2. Shows redirect URL to configure
# 3. Prompts for confirmation
# 4. Opens browser with auth URL
# 5. ServiceNow redirects to Codespace URL
# 6. GitHub forwards to localhost callback
# 7. Tokens saved successfully
```

## Version
Fixed in: v0.18.19 (November 2025)
