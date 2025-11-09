# Snow-Code Rebranding Analysis

**Date:** November 8, 2025
**Status:** 🔴 Critical - OpenCode branding still present
**Priority:** High - Must be completed before public release

---

## Executive Summary

Snow-Code is a fork of OpenCode but still contains **extensive OpenCode branding** throughout the codebase. This analysis identifies all locations where "opencode" appears and provides a systematic replacement plan.

**Impact:**
- **User confusion:** Users think they're using OpenCode
- **Support issues:** Users file issues with wrong project
- **Analytics:** Cannot track Snow-Code vs OpenCode usage
- **Brand identity:** Snow-Code needs distinct identity

---

## 📊 Analysis Results

### Statistics

```
Total files searched: 524
Files with "opencode" references: ~100+
Directories with "opencode" in path: 4 major directories
Package.json files affected: 13
```

---

## 🎯 Critical Changes Required

### 1. Directory Structure

#### Must Rename:

| Current Path | New Path | Impact |
|-------------|----------|--------|
| `.opencode/` | `.snowcode/` | **HIGH** - Config directory, affects all tools |
| `packages/opencode/` | `packages/snowcode/` | **CRITICAL** - Main package |
| `packages/tui/cmd/opencode/` | `packages/tui/cmd/snowcode/` | **HIGH** - TUI binary |
| `packages/tui/internal/theme/themes/opencode.json` | `snowcode.json` | **MEDIUM** - Theme file |

**Cascading Effects:**
- All imports must update
- All path references must update
- Build scripts must update
- CI/CD must update

---

### 2. Binary & Command Names

#### Must Rename:

| Current | New | Location |
|---------|-----|----------|
| `opencode` | `snowcode` or `snow-code` | `packages/opencode/bin/` |
| `opencode.cmd` | `snowcode.cmd` | Windows batch file |
| `packages/tui/cmd/opencode/main.go` | `cmd/snowcode/main.go` | Go binary |

**Note:** Consider keeping `opencode` as symlink for backwards compat (short term only)

---

### 3. Package Names (package.json)

#### Files Requiring Updates:

```
./package.json
./packages/opencode/package.json          ⚠️ CRITICAL
./packages/web/package.json
./packages/desktop/package.json
./packages/function/package.json
./packages/script/package.json
./packages/slack/package.json
./packages/console/*/package.json (5 files)
./sdks/vscode/package.json                ⚠️ CRITICAL
```

#### Changes Needed:

```json
// Before
{
  "name": "opencode",
  "displayName": "opencode",
  "description": "opencode for VS Code"
}

// After
{
  "name": "@groeimetai/snow-code",
  "displayName": "Snow-Code",
  "description": "Snow-Code for VS Code"
}
```

---

### 4. VS Code Extension

**Location:** `sdks/vscode/`

**Files to Update:**
- `package.json` - Name, display name, description
- `README.md` - All documentation
- `src/extension.ts` - Command names, terminal names, env vars

#### Current Issues:

```typescript
// ❌ WRONG - OpenCode branding
const TERMINAL_NAME = "opencode";
vscode.commands.registerCommand("opencode.openTerminal", ...)
vscode.commands.registerCommand("opencode.openNewTerminal", ...)
OPENCODE_CALLER: "vscode"

// ✅ CORRECT - Snow-Code branding
const TERMINAL_NAME = "snow-code";
vscode.commands.registerCommand("snowcode.openTerminal", ...)
vscode.commands.registerCommand("snowcode.openNewTerminal", ...)
SNOWCODE_CALLER: "vscode"
```

---

### 5. Infrastructure & Domains

**Location:** `infra/stage.ts`

```typescript
// ❌ WRONG - OpenCode domains
if ($app.stage === "production") return "opencode.ai"
if ($app.stage === "dev") return "dev.opencode.ai"
return `${$app.stage}.dev.opencode.ai`

// ✅ CORRECT - Snow-Code domains
if ($app.stage === "production") return "snow-code.ai"  // Or your domain
if ($app.stage === "dev") return "dev.snow-code.ai"
return `${$app.stage}.dev.snow-code.ai`
```

---

### 6. Environment Variables

**Critical:** Many scripts still check `OPENCODE_*` vars

#### Current State:

```typescript
// ❌ Found in code
process.env["OPENCODE_VERSION"]
process.env["OPENCODE_CHANNEL"]
process.env["OPENCODE_CONFIG_DIR"]
process.env["OPENCODE_AUTO_SHARE"]
process.env["OPENCODE_CALLER"]
process.env["_EXTENSION_OPENCODE_PORT"]
```

#### Required Changes:

