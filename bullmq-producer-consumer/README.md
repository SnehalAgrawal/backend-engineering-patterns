# BullMQ producers and consumers

Producers and workers on a Redis-backed BullMQ queue: throughput against concurrency, retries with exponential backoff, dead letters, duplicate prevention, and crash recovery, each measured on a real run. One finding stands out: a single worker left on BullMQ's default settings delayed crash recovery for the whole queue from 2 seconds to 30.

## What it shows

Five experiments, each a short script in [`experiments/`](experiments/):

| Experiment                                           | Question                                                              | Recorded answer                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`throughput.js`](experiments/throughput.js)         | How does worker concurrency change throughput for I/O-bound jobs?     | 19 jobs/s at concurrency 1, about 830 jobs/s at 50; overhead over the ideal grows from 5% to about 20%            |
| [`retries.js`](experiments/retries.js)               | Does exponential backoff wait as configured?                          | 212, 411, 823 ms between attempts, against 200, 400, 800 ms configured                                            |
| [`dead-letter.js`](experiments/dead-letter.js)       | Where does a job go when it keeps failing, and how does it come back? | The failed set, with its reason and one stack trace per attempt; `job.retry('failed')` after the fix completes it |
| [`idempotency.js`](experiments/idempotency.js)       | Does a job ID stop duplicates?                                        | Yes while the job exists; with `removeOnComplete`, a later resubmission ran again                                 |
| [`crash-recovery.js`](experiments/crash-recovery.js) | How long until a killed worker's job runs again?                      | About 2.0 s with matching settings; about 30 s if the killed worker used the default `stalledInterval`            |

[`test/queue.test.js`](test/queue.test.js) asserts the same behaviour in six tests, which run in CI against Redis on Node.js 22 and 24.

## How it works

```text
producer ──queue.add()──► Redis (BullMQ keys: wait, active, completed, failed, delayed, ...)
                                │
                     worker(s) ─┘ take a job, hold a lock on it, renew the lock while working
                                   ├─ success  → completed (kept unless removeOnComplete)
                                   ├─ error    → delayed (backoff) → wait → retried, until attempts run out → failed
                                   └─ crash    → lock expires → a stalled-job check moves it back to wait
```

- **Connection** ([`src/connection.js`](src/connection.js)): BullMQ 6 no longer bundles a Redis client. With plain connection options it loads `ioredis`, which is installed here as a direct dependency. `maxRetriesPerRequest: null` is required for workers, which block on Redis while waiting for jobs.
- **Job handlers** ([`src/work.js`](src/work.js)):
  - **I/O-bound:** a job that waits a set time.
  - **Flaky:** a job that fails a set number of times, then succeeds.
  - **Broken until fixed:** a job that fails until its data says the problem is fixed.
- **Isolation:** every run uses its own queue name and deletes it afterwards ([`src/helpers.js`](src/helpers.js)), so runs never see each other's jobs.

### Why a crashed job can wait 30 seconds

A worker holds a lock on each job it processes and renews it every `lockDuration / 2`. If the worker dies, the lock expires after at most `lockDuration`. The job stays in `active` until a **stalled-job check** finds it without a lock and moves it back to `wait`.

Only one worker runs that check per interval. Whichever worker runs it sets a Redis key (`<queue>:stalled-check`) that expires after **that worker's** `stalledInterval`, and other workers skip their own checks while it exists.

So when the killed worker had the default `stalledInterval` (30 s), it had set the key for 30 s before it died. The rescuing worker's 1-second checks were skipped until the key expired, even though the job's lock had expired 2 seconds after the kill (case C below). **Every worker on a queue needs the same `lockDuration` and `stalledInterval`.**

## Run it

Requirements: Node.js 22 or newer, and Docker or your own Redis (BullMQ requires Redis 5.0 or newer and recommends 6.2 or newer).

```bash
docker compose up -d      # Redis 8.6.8 on localhost:6380
npm ci
npm run throughput        # about 15 s
npm run retries
npm run dead-letter
npm run idempotency
npm run crash-recovery    # about 2.5 minutes (two cases wait 30 s each)
npm test                  # 6 behaviour tests, about 2.5 s
```

To stop: `docker compose down`. Redis runs without persistence, so nothing is kept.

## Configuration

| Variable     | Default     | What it does                                                                                                    |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `REDIS_HOST` | `localhost` | Redis host for every queue and worker                                                                           |
| `REDIS_PORT` | `6380`      | Redis port. `docker-compose.yml` publishes 6380, so it does not clash with a Redis you may already run on 6379. |

## What you'll see

Recorded on 2026-11-15 (UTC) on an Apple silicon Mac:

- **Versions:** Node.js 24.16.0, Redis 8.6.8 in Docker, BullMQ 6.5.3 with ioredis 5.11.1.
- **Quiet machine:** each run waited until other local workloads were idle, and none overlapped it.

