# Snow-Code Rebranding Execution Checklist

**Date:** November 8, 2025
**Status:** 🔴 Ready to Execute
**Estimated Time:** 4-6 hours

---

## 🎯 Goal

Remove ALL "opencode" branding and replace with "snow-code" or "snowcode".

---

## ✅ Pre-Flight Checks

Before starting, ensure:

- [ ] All changes committed to git
- [ ] Created backup branch: `git checkout -b backup-before-rebrand`
- [ ] Created working branch: `git checkout -b rebrand-to-snowcode`
- [ ] No uncommitted changes: `git status`
- [ ] All tests passing: `bun test`
- [ ] Build successful: `bun run build`

---

## 📋 Execution Checklist

### Step 1: Rename Directories (CRITICAL - Do First!)

**⚠️ WARNING:** These renames will break imports temporarily. Fix imports immediately after!

```bash
cd /Users/nielsvanderwerf/snow-code

# 1.1 Rename config directory
mv .opencode .snowcode

# 1.2 Rename main package directory
mv packages/opencode packages/snowcode

# 1.3 Rename TUI command directory
mv packages/tui/cmd/opencode packages/tui/cmd/snowcode

# 1.4 Rename theme file
mv packages/tui/internal/theme/themes/opencode.json packages/tui/internal/theme/themes/snowcode.json
```

**Verification:**
```bash
# Should return 0 results
find . -type d -name "*opencode*" | grep -v node_modules | grep -v .git
```

- [ ] `.opencode/` → `.snowcode/`
- [ ] `packages/opencode/` → `packages/snowcode/`
- [ ] `packages/tui/cmd/opencode/` → `packages/tui/cmd/snowcode/`
- [ ] `opencode.json` theme → `snowcode.json`

---

### Step 2: Rename Binary Files

```bash
cd /Users/nielsvanderwerf/snow-code

# 2.1 Rename Windows batch file
mv packages/snowcode/bin/opencode.cmd packages/snowcode/bin/snowcode.cmd

# 2.2 Update symlinks if they exist
cd packages/snowcode/bin
rm -f opencode 2>/dev/null
ln -s snow-code snowcode  # Create snowcode symlink
```

**Verification:**
```bash
ls -la packages/snowcode/bin/
# Should show: snow-code, snowcode, snowcode.cmd
```

- [ ] `opencode.cmd` → `snowcode.cmd`
- [ ] Created `snowcode` symlink to `snow-code`

---

### Step 3: Update All Import Paths

```bash
cd /Users/nielsvanderwerf/snow-code

# 3.1 Update TypeScript/JavaScript imports
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -exec sed -i '' 's|packages/opencode/|packages/snowcode/|g' {} \;

# 3.2 Update from statements
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -exec sed -i '' 's|from "opencode/|from "snowcode/|g' {} \;

# 3.3 Update import statements
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -exec sed -i '' 's|import.*opencode/|import snowcode/|g' {} \;
```

**Verification:**
```bash
# Should find ZERO results (except BRANDING-GUIDELINES.md which is intentional)
grep -r "from.*opencode/" --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude=BRANDING-GUIDELINES.md
```

- [ ] All `packages/opencode/` imports updated
- [ ] All `from "opencode/` imports updated
- [ ] Zero broken imports (except intentional docs)

---

### Step 4: Update Package.json Files

**Files to update manually (13 files):**

#### 4.1 Root package.json
```json
{
  "name": "snow-code",  // Was: "opencode"
  // ...
}
```

#### 4.2 packages/snowcode/package.json (CRITICAL)
```json
{
  "name": "@groeimetai/snow-code",  // Was: "opencode"
  "bin": {
    "snow-code": "./bin/snow-code",
    "snowcode": "./bin/snowcode"      // Add this
  },
  // ...
}
```

#### 4.3 sdks/vscode/package.json (CRITICAL)
```json
{
  "name": "snow-code-vscode",  // Was: "opencode"
  "displayName": "Snow-Code",
  "description": "Snow-Code for VS Code",
  "publisher": "groeimetai",
  "repository": {
    "url": "https://github.com/groeimetai/snow-code"
  },
  "contributes": {
    "commands": [
      {
        "command": "snowcode.openTerminal",      // Was: opencode.openTerminal
        "title": "Open Snow-Code"
      },
      {
        "command": "snowcode.openNewTerminal",   // Was: opencode.openNewTerminal
        "title": "Open Snow-Code in new tab"
      }
    ]
  }
}
```

#### 4.4 Other package.json files
Update these files, replace "opencode" references:
- `./packages/web/package.json`
- `./packages/desktop/package.json`
- `./packages/function/package.json`
- `./packages/script/package.json`
- `./packages/slack/package.json`
- `./packages/console/core/package.json`
- `./packages/console/app/package.json`
- `./packages/console/mail/package.json`
- `./packages/console/function/package.json`
- `./packages/console/resource/package.json`

