# Release Major Command

Create a new major release (breaking changes) of snow-code.

## What this does:

1. Bumps version from X.Y.Z to (X+1).0.0 (e.g., 1.0.52 → 2.0.0)
2. Updates package.json and bun.lock
3. Creates git commit with message: "chore: Bump version to X.0.0"
4. Creates git tag: vX.0.0
5. Pushes commits and tags to GitHub

## Instructions:

Navigate to the snowcode package directory and run the major release script:

```bash
cd packages/snowcode && bun run release:major
```

After the release is complete, inform the user of:
- The new version number
- The commit hash
- The GitHub release URL: https://github.com/groeimetai/snow-code/releases/tag/vX.0.0

## When to use:

- Breaking API changes
- Major architecture changes
- Incompatible updates
- Removal of deprecated features

⚠️ **Warning**: Major releases may break existing integrations. Make sure to:
- Update CHANGELOG.md with breaking changes
- Document migration path for users
- Consider deprecation period for removed features

For new features, use `/release-minor` instead.
For bug fixes, use `/release` instead.
