# Release Command

Create a new patch release (bug fixes) of snow-code.

## What this does:

1. Bumps version from X.Y.Z to X.Y.(Z+1) (e.g., 1.0.52 → 1.0.53)
2. Updates package.json and bun.lock
3. Creates git commit with message: "chore: Bump version to X.Y.Z"
4. Creates git tag: vX.Y.Z
5. Pushes commits and tags to GitHub

## Instructions:

Navigate to the snowcode package directory and run the release script:

```bash
cd packages/snowcode && bun run release
```

After the release is complete, inform the user of:
- The new version number
- The commit hash
- The GitHub release URL: https://github.com/groeimetai/snow-code/releases/tag/vX.Y.Z

## When to use:

- Bug fixes
- Small improvements
- Documentation updates
- Minor patches

For new features, use `/release-minor` instead.
For breaking changes, use `/release-major` instead.