**Automated helper:**
```bash
# Find all package.json with opencode references
find . -name "package.json" -not -path "*/node_modules/*" \
  -exec grep -l "opencode" {} \;
```

Checklist:
- [ ] Root package.json
- [ ] packages/snowcode/package.json
- [ ] sdks/vscode/package.json
- [ ] All other package.json files (10 remaining)

---

### Step 5: Update Environment Variables

Update all files that reference OPENCODE_* env vars to use SNOWCODE_* with fallback:

```bash
# Find files with OPENCODE_ env vars
grep -r "OPENCODE_" --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git
```

**Pattern to use:**
```typescript
// OLD:
const VERSION = process.env["OPENCODE_VERSION"]

// NEW:
const VERSION = process.env["SNOWCODE_VERSION"] || process.env["OPENCODE_VERSION"]
// Add deprecation warning if OPENCODE_ is used
if (process.env["OPENCODE_VERSION"] && !process.env["SNOWCODE_VERSION"]) {
  console.warn("OPENCODE_* env vars are deprecated. Use SNOWCODE_* instead.")
}
```

**Files to update (found in search):**
- `sdks/vscode/src/extension.ts` - `OPENCODE_CALLER` → `SNOWCODE_CALLER`
- `sdks/vscode/src/extension.ts` - `_EXTENSION_OPENCODE_PORT` → `_EXTENSION_SNOWCODE_PORT`
- Any other files found in grep search

Checklist:
- [ ] All OPENCODE_* replaced with SNOWCODE_* (with fallback)
- [ ] Deprecation warnings added
- [ ] VS Code extension updated

---

### Step 6: Update VS Code Extension Code

**File:** `sdks/vscode/src/extension.ts`

```typescript
// OLD:
const TERMINAL_NAME = "opencode";
vscode.commands.registerCommand("opencode.openTerminal", ...)
vscode.commands.registerCommand("opencode.openNewTerminal", ...)
vscode.commands.registerCommand("opencode.addFilepathToTerminal", ...)
terminal.sendText(`opencode --port ${port}`);

// NEW:
const TERMINAL_NAME = "snow-code";
vscode.commands.registerCommand("snowcode.openTerminal", ...)
vscode.commands.registerCommand("snowcode.openNewTerminal", ...)
vscode.commands.registerCommand("snowcode.addFilepathToTerminal", ...)
terminal.sendText(`snow-code --port ${port}`);
```

Checklist:
- [ ] TERMINAL_NAME updated
- [ ] All command IDs updated (3 commands)
- [ ] Terminal command updated
- [ ] Environment variables updated

---

### Step 7: Update Documentation

#### 7.1 VS Code Extension README
**File:** `sdks/vscode/README.md`

Replace ALL opencode references with snow-code.

#### 7.2 Main README
**File:** `./README.md`

Already mentions fork, but ensure consistent branding.

#### 7.3 Specs
**File:** `./specs/project.md`

Replace "opencode instance" with "snow-code instance".

#### 7.4 Codespaces Fix
**File:** `./CODESPACES_AUTH_FIX.md`

Update path: `packages/opencode/src/auth/` → `packages/snowcode/src/auth/`

Checklist:
- [ ] sdks/vscode/README.md
- [ ] Root README.md
- [ ] specs/project.md
- [ ] CODESPACES_AUTH_FIX.md

---

### Step 8: Update Configuration Files

#### 8.1 Root opencode.json
**File:** `./opencode.json`

```json
{
  "name": "snow-code",  // Was: "opencode"
  // ...
}
```

#### 8.2 Turbo Config
**File:** `./turbo.json`

```json
{
  "tasks": {
    "snowcode#test": { ... }  // Was: "opencode#test"
  }
}
```

#### 8.3 SST Config
**File:** `./sst.config.ts`

```typescript
{
  name: "snow-code",  // Was: "opencode"
  // ...
}
```

Checklist:
- [ ] opencode.json → Update name
- [ ] turbo.json → Update task name
- [ ] sst.config.ts → Update name

---

### Step 9: Update Infrastructure

**File:** `./infra/stage.ts`

```typescript
// OLD:
if ($app.stage === "production") return "opencode.ai"
if ($app.stage === "dev") return "dev.opencode.ai"
return `${$app.stage}.dev.opencode.ai`

// NEW:
if ($app.stage === "production") return "snow-code.dev"  // Or your domain
if ($app.stage === "dev") return "dev.snow-code.dev"
return `${$app.stage}.dev.snow-code.dev`
```

**File:** `./infra/console.ts`

```typescript
{
  name: "snow-code",  // Was: "opencode"
  // ...
}
```

Checklist:
- [ ] infra/stage.ts domains updated
- [ ] infra/console.ts name updated

---

### Step 10: Update Build & Publish Scripts

#### 10.1 Publish Script
**File:** `./script/publish.ts`

