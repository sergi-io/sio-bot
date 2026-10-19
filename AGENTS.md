# Repository Guidelines

## Project Structure & Module Organization

Core code lives in `src/`, organized by domain modules: `siobot/` (runtime orchestration), `strategies/` (enter/exit strategy logic), `exchanges/` (exchange adapters), `backtester/`, `risk/`, `ta/`, and shared helpers in `utils/`.
Tests are colocated with source as `*.test.ts` files (for example `src/utils/date.test.ts`).
Operational scripts are in `scripts/`. Runtime artifacts and datasets are stored in `build/`, `data/`, `historicalData/`, and `outputs/`. Legacy code is isolated in `old/` and excluded from TypeScript checks.
Bot configuration lives on bot-config.json file.

Unit testing for this project is not needed.

## Build, Test, and Development Commands

- `bun run dev`: generate journal templates, then run the bot in watch mode from `src/main.ts`.
- `bun run test`: run all Bun tests.
- `bun run lint`: run ESLint on `src/` with warnings treated as failures.
- `bun run typecheck`: strict TypeScript checking with no emit.
- `bun run build`: compile a Linux x64 Bun binary to `build/x64/sio-bot`.

## Coding Style & Naming Conventions

Use 2-space indentation, LF line endings, semicolons, single quotes, and 100-char line width (`.editorconfig`, `.prettierrc`).
Prefer TypeScript with strict types (`tsconfig.json` uses `strict: true`).
Naming patterns:

- Classes/types: `PascalCase` (`RiskManager.ts`)
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Tests: `<module>.test.ts`

## Testing Guidelines

Testing uses Bun (`bun test`). Keep tests next to implementation files and cover strategy logic, risk logic, and utility edge cases.
There is no enforced coverage threshold; contributors should add or update tests for behavior changes before opening a PR.

## Commit & Pull Request Guidelines

Recent history follows Conventional-Commit style prefixes like `refactor:`, `feat:`, `fix:` with concise, imperative summaries.
Before opening a PR, run:

- `bun run lint`
- `bun run typecheck`
- `bun run test`

Never generate PRs, nor commit any files to the repository that are not manually reviewed and approved by a human.

## Security & Configuration Tips

Never commit secrets. Use `.env-sample` as the baseline and keep real values in local `.env`.
Treat `bot-config.json` changes as high-impact; document rationale in the PR.

# Dependencies

This project uses sio-Nexus for getting real-time market data and historical data for backtesting.
The bot is designed to be modular, allowing for easy integration of additional data sources or exchanges in the future.
sio-Nexus project is located at ../sio-nexus/ and uses Unix socket communication to provide data to the bot. The bot connects to the Nexus server, subscribes to the necessary data streams, and processes the incoming data for trading decisions.
