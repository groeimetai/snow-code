#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

// Make platform binary executable after install AND fix broken symlinks
try {
  const platform = os.platform();
  const arch = os.arch();

  // Skip Windows
  if (platform === 'win32') {
    process.exit(0);
  }

  // Map Node.js arch to our naming
  const archMap = {
    'arm64': 'arm64',
    'x64': 'x64'
  };

  const mappedArch = archMap[arch];
  if (!mappedArch) {
    console.log(`Unknown architecture: ${arch}`);
    process.exit(0);
  }

  // Find binary in node_modules
  const binaryPackage = `@groeimetai/snow-code-${platform}-${mappedArch}`;
  const binaryPath = path.join(__dirname, 'node_modules', binaryPackage, 'bin', 'snow-code');

  // Fix broken symlinks from opencode->snow-code refactor
  // Check if this is a global install and fix symlinks
  const globalNodeModules = path.resolve(__dirname, '..', '..');
  const symlinkPath = path.join(globalNodeModules, binaryPackage);

  // Check if symlink exists (even if broken) using lstat
  try {
    const stats = fs.lstatSync(symlinkPath);

    if (stats.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(symlinkPath);

      // Check if link points to old 'opencode' path (broken after refactor)
      if (linkTarget.includes('/opencode/')) {
        const correctTarget = linkTarget.replace('/packages/opencode/', '/packages/snow-code/');

        // Check if correct target exists
        if (fs.existsSync(correctTarget)) {
          console.log(`🔧 Fixing broken symlink from refactor: ${binaryPackage}`);
          console.log(`   Old: ${linkTarget}`);
          console.log(`   New: ${correctTarget}`);

          // Remove broken symlink
          fs.unlinkSync(symlinkPath);

          // Create new symlink to correct location
          fs.symlinkSync(correctTarget, symlinkPath);
          console.log(`✅ Fixed symlink successfully`);
        }
      }
    }
  } catch (symlinkError) {
    // Symlink doesn't exist - that's fine, npm will handle it
  }

  if (fs.existsSync(binaryPath)) {
    fs.chmodSync(binaryPath, 0o755);
    console.log(`✅ Made ${binaryPackage} executable`);
  }
} catch (error) {
  // Silently fail - not critical
  console.log('Note: Could not set binary permissions (non-critical)');
}