```typescript
// ✅ Primary should be SNOWCODE_
export const VERSION = process.env["SNOWCODE_VERSION"] || process.env["OPENCODE_VERSION"]  // Fallback for compat
export const CHANNEL = process.env["SNOWCODE_CHANNEL"] || process.env["OPENCODE_CHANNEL"]
export const CONFIG_DIR = process.env["SNOWCODE_CONFIG_DIR"] || process.env["OPENCODE_CONFIG_DIR"]

// ⚠️ After 6 months, remove OPENCODE_ fallbacks
```

---

### 7. Documentation Files

#### Files with OpenCode References:

```
./README.md                     ✅ Already mentions Snow-Code fork
./BRANDING-GUIDELINES.md        ✅ Intentional (explains what NOT to do)
./sdks/vscode/README.md         ❌ Needs full rewrite
./specs/project.md              ❌ Mentions "opencode instance"
./CODESPACES_AUTH_FIX.md        ❌ Path references
```

---

### 8. Build & Publish Scripts

**Location:** `script/`

#### Issues:

```typescript
// script/publish.ts
import { createOpencode } from "@groeimetai/snow-code-sdk"  // ✅ OK
const opencode = await createOpencode()                      // ❌ Variable name
const previous = await fetch("https://registry.npmjs.org/opencode-ai/latest")  // ❌ NPM package

// script/stats.ts
const url = `https://api.github.com/repos/sst/opencode/releases`  // ❌ GitHub repo
const npmDownloads = await fetchNpmDownloads("opencode-ai")        // ❌ NPM package
```

#### Required Changes:

```typescript
// ✅ CORRECT
const snowcode = await createSnowCode()
const previous = await fetch("https://registry.npmjs.org/@groeimetai/snow-code/latest")
const url = `https://api.github.com/repos/groeimetai/snow-code/releases`
const npmDownloads = await fetchNpmDownloads("@groeimetai/snow-code")
```

---

### 9. Configuration Files

#### Root Config

```json
// opencode.json (at root)
{
  "name": "opencode",      // ❌ Should be "snow-code"
  // ...
}
```

#### Turbo Config

```json
// turbo.json
{
  "tasks": {
    "opencode#test": { ... }  // ❌ Should be "snowcode#test"
  }
}
```

#### SST Config

```typescript
// sst.config.ts
{
  name: "opencode",  // ❌ Should be "snow-code"
  // ...
}
```

---

## 🔧 Implementation Plan

### Phase 1: Critical Paths (Week 1)

**Priority: CRITICAL - Breaks functionality if not fixed**

1. ✅ **Rename directories:**
   ```bash
   mv .opencode .snowcode
   mv packages/opencode packages/snowcode
   mv packages/tui/cmd/opencode packages/tui/cmd/snowcode
   ```

2. ✅ **Update all imports:**
   ```bash
   # Find and replace all import paths
   find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
     -not -path "*/node_modules/*" \
     -exec sed -i '' 's|from.*opencode/|from snowcode/|g' {} \;
   ```

3. ✅ **Update package.json files:**
   - Main package name
   - All dependencies referencing opencode
   - Workspace references

4. ✅ **Update binary names:**
   - Rename executables
   - Update build scripts
   - Update PATH references

### Phase 2: User-Facing Changes (Week 1)

**Priority: HIGH - User confusion**

1. ✅ **VS Code Extension:**
   - Rename commands
   - Update display names
   - Update marketplace listing

2. ✅ **Documentation:**
   - README files
   - Getting started guides
   - API documentation

3. ✅ **Environment Variables:**
   - Primary: SNOWCODE_*
   - Fallback: OPENCODE_* (temporary, 6 months)
   - Deprecation warnings

### Phase 3: Infrastructure (Week 2)

**Priority: MEDIUM - Affects deployment**

1. ✅ **Domains:**
   - Update stage.ts
   - Configure DNS
   - Update SSL certs

2. ✅ **CI/CD:**
   - Update GitHub Actions
   - Update artifact names
   - Update release scripts

3. ✅ **Analytics:**
   - Update tracking IDs
   - Separate OpenCode/Snow-Code metrics

### Phase 4: Cleanup (Week 2)

**Priority: LOW - Polish**

1. ✅ **Remove backwards compat:**
   - Remove opencode symlinks
   - Remove OPENCODE_* env var fallbacks
   - Remove old binary names

2. ✅ **Update comments:**
   - Code comments mentioning OpenCode
   - TODO comments
   - Documentation snippets

---

## ⚠️ Backwards Compatibility Strategy

### Keep for 6 Months (Deprecation Period):

1. **Binary symlinks:**
   ```bash
   ln -s snowcode opencode    # Symlink old name to new
   ```

2. **Environment variables:**
   ```typescript
   const CONFIG_DIR =
     process.env["SNOWCODE_CONFIG_DIR"] ||  // Primary
     process.env["OPENCODE_CONFIG_DIR"]     // Fallback (warn user)
   ```

3. **Config directory:**
   ```typescript
   // Check both locations
   const configDirs = [
     "~/.snowcode",     // Primary
     "~/.opencode"      // Fallback (migrate automatically)
   ]
   ```

### Deprecation Warnings:

```typescript
if (process.env["OPENCODE_VERSION"]) {
  console.warn(`
    ⚠️ DEPRECATION WARNING:
    OPENCODE_* environment variables are deprecated.
    Please use SNOWCODE_* instead.
    Support for OPENCODE_* will be removed in version 2.0.0
  `)
}
```

---

## 🚨 Breaking Changes Checklist

Before renaming, ensure these are handled:

- [ ] All CI/CD pipelines updated
- [ ] All deployment scripts updated
- [ ] All documentation updated
- [ ] Migration guide written for users
- [ ] Deprecation warnings in place
- [ ] Backwards compat tested
- [ ] Release notes prepared
- [ ] Team notified of breaking changes

---

## 📝 Migration Guide for Users

### For CLI Users

```bash
# Old way
$ opencode