```typescript
// OLD:
const previous = await fetch("https://registry.npmjs.org/opencode-ai/latest")
console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

// NEW:
const previous = await fetch("https://registry.npmjs.org/@groeimetai/snow-code/latest")
console.log("\n=== snow-code ===\n")
await import(`../packages/snowcode/script/publish.ts`)
```

#### 10.2 Stats Script
**File:** `./script/stats.ts`

```typescript
// OLD:
const url = `https://api.github.com/repos/sst/opencode/releases`
const npmDownloads = await fetchNpmDownloads("opencode-ai")

// NEW:
const url = `https://api.github.com/repos/groeimetai/snow-code/releases`
const npmDownloads = await fetchNpmDownloads("@groeimetai/snow-code")
```

Checklist:
- [ ] script/publish.ts updated
- [ ] script/stats.ts updated
- [ ] Any other scripts in script/ directory

---

### Step 11: Update Go Code (TUI)

**File:** `packages/tui/cmd/snowcode/main.go` (already renamed in Step 1)

Update any internal references to "opencode" in the Go code.

```bash
grep -r "opencode" packages/tui/ --include="*.go"
```

Update any found references.

Checklist:
- [ ] Go code references updated
- [ ] No "opencode" strings in Go files

---

### Step 12: Final Verification

Run comprehensive checks:

```bash
cd /Users/nielsvanderwerf/snow-code

# 12.1 Check for remaining "opencode" in code (should only find BRANDING-GUIDELINES.md and this checklist)
grep -r "opencode" --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude=BRANDING-GUIDELINES.md --exclude=REBRANDING_ANALYSIS.md --exclude=REBRANDING_CHECKLIST.md

# 12.2 Check for "opencode" in package.json files (should be ZERO)
find . -name "package.json" -not -path "*/node_modules/*" -exec grep "opencode" {} \; -print

# 12.3 Check directory names
find . -type d -name "*opencode*" | grep -v node_modules | grep -v .git

# 12.4 Check file names
find . -type f -name "*opencode*" | grep -v node_modules | grep -v .git

# 12.5 Rebuild and test
bun install  # Reinstall with new package names
bun run build
bun test

# 12.6 Check git diff
git diff --stat
git status
```

Checklist:
- [ ] Zero "opencode" in code (except docs)
- [ ] Zero "opencode" in package.json
- [ ] Zero "opencode" directories
- [ ] Zero "opencode" files (except intentional docs)
- [ ] Build successful
- [ ] Tests passing
- [ ] Git diff reviewed

---

## 🎯 Post-Execution Steps

### Commit Changes

```bash
git add -A
git commit -m "rebrand: Replace all OpenCode branding with Snow-Code

- Renamed directories: .opencode → .snowcode, packages/opencode → packages/snowcode
- Updated all package.json files with @groeimetai/snow-code
- Updated all imports and path references
- Updated VS Code extension commands and branding
- Updated environment variables (OPENCODE_* → SNOWCODE_* with fallback)
- Updated documentation and README files
- Updated infrastructure domains
- Updated build and publish scripts
- Added deprecation warnings for backwards compatibility

BREAKING CHANGES:
- Binary renamed: opencode → snow-code (symlink provided)
- Config directory: .opencode → .snowcode (auto-migration on first run)
- Package name: opencode → @groeimetai/snow-code
- VS Code commands: opencode.* → snowcode.*"
```

### Test Installation

```bash
# Test local installation
cd packages/snowcode
bun run build
npm link

# Test binary
snow-code --version
snowcode --version  # Should work via symlink

# Test config migration
rm -rf ~/.snowcode  # Clean test
snow-code  # Should auto-migrate from ~/.opencode if it exists
```

### Create Release

1. **Tag release:**
   ```bash
   git tag -a v2.0.0-rebrand -m "Rebrand from OpenCode to Snow-Code"
   git push origin rebrand-to-snowcode
   git push origin v2.0.0-rebrand
   ```

2. **Create PR:**
   - Title: "🎨 Rebrand: OpenCode → Snow-Code"
   - Description: Link to REBRANDING_ANALYSIS.md
   - Label: "breaking-change"

3. **Update documentation:**
   - Migration guide for users
   - Changelog with breaking changes
   - Updated installation instructions

---

## 📊 Final Checklist

- [ ] All 12 steps completed
- [ ] All sub-checklists completed
- [ ] Build successful
- [ ] Tests passing
- [ ] Git committed
- [ ] PR created
- [ ] Documentation updated
- [ ] Migration guide written
- [ ] Team notified

---

## 🚨 Rollback Plan

If something goes wrong:

```bash
# Revert to backup branch
git checkout backup-before-rebrand

# Or reset if already merged
git reset --hard HEAD~1  # Revert last commit
git push --force origin main  # DANGEROUS - only if needed
```

---

**Status:** ✅ Ready to execute
**Estimated Duration:** 4-6 hours
**Risk Level:** Medium (tested rollback available)
