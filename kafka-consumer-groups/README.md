# Kafka consumer groups

Kafka 4 consumer groups, measured: how partitions are shared, what a rebalance costs under the three rebalance protocols (including Kafka 4's new consumer protocol, KIP-848), what happens to messages when a consumer is killed, and what a message key does for ordering.

## What it shows

Four experiments, each a short script in [`experiments/`](experiments/):

| Experiment                                   | Question                                                  | Recorded answer                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`assignment.js`](experiments/assignment.js) | How are 6 partitions shared by 1 to 8 consumers?          | Evenly; with 8 consumers, 2 sit idle under either protocol                                                                                                                       |
| [`rebalance.js`](experiments/rebalance.js)   | What does a member joining or leaving cost, per protocol? | The incremental protocols delayed only the 3 partitions that moved, by up to 3.0 s (cooperative) and 4.2 s (KIP-848); in this setup, eager rebalancing delayed nothing on a join |
| [`delivery.js`](experiments/delivery.js)     | What happens to messages when a consumer is killed?       | Nothing is lost, but messages processed since the last commit that reached the broker run again, and the partitions waited about 30 s                                            |
| [`ordering.js`](experiments/ordering.js)     | Does a key keep one entity's updates in order?            | Keyed by order id: 0 of 6,000 out of order. Unkeyed: 5,495                                                                                                                       |

[`test/groups.test.js`](test/groups.test.js) asserts the same behaviour in four tests, which run in CI against Kafka 4.3.2 on Node.js 22 and 24.

## How it works

```text
producer ──► topic (N partitions) ──► consumer group "orders"
                                         ├─ member A: partitions 0, 1
                                         ├─ member B: partitions 2, 3      each partition has exactly one
                                         └─ member C: partitions 4, 5      member; a member can have several
```

- **Assignment.** A consumer group shares a topic's partitions among its members. A partition is read by one member at a time, so a group can never use more members than there are partitions.
- **Rebalancing.** When a member joins or leaves, the partitions are redistributed. The three ways this can happen:
  - **Eager** (classic protocol, `roundrobin`, the default in this client): every member gives up all its partitions, the group agrees on a new plan, and every member starts again.
  - **Cooperative** (classic protocol, `cooperative-sticky`): only the partitions that need to move are revoked. Moving them takes a second round.
  - **Consumer** (`group.protocol: consumer`, KIP-848, new in Kafka 4): the broker computes the assignment and hands partitions over incrementally, through each member's heartbeats.
- **Commits.** A consumer records how far it has processed each partition by committing an offset. After a crash, the next member starts from the last committed offset, so anything processed after it runs again: at-least-once delivery.

The client is Confluent's [`@confluentinc/kafka-javascript`](https://github.com/confluentinc/confluent-kafka-javascript), a wrapper around librdkafka with a KafkaJS-compatible API. It supports all three protocols. [`src/kafka.js`](src/kafka.js) creates consumers for each.

## Run it

Requirements: Node.js 22 or newer, and Docker.

```bash
docker compose up -d      # Kafka 4.3.2 (KRaft) on localhost:9192
npm ci                    # includes a prebuilt librdkafka binary for your platform
npm run assignment        # about 1.5 minutes
npm run rebalance         # about 2 minutes (all three protocols)
npm run delivery          # about 2.5 minutes
npm run ordering
npm test                  # 4 behaviour tests, about 50 s
```

Each run creates its own topics and group names and deletes the topics afterwards. To stop: `docker compose down`.

## Configuration

| Variable        | Default          | What it does                                                                                                                     |
| --------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `KAFKA_BROKERS` | `localhost:9192` | Comma-separated broker list. `docker-compose.yml` publishes 9192, so it does not clash with a Kafka you may already run on 9092. |

Broker and client settings that matter here are left at their defaults: a session timeout of 45 s (client, classic protocol; broker `group.consumer.session.timeout.ms`, consumer protocol), a classic heartbeat every 3 s, and a consumer-protocol heartbeat every 5 s. `KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS` is set to 0, so the broker does not wait for more members before the first classic rebalance.