**Throughput.** 200 jobs, each waiting 50 ms, one worker. The table shows two separate runs:

```text
concurrency   wall time   jobs/s   ideal time   overhead
          1    10511 ms       19     10000 ms         5%      (run 2: 10469 ms, 5%)
          5     2132 ms       94      2000 ms         7%      (run 2:  2145 ms, 7%)
         20      549 ms      365       500 ms        10%      (run 2:   551 ms, 10%)
         50      238 ms      841       200 ms        19%      (run 2:   243 ms, 21%)
```

The ideal time is the jobs' own waiting time divided across the concurrency slots. Overhead, the Redis round trips to fetch, lock, and complete each job, grows as the waiting time shrinks: about 5% at concurrency 1, about 20% at 50. For CPU-bound jobs, concurrency in one Node.js process would not help; those need more processes.

**Retries** with `attempts: 5` and `backoff: { type: 'exponential', delay: 200 }`, on a job that fails three times:

```text
Job 1: completed after 4 attempts, result {"succeededOnAttempt":4}

attempt   started after previous   expected backoff
      1                        -                  -
      2                   212 ms             200 ms
      3                   411 ms             400 ms
      4                   823 ms             800 ms
```

Each retry came 11–23 ms after its configured backoff (`delay × 2^(n−1)`), the time to move the job from delayed back to the worker.

**Dead letters** with `attempts: 3`:

```text
After 3 attempts:
  state failed, attemptsMade 3
  failedReason: invalid payment method for order A-1001
  stack traces kept: 3
  queue counts: {"waiting":0,"active":0,"completed":0,"failed":1}

After fixing the cause and calling job.retry("failed"):
  state completed, result {"charged":"A-1001"}
  queue counts: {"waiting":0,"active":0,"completed":1,"failed":0}
```

**Idempotency.** The same order was submitted five times at once with `jobId: 'order-A-1002'`, then once more after the first had finished:

```text
jobId, completed job kept (default)  : processed 1 time(s) for 5 concurrent submissions + 1 later resubmission
jobId, completed job removed         : processed 2 time(s) for 5 concurrent submissions + 1 later resubmission
```

A job ID only prevents a duplicate while a job with that ID exists. `removeOnComplete` deletes it on completion, so a late retry from a client runs the work again. For work that must happen once, the handler itself has to be idempotent (for example, a unique constraint on the order), not just the queue.

**Crash recovery.** A worker in a child process is killed with `SIGKILL` one second into a 10-second job. A second worker (`lockDuration` 2000 ms, `stalledInterval` 1000 ms) is waiting to pick it up:

```text
A. killed worker with the same settings (2000/1000 ms)
  trial 1: job picked up again 2019 ms after the kill (stalledCounter 1)
  trial 2: job picked up again 2019 ms after the kill (stalledCounter 1)
  trial 3: job picked up again 2015 ms after the kill (stalledCounter 1)
B. killed worker on BullMQ defaults (30000/30000 ms)
  trial 1: job picked up again 30066 ms after the kill (stalledCounter 1)
  trial 2: job picked up again 30061 ms after the kill (stalledCounter 1)
C. killed worker with the same lock (2000 ms) but the default stalledInterval (30000 ms)
  trial 1: job picked up again 31076 ms after the kill (stalledCounter 1)
  trial 2: job picked up again 30079 ms after the kill (stalledCounter 1)
```

Case C isolates the cause. The killed worker's lock expired after 2 s, yet the job waited about 30 s, because that worker's stalled-check key blocked the other worker's checks. Before this was measured, a debug run showed the key's remaining TTL at 29,495 ms half a second after the first worker started.

**Tests.** `npm test` passed all 6 tests in four consecutive runs (2.5–3.0 s each).

## Limitations

- **Simulated work.** Jobs wait on timers instead of calling real services, so throughput here measures the queue's own overhead, not a real workload.
- **One Redis, one machine.** No Redis replication or cluster, and Redis runs without persistence. In production, a queue's durability depends on Redis persistence (AOF) and on `maxmemory-policy noeviction`.
- **Recovery is "at least once".** A job interrupted by a crash runs again from the start, so handlers must tolerate running twice. `stalledCounter` shows when it happened, and after `maxStalledCount` stalls (default 1) the job fails instead of running a third time.
- **Small numbers of trials.** Two or three trials per crash case; the pattern is clear, but they are not statistics.

## Background

This example is new in this repository, not rebuilt from an earlier one. It was written against BullMQ 6, which differs from earlier versions in two ways that matter here:

- **Redis client:** `ioredis` is an optional peer dependency that you install yourself (BullMQ also accepts other Redis clients).
- **No raw client:** `queue.client` no longer exposes a raw Redis client, so the debug check in this example used its own `ioredis` connection.
