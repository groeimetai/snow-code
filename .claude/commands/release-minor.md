# Release Minor Command

Create a new minor release (new features) of snow-code.

## What this does:

1. Bumps version from X.Y.Z to X.(Y+1).0 (e.g., 1.0.52 → 1.1.0)
2. Updates package.json and bun.lock
3. Creates git commit with message: "chore: Bump version to X.Y.0"
4. Creates git tag: vX.Y.0
5. Pushes commits and tags to GitHub

## Instructions:

Navigate to the snowcode package directory and run the minor release script:

```bash
cd packages/snowcode && bun run release:minor
```

After the release is complete, inform the user of:
- The new version number
- The commit hash
- The GitHub release URL: https://github.com/groeimetai/snow-code/releases/tag/vX.Y.0

## When to use:

- New features
- Significant enhancements
- New capabilities
- API additions (backwards compatible)

For bug fixes, use `/release` instead.
For breaking changes, use `/release-major` instead.