## What you'll see

Recorded on 2026-11-15 (UTC) on an Apple silicon Mac:

- **Versions:** Node.js 24.16.0, Kafka 4.3.2 in Docker, `@confluentinc/kafka-javascript` 1.11.0 (librdkafka 2.16.0).
- **Quiet machine:** each run waited until other local workloads were idle, and a sampler watched for any that started during it.

### Assignment

```text
eager protocol, topic with 6 partitions
members   partitions per member            idle members
      1   [[0,1,2,3,4,5]]                  0
      2   [[0,2,4],[1,3,5]]                0
      3   [[2,5],[1,4],[0,3]]              0
      6   [[1],[2],[0],[4],[3],[5]]        0
      8   [[5],[1],[3],[2],[0],[],[4],[]]  2

consumer protocol, topic with 6 partitions
members   partitions per member            idle members
      1   [[0,1,2,3,4,5]]                  0
      2   [[0,1,2],[3,4,5]]                0
      3   [[2,3],[4,5],[0,1]]              0
      6   [[1],[0],[4],[5],[3],[2]]        0
      8   [[2],[1],[0],[4],[3],[],[5],[]]  2
```

Round-robin interleaves partitions; the consumer protocol's default assignor gives each member a contiguous range. Both leave 2 of 8 members idle. Under the consumer protocol the assignment settles through heartbeats, so the script waits 6 s without a change (longer than one 5 s heartbeat) before reading it. With a shorter wait, it caught one member still holding every partition.

### Rebalance

12 partitions, a producer sending 200 messages per second in strict rotation across partitions (so each partition gets a message about every 60 ms), and 3 consumers. A 4th consumer joins, then leaves cleanly. Steady-state latency from send to processing was 9–10 ms at the median.

| Event | Protocol           | Settled after | Longest pause, whole group | Worst latency | Partitions with a gap > 250 ms | Messages > 500 ms |
| ----- | ------------------ | ------------- | -------------------------- | ------------- | ------------------------------ | ----------------- |
| join  | eager              | 3,093 ms      | 33 ms                      | 22 ms         | 0 of 12                        | 0 of 980          |
| join  | cooperative        | 6,014 ms      | 27 ms                      | 3,005 ms      | 3 of 12                        | 123 of 1,540      |
| join  | consumer (KIP-848) | 5,212 ms      | 32 ms                      | 4,190 ms      | 3 of 12                        | 177 of 1,380      |
| leave | eager              | 1,047 ms      | 30 ms                      | 985 ms        | 3 of 12                        | 24 of 588         |
| leave | cooperative        | 1,051 ms      | 27 ms                      | 991 ms        | 3 of 12                        | 24 of 584         |
| leave | consumer (KIP-848) | 2,823 ms      | 31 ms                      | 2,789 ms      | 3 of 12                        | 110 of 925        |

A second run gave the same picture: every timing within 60 ms of the first and every count within 3. Another workload became active during that second run, so the table shows the first.

What the numbers say:

- **The group never stopped.** Under every protocol, the longest stretch with no message processed anywhere in the group was 27–33 ms.
- **The incremental protocols only delay the partitions that move.** On a join, cooperative-sticky and the consumer protocol delayed exactly the 3 partitions handed to the new member, for up to 3.0 s and 4.2 s. That is how long the handover takes: two classic rebalance rounds paced by 3 s heartbeats, or the broker's 5 s heartbeats.
- **Eager was cheapest here, which is not the textbook result.** All members run in one process and handle messages instantly, so every member rejoined within milliseconds, and the 3 s settle time passed while they kept consuming. Eager's cost grows with the slowest member's in-flight work and with the size of the group, because everyone stops until everyone rejoins. This setup has neither, so it does not show that cost.
- **On a clean leave**, the departing member's 3 partitions waited about 1 s under the classic protocols, and about 2.8 s under the consumer protocol.

### Delivery after a crash

6,000 messages on 6 partitions. A consumer, in a child process, appends each message to a file (its "side effect"), and is killed with `SIGKILL` after processing about half. A new consumer in the same group then finishes.

