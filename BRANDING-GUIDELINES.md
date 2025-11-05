# Snow-Code Branding Guidelines

**Snow-Code is a fork of OpenCode** - These guidelines ensure proper branding.

**⚠️ CRITICAL: This is a FORK, not a compatibility layer. NO OpenCode references should remain in user-facing code!**

## ✅ MUST Change (ALL User-Facing & Environment Variables)

### 1. Build-Time Constants
```typescript
// ✅ CORRECT - Snow-Code branding
define: {
  SNOWCODE_VERSION: `'${version}'`,
  SNOWCODE_CHANNEL: `'${channel}'`,
}

// ❌ WRONG - OpenCode branding
define: {
  OPENCODE_VERSION: `'${version}'`,  // ← Causes version to show as "local"
}
```

### 2. User-Agent Strings
```typescript
// ✅ CORRECT
execArgv: [`--user-agent=snowcode/${version}`]

// ❌ WRONG
execArgv: [`--user-agent=opencode/${version}`]
```

### 3. Package Metadata
```json
{
  "name": "@groeimetai/snow-code",           // ✅
  "description": "SnowCode - ...",           // ✅
  "repository": "groeimetai/snow-code",      // ✅
  "homepage": "https://github.com/groeimetai/snow-code"  // ✅
}
```

### 4. Binary Names
```json
{
  "bin": {
    "snow-code": "./bin/snow-code",    // ✅ Primary
    "snowcode": "./bin/snow-code",     // ✅ Alias
    "opencode": "./bin/snow-code"      // ⚠️ Backwards compat only
  }
}
```

### 5. User-Facing Messages
```typescript
// ✅ CORRECT
prompts.log.info("Welcome to Snow-Code!")
console.log("Run: snow-code auth login")

// ❌ WRONG
prompts.log.info("Welcome to OpenCode!")
```

### 5. Environment Variables
**ALL environment variables MUST use SNOWCODE_ prefix:**

```typescript
// ✅ CORRECT - Only SNOWCODE_
export const CONFIG_DIR = process.env["SNOWCODE_CONFIG_DIR"]
export const AUTO_SHARE = truthy("SNOWCODE_AUTO_SHARE")
export const DISABLE_AUTOUPDATE = truthy("SNOWCODE_DISABLE_AUTOUPDATE")
export const DISABLE_PRUNE = truthy("SNOWCODE_DISABLE_PRUNE")
export const EXPERIMENTAL_WATCHER = truthy("SNOWCODE_EXPERIMENTAL_WATCHER")
export const DISABLE_LSP_DOWNLOAD = truthy("SNOWCODE_DISABLE_LSP_DOWNLOAD")
export const ENABLE_EXPERIMENTAL_MODELS = truthy("SNOWCODE_ENABLE_EXPERIMENTAL_MODELS")

// ❌ WRONG - No OPENCODE_ references!
export const CONFIG_DIR = process.env["OPENCODE_CONFIG_DIR"]  // NO!
```

**Rationale:** This is a FORK. Users should know they're using Snow-Code, not OpenCode.

---

## 🔧 Technical Internals (Can Stay)

### Internal Path Variables
```typescript
// ✅ OK to keep OPENCODE_
OPENCODE_TUI_PATH: `'../../../dist/${name}/bin/tui'`
OPENCODE_CALLER: "vscode"  // VSCode extension integration
```

**Rationale:** Internal technical details, not exposed to users.

### Go Build Paths
```bash
# ✅ OK - internal build paths
go build ... ../tui/cmd/opencode/main.go
```

---

## 🚨 Checklist for Upstream Merges

When merging from upstream `sst/opencode`, check:

### 1. Build Constants
- [ ] `OPENCODE_VERSION` → `SNOWCODE_VERSION`
- [ ] `OPENCODE_CHANNEL` → `SNOWCODE_CHANNEL`
- [ ] User-agent strings use `snowcode/`

### 2. Package Metadata
- [ ] `package.json` name is `@groeimetai/snow-code`
- [ ] Repository URLs point to `groeimetai/snow-code`
- [ ] Binary names use `snow-code` primary

### 3. User Messages
- [ ] Welcome messages say "Snow-Code"
- [ ] CLI examples use `snow-code` command
- [ ] Documentation references `snow-code`

### 4. Environment Variables
- [ ] Config vars support both `SNOWCODE_*` and `OPENCODE_*`
- [ ] Primary check is `SNOWCODE_*`, fallback is `OPENCODE_*`