# New way
$ snow-code
# or
$ snowcode

# Config migration (automatic)
# Old: ~/.opencode/
# New: ~/.snowcode/ (auto-migrated on first run)
```

### For VS Code Extension Users

1. Uninstall old extension: `opencode`
2. Install new extension: `@groeimetai/snow-code`
3. Commands auto-update:
   - Old: `opencode.openTerminal`
   - New: `snowcode.openTerminal`

### For Developers/Contributors

1. **Update git remote:**
   ```bash
   git remote set-url origin https://github.com/groeimetai/snow-code.git
   ```

2. **Update imports:**
   ```typescript
   // Old
   import { Tool } from "opencode/tool"

   // New
   import { Tool } from "@groeimetai/snow-code/tool"
   ```

3. **Update env vars:**
   ```bash
   # Old
   export OPENCODE_CONFIG_DIR=~/.opencode

   # New
   export SNOWCODE_CONFIG_DIR=~/.snowcode
   ```

---

## 🎯 Success Criteria

**Rebranding is complete when:**

- [ ] Zero "opencode" references in user-facing code
- [ ] Zero "opencode" references in user-facing docs
- [ ] All binaries named "snow-code" or "snowcode"
- [ ] All package names prefixed "@groeimetai/snow-code"
- [ ] All environment variables prefixed "SNOWCODE_"
- [ ] VS Code extension published as "@groeimetai/snow-code"
- [ ] Domain points to snow-code.ai (or chosen domain)
- [ ] GitHub repo is groeimetai/snow-code
- [ ] NPM package is @groeimetai/snow-code
- [ ] All CI/CD uses new names
- [ ] Migration guide published
- [ ] Deprecation warnings in place for backwards compat

---

## 📊 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing installations | High | High | Deprecation period + symlinks |
| VS Code extension conflicts | Medium | Medium | New extension ID |
| Lost users (can't find new name) | Medium | High | Communication + redirect |
| CI/CD failures | High | High | Update all pipelines first |
| Lost analytics/metrics | Low | Medium | Separate tracking from day 1 |

---

## 📅 Timeline

**Week 1: Critical Paths + User-Facing**
- Days 1-2: Rename directories and update imports
- Days 3-4: Update package.json and binaries
- Day 5: Update VS Code extension

**Week 2: Infrastructure + Cleanup**
- Days 6-7: Infrastructure and domains
- Days 8-9: CI/CD and deployment
- Day 10: Final testing and release

**Ongoing: Deprecation Period (6 months)**
- Monitor usage of old names
- Send deprecation warnings
- Assist users with migration
- Remove backwards compat in version 2.0.0

---

## 🔍 Automated Checks

### Pre-Commit Hook

```bash
#!/bin/bash
# .husky/pre-commit

# Check for OpenCode references in staged files
if git diff --cached --name-only | xargs grep -i "opencode" 2>/dev/null; then
  echo "❌ ERROR: OpenCode references found in staged files"
  echo "Please replace with Snow-Code"
  exit 1
fi
```

### CI Check

```yaml
# .github/workflows/branding-check.yml
name: Branding Check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check for OpenCode references
        run: |
          if grep -r "opencode" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules .; then
            echo "❌ Found OpenCode references"
            exit 1
          fi
```

---

## 📞 Next Steps

1. **Review this analysis** with team
2. **Approve rebranding plan**
3. **Schedule implementation** (2 weeks)
4. **Communicate to users** (blog post, email)
5. **Execute Phase 1** (critical paths)
6. **Execute Phase 2** (user-facing)
7. **Execute Phase 3** (infrastructure)
8. **Monitor migration** (6 months)

---

**Status:** 🔴 Awaiting approval to proceed with rebranding implementation