Two runs, both on a quiet machine:

| Commit mode                          | Run | Processed before the kill | Resumed after the kill | Total processed | Distinct | Duplicates | Lost |
| ------------------------------------ | --- | ------------------------- | ---------------------- | --------------- | -------- | ---------- | ---- |
| auto-commit every 5 s                | 1   | 3,173                     | 29.9 s                 | 9,173           | 6,000    | 3,173      | 0    |
| auto-commit every 5 s                | 2   | 3,126                     | 29.9 s                 | 9,126           | 6,000    | 3,126      | 0    |
| `commitOffsets()` after each message | 1   | 3,015                     | 30.1 s                 | 7,052           | 6,000    | 1,052      | 0    |
| `commitOffsets()` after each message | 2   | 3,084                     | 30.1 s                 | 6,995           | 6,000    | 995        | 0    |

- **Nothing was lost.** Every one of the 6,000 messages was processed at least once.
- **Auto-commit (the default, every 5 s).** The consumer was killed within 5 s of starting, before its first commit, so everything it had processed ran again.
- **Committing after each message** shrank the replay to about a third (995 and 1,052 duplicates), but did not remove it. Development runs gave 528 and 980, so the number varies. In this client version, `commitOffsets()` returns before the broker has the commit (see below), so commits still in flight at the crash are lost.
- **The partitions sat idle for about 30 s.** The killed member never left the group, so its partitions stayed assigned to it until the broker gave up on it. A clean shutdown (`consumer.disconnect()`) hands them over within about 1 s, as in the rebalance experiment.

**`commitOffsets()` resolves before the commit reaches the broker.** It is documented as returning "a promise that resolves when the offsets have been committed". In version 1.11.0 it calls librdkafka's asynchronous commit (`commitAsync`), and the promise resolves once the commit is queued. A separate check processed 3,000 messages, awaiting `commitOffsets()` after each:

- **Per call:** about 0.02 ms (median), too fast for a round trip to the broker.
- **Straight after:** the broker's committed offsets added up to 1,740, not 3,000.
- **500 ms later:** they added up to 3,000.

The practical rule does not change: with Kafka's at-least-once delivery, handlers must be idempotent.

### Ordering

20 orders, each with 300 numbered updates, interleaved (6,000 messages on 6 partitions). 3 consumers each process up to 3 partitions concurrently, with a little asynchronous work per message.

```text
message key        processed   updates that arrived after a later update of the same order
order id                6000   0
none                    6000   5495
```

Kafka keeps order within a partition only. With the order id as the key, all of an order's updates go to the same partition and arrive in order, even though partitions are processed concurrently. Without a key, they are spread over all partitions and arrive in any order.

### Tests

`npm test`, all 4 passing in about 50 s:

- **Idle members:** 2 partitions and 3 members leave one member idle.
- **New protocol:** the consumer protocol balances 4 partitions 2 and 2.
- **Ordering:** keyed messages stay in order under concurrent processing.
- **No loss:** a consumer killed mid-run loses nothing. This test takes about 31 s, waiting for the dead member's session to expire.

## Limitations

- **One broker, one machine.** No replication. All consumers of a group run in one Node.js process, except in the crash experiment, which uses child processes.
- **Fast handlers.** Handlers do almost no work, which flatters eager rebalancing (see above). A follow-up would make handlers slow and compare again.
- **A few runs.** The rebalance figures come from one recorded run and a second, partly overlapped one; delivery from two clean runs.
- **Client-specific findings.** The `commitOffsets()` timing applies to `@confluentinc/kafka-javascript` 1.11.0. Other clients, or later versions, may confirm commits before resolving.

## Background

This example is new in this repository. It uses Confluent's client instead of KafkaJS, because KafkaJS has had no release since February 2023 and does not support Kafka 4's consumer protocol. [`data-engineering-patterns/kafka-druid-streaming`](https://github.com/SnehalAgrawal/data-engineering-patterns/tree/main/kafka-druid-streaming) uses KafkaJS and documents that.