### 5. Dependencies
- [ ] No `catalog:` references (causes npm publish errors)
- [ ] Run `bun script/resolve-catalog.ts` before publish

---

## 🔄 Merge Workflow

```bash
# 1. Merge upstream
git fetch upstream
git merge upstream/main

# 2. Fix branding issues
grep -r "OPENCODE_VERSION\|OPENCODE_CHANNEL" packages/opencode/script/
grep -r "user-agent.*opencode" packages/opencode/script/

# 3. Test build
cd packages/opencode
bun run build

# 4. Test version
./dist/snow-code-darwin-arm64/bin/snow-code --version
# Should show version number, NOT "local"

# 5. Resolve catalog before publish
bun script/resolve-catalog.ts

# 6. Publish
npm version patch
npm publish --ignore-scripts
```

---

## 📝 Examples

### ✅ Good Branding
```typescript
// src/installation/index.ts
export const VERSION = typeof SNOWCODE_VERSION === "string" ? SNOWCODE_VERSION : "local"
export const USER_AGENT = `snowcode/${VERSION}`

// script/build.ts
define: {
  SNOWCODE_VERSION: `'${Script.version}'`,
  SNOWCODE_CHANNEL: `'${Script.channel}'`,
}
execArgv: [`--user-agent=snowcode/${Script.version}`]

// src/flag/flag.ts
export const CONFIG_DIR = process.env["SNOWCODE_CONFIG_DIR"]
export const AUTO_SHARE = truthy("SNOWCODE_AUTO_SHARE")
export const DISABLE_AUTOUPDATE = truthy("SNOWCODE_DISABLE_AUTOUPDATE")
```

### ❌ Bad Branding
```typescript
// ❌ WRONG - mismatched names
define: { OPENCODE_VERSION: version }
typeof SNOWCODE_VERSION === "string"  // Will always be false!

// ❌ WRONG - OpenCode user-agent
execArgv: [`--user-agent=opencode/${version}`]

// ❌ WRONG - Using OPENCODE_ env vars
export const CONFIG_DIR = process.env["OPENCODE_CONFIG_DIR"]  // NO!
export const AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")       // NO!

// ❌ WRONG - Fallback to OPENCODE_
export const CONFIG_DIR =
  process.env["SNOWCODE_CONFIG_DIR"] ||
  process.env["OPENCODE_CONFIG_DIR"]  // NO backwards compat!
```

---

## 🎯 Quick Reference

| Category | Use SNOWCODE | Use OPENCODE | Notes |
|----------|--------------|--------------|-------|
| Build constants (VERSION, CHANNEL) | ✅ MUST | ❌ NEVER | Causes "local" version bug |
| User-agent strings | ✅ MUST | ❌ NEVER | User-facing analytics |
| Package metadata | ✅ MUST | ❌ NEVER | Fork identity |
| User messages | ✅ MUST | ❌ NEVER | User-facing branding |
| **ALL** env vars | ✅ MUST | ❌ NEVER | SNOWCODE_* only! |
| Internal build paths | ⚠️ Optional | ✅ OK | Only if purely internal |

---

## 📖 Rationale

**Why NO OpenCode references:**
1. **This is a FORK:** Snow-Code is NOT OpenCode - users need to know what they're using
2. **User confusion:** OPENCODE_ vars imply they're using OpenCode (they're not!)
3. **Version tracking:** Correct branding = correct debugging info
4. **Analytics:** Track Snow-Code usage, not OpenCode
5. **Support:** Users need Snow-Code docs/support, not OpenCode
6. **Clean break:** No ambiguity - all SNOWCODE_, all the time

---

## 🆘 Recovery

If version shows "local" after upstream merge:

```bash
# 1. Check build defines
grep "OPENCODE_VERSION\|SNOWCODE_VERSION" packages/opencode/script/build.ts

# 2. Check runtime code
grep "OPENCODE_VERSION\|SNOWCODE_VERSION" packages/opencode/src/installation/index.ts

# 3. Must match:
# build.ts: SNOWCODE_VERSION (in define block)
# installation/index.ts: SNOWCODE_VERSION (in typeof check)

# 4. Rebuild and test
bun run build
./dist/snow-code-*/bin/snow-code --version
```

---

**Last Updated:** 2025-11-05
**Maintained By:** Snow-Flow Team (@groeimetai)
