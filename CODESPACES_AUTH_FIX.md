# GitHub Codespaces OAuth Fix

## Problem
OAuth callbacks don't work in remote development environments (GitHub Codespaces, Gitpod, etc.) because the browser can't reach `http://localhost:3005` from the internet.

## Solution
**Simple URL Pasting**: Always use localhost as the redirect URL, and let users paste the callback URL when the automatic redirect fails.

### How It Works

1. **Standard OAuth Flow**: Use `http://localhost:3005/callback` for ALL environments (no special Codespaces URLs needed)

2. **Automatic Detection**: Detect Codespace environment via environment variables:
   - `CODESPACES=true`
   - `CODESPACE_NAME`

3. **User-Friendly Instructions**: When in Codespaces, show clear instructions:
   ```
   After clicking 'Approve' in ServiceNow:
   1. Your browser will show a 'Can't reach this page' or 404 error
   2. Copy the FULL URL from your browser address bar
      (it starts with: http://localhost:3005/callback?code=...)
   3. Paste it below when prompted
   ```

4. **Code Extraction**: The CLI extracts the authorization code from the pasted URL and completes authentication

### Benefits

✅ **No ServiceNow configuration required** - users don't need to add special redirect URLs
✅ **Works everywhere** - Codespaces, Gitpod, Cloud IDEs, etc.
✅ **Simple UX** - just copy and paste the URL
✅ **Secure** - validates state parameter to prevent CSRF attacks
✅ **Backward compatible** - normal localhost flow still works for local development

## Technical Details

### Files Changed
- `packages/opencode/src/auth/servicenow-oauth.ts`

### Key Changes

1. **Simplified Redirect URI** (line 623-625):
   ```typescript
   // Always use localhost - simplest approach for all environments
   const port = 3005
   const redirectUri = `http://localhost:${port}/callback`
   ```

2. **Clear Instructions** (line 886-894):
   ```typescript
   prompts.log.info("🌐 GitHub Codespaces Detected")
   prompts.log.info("After clicking 'Approve' in ServiceNow:")
   prompts.log.message("   1. Your browser will show a 'Can't reach this page' or 404 error")
   prompts.log.message("   2. Copy the FULL URL from your browser address bar")
   prompts.log.message("   3. Paste it below when prompted")
   ```

3. **URL Pasting Fallback** (line 901-1000):
   - Wait 3 seconds for automatic callback
   - Prompt user to paste callback URL
   - Extract authorization code from URL
   - Validate state parameter (CSRF protection)
   - Exchange code for tokens

### Why This Works

**Simplicity**: No complex port forwarding setup required
**Compatibility**: Works in any remote environment where localhost isn't accessible
**Security**: State parameter validation prevents CSRF attacks
**UX**: Clear instructions guide users through the process

### What Doesn't Work (Previous Approaches)

❌ **Port forwarding URLs**: Requires users to configure ServiceNow with environment-specific URLs
❌ **Out-of-band flow**: ServiceNow doesn't support this OAuth flow
❌ **Manual code entry**: Error-prone, users might copy wrong part of URL

✅ **URL pasting**: Simple, works everywhere, no configuration needed

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
