# backend-engineering-patterns

Small, runnable examples of backend engineering patterns: job queues, messaging, retries, and tested APIs.

Part of [snehalagrawal.com/work](https://snehalagrawal.com/work/). Each example is self-contained in its own folder, runs locally, and has a README with the exact setup it was tested with.

## Examples

| Example | What it shows | Status |
|---|---|---|
| [`express-api-testing/`](express-api-testing/) | An Express and MongoDB API tested against a real (in-memory) MongoDB: every endpoint and error path, 100% line coverage, CI on Node.js 22 and 24 | Ready (from [app-with-test-cases](https://github.com/SnehalAgrawal/app-with-test-cases)) |
| [`bullmq-producer-consumer/`](bullmq-producer-consumer/) | Producers and workers on a Redis-backed BullMQ queue: throughput vs concurrency, retries with exponential backoff, dead letters, duplicate prevention, and crash recovery, each measured; tests in CI | Ready |
| [`kafka-consumer-groups/`](kafka-consumer-groups/) | Kafka 4 consumer groups: partition assignment, rebalances under three protocols (including KIP-848), at-least-once delivery after a crash, and ordering by key, each measured; tests in CI | Ready |

## Conventions

- **One folder per example**, with its own README, `package.json`, `.env.example`, and (when it needs services) `docker-compose.yml`. Nothing is shared between examples, so each one can be copied out on its own.
- **Pinned versions.** Docker images use exact tags, never `latest`. Dependencies are pinned.
- **Every README follows the same outline:** what it shows, how it works (with a diagram), how to run it, configuration, what you'll see, and limitations.
- **Real output only.** Printed results and screenshots come from an actual run, recorded with the date and the versions used.
- **No secrets.** Configuration goes through environment variables; `.env` is never committed.

## Linting

One configuration at the repository root covers every example: [ESLint](https://eslint.org/) for JavaScript (`eslint.config.js`) and [Ruff](https://docs.astral.sh/ruff/) for Python (`ruff.toml`).

```bash
npm install                          # ESLint (the root package.json holds only lint tools)
pip install -r requirements-dev.txt  # Ruff
npm run lint                         # both
```
