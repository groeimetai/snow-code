# Snow-Code Branding Guidelines

**Snow-Code is a fork of OpenCode** - These guidelines ensure proper branding while maintaining compatibility.

## ✅ MUST Change (User-Facing Branding)

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

---

## ⚠️ Keep for Backwards Compatibility

### Environment Variables
Support **BOTH** variants for compatibility:

```typescript
// ✅ CORRECT - Support both
export const CONFIG_DIR =
  process.env["SNOWCODE_CONFIG_DIR"] ||   // ← Primary
  process.env["OPENCODE_CONFIG_DIR"]      // ← Fallback

// ✅ CORRECT - Support both
export const AUTO_SHARE =
  truthy("SNOWCODE_AUTO_SHARE") ||
  truthy("OPENCODE_AUTO_SHARE")
```

**Rationale:** Users may have existing scripts/configs with OPENCODE_ vars.

### Feature Flags
```typescript
// ⚠️ Keep OPENCODE_ for these (internal, not user-facing):
OPENCODE_DISABLE_AUTOUPDATE
OPENCODE_DISABLE_PRUNE
OPENCODE_EXPERIMENTAL_WATCHER
OPENCODE_DISABLE_LSP_DOWNLOAD
// etc.
```

**Rationale:** These are opt-in experimental flags, changing breaks existing users.

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
export const CONFIG_DIR =
  process.env["SNOWCODE_CONFIG_DIR"] ||
  process.env["OPENCODE_CONFIG_DIR"]  // backwards compat
```

### ❌ Bad Branding
```typescript
// ❌ WRONG - mismatched names
define: { OPENCODE_VERSION: version }
typeof SNOWCODE_VERSION === "string"  // Will always be false!

// ❌ WRONG - OpenCode user-agent
execArgv: [`--user-agent=opencode/${version}`]

// ❌ WRONG - no backwards compat
export const CONFIG_DIR = process.env["SNOWCODE_CONFIG_DIR"]  // Breaks existing users!
```

---

## 🎯 Quick Reference

| Category | Use SNOWCODE | Use OPENCODE | Use Both |
|----------|--------------|--------------|----------|
| Build constants (VERSION, CHANNEL) | ✅ | ❌ | ❌ |
| User-agent strings | ✅ | ❌ | ❌ |
| Package metadata | ✅ | ❌ | ❌ |
| User messages | ✅ | ❌ | ❌ |
| Config env vars | ✅ (primary) | ✅ (fallback) | ✅ |
| Feature flag env vars | ⚠️ | ✅ (keep) | ⚠️ |
| Internal paths | ⚠️ | ✅ (OK) | ⚠️ |

---

## 📖 Rationale

**Why fork branding matters:**
1. **User confusion:** Users should know they're using Snow-Code, not OpenCode
2. **Version tracking:** `--version` must show correct version for debugging
3. **Analytics:** User-agent helps track Snow-Code vs OpenCode usage
4. **Support:** Users need correct docs/support channels

**Why backwards compatibility matters:**
1. **Existing users:** Many have `OPENCODE_*` env vars in CI/CD
2. **Documentation:** Existing tutorials reference `OPENCODE_*`
3. **Gradual migration:** Users can migrate at their own pace
4. **Less breaking changes:** Smooth upgrade experience

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
