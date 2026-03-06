# Contributing to @sanity/codegen

Thank you for your interest in contributing to `@sanity/codegen`! This package provides the codegen toolkit for [Sanity.io](https://www.sanity.io/), including TypeScript type generation from GROQ queries.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (see `engines` in `package.json` for supported versions)
- [pnpm](https://pnpm.io/) v10.x (see `packageManager` in `package.json` for the exact version)

### Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/codegen.git
   cd codegen
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build the project:

   ```bash
   pnpm build
   ```

## Development

### Project Structure

```
src/
├── _exports/          # Public API entry point
├── actions/           # Core typegen actions (generate, watch)
├── commands/          # CLI commands (oclif)
├── typescript/        # TypeScript type generation engine
├── utils/             # Shared utilities
├── readConfig.ts      # Configuration parsing
├── typeUtils.ts       # Public type utilities (Get, FilterByType)
└── typegen.telemetry.ts
dev/                   # Development sandbox (Sanity studio + schema)
test/                  # Test fixtures
bin/                   # CLI entry point (sanity-typegen)
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Compile with SWC and generate type declarations |
| `pnpm build:types` | Generate type declarations only (via `@sanity/pkg-utils`) |
| `pnpm test` | Run tests with Vitest |
| `pnpm lint` | Run ESLint with auto-fix |
| `pnpm watch` | Watch mode for development (SWC) |
| `pnpm clean` | Remove `dist/` and `coverage/` directories |

### Development Workflow

1. Create a feature branch:

   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes in `src/`.

3. Build and test:

   ```bash
   pnpm build
   pnpm test
   ```

4. Lint your code:

   ```bash
   pnpm lint
   ```

5. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/):

   ```bash
   git commit -m "feat: add support for new query syntax"
   ```

### Dev Sandbox

The `dev/` directory contains a Sanity studio configuration with a schema that can be used for manual testing. It includes a pre-generated `schema.json` and `sanity.types.ts` that you can regenerate to test your changes:

```bash
# Run typegen against the dev schema
./bin/run.js typegen generate --config-path dev
```

## Code Style

- **TypeScript** — all source code is written in TypeScript
- **ESLint** — linting is configured via `@sanity/eslint-config-cli`
- **Prettier** — code formatting with single quotes, no semicolons, and trailing commas
- **Husky + lint-staged** — pre-commit hooks automatically lint and format staged files

### API Documentation

All public exports must have JSDoc comments with a release tag (`@public`, `@beta`, or `@internal`). This is enforced by `@sanity/pkg-utils` via [API Extractor](https://api-extractor.com/). Run `pnpm build:types` to check for documentation issues.

## Testing

Tests are written with [Vitest](https://vitest.dev/) and located alongside source files in `__tests__/` directories.

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run a specific test file
pnpm test -- src/commands/typegen/__tests__/generate.test.ts
```

## Submitting a Pull Request

1. Make sure all tests pass: `pnpm test`
2. Make sure the build succeeds: `pnpm build`
3. Make sure linting passes: `pnpm lint`
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages:
   - `feat:` — new features (triggers minor version bump)
   - `fix:` — bug fixes (triggers patch version bump)
   - `chore:` — maintenance tasks (no version bump)
   - `docs:` — documentation changes (no version bump)
   - `refactor:` — code refactoring (no version bump)
   - `test:` — adding or updating tests (no version bump)
5. Open a pull request against the `main` branch
6. Fill in the PR description with what changed and why

## Releases

Releases are managed automatically by [Release Please](https://github.com/googleapis/release-please). When PRs are merged to `main`, Release Please creates a release PR that bumps the version and updates the changelog. Merging the release PR triggers the publish to npm.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
