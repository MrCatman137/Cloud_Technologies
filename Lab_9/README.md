# In-Memory Sharded Key-Value Store — TypeScript

A complete in-memory HTTP key-value store demonstrating **sharding**, **swappable partitioning strategies**, **consistent hashing**, **virtual nodes**, **dynamic shard membership**, and **key migration**.

The service is deliberately designed for terminal testing with `curl` and for observing routing/rebalancing in server logs.

## 1. Architecture

```text
                     HTTP / Express
                           |
             +-------------+-------------+
             |                           |
        POST /data                  GET /data/:key
             |                           |
             +-------------+-------------+
                           |
                    ShardingCluster
                           |
                 IShardingStrategy
                    /            \
             Modulo N       Consistent Hashing
                 |                  |
                 |             virtual-node ring
                 +--------+---------+
                          |
                 +--------+--------+
                 |        |        |
              Shard-1  Shard-2  Shard-3 ...
                Map       Map       Map
```

### `ShardNode`

`ShardNode` is an individual in-memory node backed by:

```ts
Map<string, unknown>
```

It supports `put`, `get`, `delete`, `has`, `entries`, and `size`.

### `IShardingStrategy`

The cluster does not know how a key is partitioned. It only asks the strategy:

```ts
getNode(key)
getNodeByHash(hash)
```

The implementation can therefore be replaced without changing the HTTP API or shard storage.

### Hash function

The project uses deterministic **MurmurHash3 x86 32-bit** hashing. It is a fast, well-distributed non-cryptographic hash, which is particularly useful for producing evenly spread positions on the consistent-hash ring.

---

## 2. Modulo N strategy

For a key:

```text
hash = H(key)
shardIndex = hash % N
```

where `N` is the number of active shards.

Example with four shards:

```text
H("user-42") % 4 -> 2 -> shard-3
```

The node IDs are sorted before the modulo calculation so membership order is deterministic.

### Rebalancing behavior

Modulo N is highly sensitive to changes in `N`.

For example:

```text
3 shards: hash % 3
4 shards: hash % 4
```

A large portion of existing keys can change owners when a shard is added. The cluster detects those changed owners and physically migrates the affected values.

---

## 3. Consistent hashing strategy

Instead of dividing the hash space directly by `N`, each physical node receives multiple **virtual nodes** on a circular hash ring.

With 3 physical nodes and 100 virtual nodes per physical node:

```text
3 physical nodes
        x
        |
  x-----+------x
 /              \
|    hash ring   |
 \              /
  x-----+------x
        |
        x

100 virtual positions per physical node
=> 300 ring points
```

For every virtual node, the implementation calculates:

```text
H("shard-1#0")
H("shard-1#1")
...
H("shard-1#99")
```

The ring points are sorted by hash.

To resolve a key:

1. Calculate `H(key)`.
2. Binary-search the first ring point whose hash is greater than or equal to the key hash.
3. The physical node associated with that virtual point owns the key.
4. If the search reaches the end of the ring, wrap around to position zero.

### Why virtual nodes matter

With only one point per physical node, ownership can be uneven. Virtual nodes give every physical node many positions around the ring, making distribution substantially smoother.

### Rebalancing behavior

When a new node is added, only the ring intervals that become owned by the new node change. Existing keys in unaffected intervals keep their original owner.

The cluster compares:

```text
oldStrategy(key) vs newStrategy(key)
```

and migrates only keys for which those owners differ.

This is the key demonstration of consistent hashing stability.

---

## 4. Project structure

```text
sharded-kv-store/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── hash.ts
    ├── shard.ts
    ├── cluster.ts
    ├── server.ts
    └── strategies/
        ├── interface.ts
        ├── modulo.ts
        └── consistent.ts
```

---

## 5. Prerequisites

Recommended:

- Node.js 20+
- npm 10+
- terminal with `curl`

Check:

```bash
node -v
npm -v
curl --version
```

---

## 6. Installation

From the project directory:

```bash
npm install
```

Type-check without producing files:

```bash
npm run typecheck
```

Compile TypeScript:

```bash
npm run build
```

Run the compiled server:

```bash
npm start
```

Or run the development server with automatic restart:

```bash
npm run dev
```

The default server is:

```text
http://localhost:3000
```

---

## 7. Configuration

The default configuration uses consistent hashing:

```text
strategy = consistent-hashing
virtual nodes = 100 per physical node
initial shards = shard-1, shard-2, shard-3
port = 3000
```

Environment variables:

```bash
PORT=3000
SHARDING_STRATEGY=consistent
VIRTUAL_NODES=100
INITIAL_SHARDS=shard-1,shard-2,shard-3
```

### Run modulo N

Linux/macOS/Git Bash:

```bash
SHARDING_STRATEGY=modulo npm run dev
```

PowerShell:

```powershell
$env:SHARDING_STRATEGY="modulo"
npm run dev
```

### Run consistent hashing with 200 virtual nodes

Linux/macOS/Git Bash:

```bash
VIRTUAL_NODES=200 npm run dev
```

PowerShell:

```powershell
$env:VIRTUAL_NODES="200"
npm run dev
```

---

# 8. HTTP API

## `GET /`

Returns basic service information.

```bash
curl http://localhost:3000/
```

---

## `POST /data`

Writes a key/value pair.

Request:

```bash
curl -X POST http://localhost:3000/data \
  -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":{"name":"Volodymyr","role":"student"}}'
```

Expected response shape:

```json
{
  "ok": true,
  "key": "user:1",
  "value": {
    "name": "Volodymyr",
    "role": "student"
  },
  "shard": "shard-2",
  "hash": 123456789,
  "hashHex": "0x075bcd15",
  "updated": false
}
```

The exact hash and shard depend on the deterministic FNV-1a calculation and active topology.

### Update an existing key

```bash
curl -X POST http://localhost:3000/data \
  -H "Content-Type: application/json" \
  -d '{"key":"user:1","value":{"name":"Volodymyr","role":"backend-engineer"}}'
```

---

## `GET /data/:key`

```bash
curl http://localhost:3000/data/user:1
```

Response includes the shard that served the request:

```json
{
  "ok": true,
  "key": "user:1",
  "value": {
    "name": "Volodymyr",
    "role": "backend-engineer"
  },
  "shard": "shard-2",
  "hash": 123456789,
  "hashHex": "0x075bcd15"
}
```

Missing key:

```bash
curl -i http://localhost:3000/data/does-not-exist
```

---

# 9. Dynamic shards

## Add a shard

```bash
curl -X POST http://localhost:3000/shards \
  -H "Content-Type: application/json" \
  -d '{"id":"shard-4"}'
```

The response contains:

- the added shard
- number of migrated keys
- percentage of remapped keys
- individual key movements
- the new distribution

The server logs also print every migration:

```text
[MIGRATE] key="user:1" hash=0x... from=shard-2 to=shard-4 reason="add shard shard-4"
```

With consistent hashing, only the affected ring interval should move.

With modulo N, adding a shard changes `hash % N`, so substantially more keys can move.

## Remove a shard

```bash
curl -X DELETE http://localhost:3000/shards/shard-4
```

The cluster removes the node from the future routing topology and migrates keys that now belong elsewhere.

The last remaining shard cannot be removed.

---

# 10. Inspect distribution

```bash
curl http://localhost:3000/shards/distribution
```

The response contains both machine-readable data and an ASCII visualization:

```json
{
  "strategy": {
    "type": "consistent-hashing",
    "nodeCount": 3,
    "virtualNodesPerNode": 100,
    "ringPoints": 300,
    "nodes": ["shard-1", "shard-2", "shard-3"]
  },
  "totalKeys": 100,
  "shards": [
    {"id":"shard-1","keyCount":31,"percentage":31},
    {"id":"shard-2","keyCount":34,"percentage":34},
    {"id":"shard-3","keyCount":35,"percentage":35}
  ],
  "ascii": "..."
}
```

Pretty-print with `jq` if installed:

```bash
curl -s http://localhost:3000/shards/distribution | jq
```

---

# 11. Populate benchmark data

The benchmark endpoint avoids making 10,000 individual HTTP requests.

Default: 10,000 generated keys.

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{}'
```

Explicit count:

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{"count":10000,"prefix":"load"}'
```

For a smaller first test:

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{"count":1000,"prefix":"test"}'
```

The endpoint returns insertion time and the resulting distribution.

---

# 12. Benchmark statistics

```bash
curl http://localhost:3000/benchmark/stats
```

You can choose the hypothetical shard ID:

```bash
curl "http://localhost:3000/benchmark/stats?shard=shard-future"
```

The endpoint reports:

- total keys
- number of shards
- count per shard
- mean keys per shard
- standard deviation
- coefficient of variation
- percentage of keys that would move if the simulated shard were added
- last actual rebalance

For a distribution with counts:

```text
x1, x2, ..., xN
```

mean:

```text
μ = (x1 + x2 + ... + xN) / N
```

population variance:

```text
σ² = Σ(xi - μ)² / N
```

standard deviation:

```text
σ = sqrt(σ²)
```

The benchmark uses population standard deviation because the observed shard counts represent the complete current cluster population, not a sample.

---

# 13. Recommended verification scenario

## Step 1 — Start the server

```bash
npm install
npm run dev
```

Keep this terminal open. You should see:

```text
Sharded KV Store listening on http://localhost:3000
strategy=consistent-hashing
shards=shard-1,shard-2,shard-3
```

---

## Step 2 — Write three known keys

Terminal 2:

```bash
curl -X POST http://localhost:3000/data \
  -H "Content-Type: application/json" \
  -d '{"key":"alpha","value":"A"}'
```

```bash
curl -X POST http://localhost:3000/data \
  -H "Content-Type: application/json" \
  -d '{"key":"beta","value":"B"}'
```

```bash
curl -X POST http://localhost:3000/data \
  -H "Content-Type: application/json" \
  -d '{"key":"gamma","value":"C"}'
```

Look at the responses and server logs.

The logs explicitly show:

```text
incoming key
hash
resolved shard
```

---

## Step 3 — Read the keys

```bash
curl http://localhost:3000/data/alpha
curl http://localhost:3000/data/beta
curl http://localhost:3000/data/gamma
```

Confirm that each GET returns the value written by POST.

---

## Step 4 — Inspect the initial distribution

```bash
curl -s http://localhost:3000/shards/distribution | jq
```

---

## Step 5 — Populate 10,000 keys

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{"count":10000,"prefix":"bench"}'
```

Then:

```bash
curl -s http://localhost:3000/shards/distribution | jq
```

The counts should be reasonably close, although exact equality is not expected.

---

## Step 6 — Inspect standard deviation

```bash
curl -s http://localhost:3000/benchmark/stats | jq
```

Record:

```text
standardDeviation
coefficientOfVariation
simulatedAddShard.remappedPercentage
```

The coefficient of variation is particularly useful for comparing distribution quality across different numbers of keys.

---

# 14. Demonstrate consistent-hashing stability

With 10,000 keys already loaded:

```bash
curl -s "http://localhost:3000/benchmark/stats?shard=shard-4" | jq '.simulatedAddShard'
```

This does **not** actually add the shard. It only computes where every existing key would go if `shard-4` were added.

Now actually add it:

```bash
curl -X POST http://localhost:3000/shards \
  -H "Content-Type: application/json" \
  -d '{"id":"shard-4"}'
```

Compare the reported migration percentage with the simulation.

Then inspect the distribution again:

```bash
curl -s http://localhost:3000/shards/distribution | jq
```

Finally verify an existing key:

```bash
curl http://localhost:3000/data/alpha
```

Even if `alpha` moved during rebalancing, its value remains available because the cluster migrated the value together with its key.

---

# 15. Demonstrate removal and migration

Remove the newly added node:

```bash
curl -X DELETE http://localhost:3000/shards/shard-4
```

Watch the server terminal. Every moved key is logged as:

```text
[MIGRATE] key="..." hash=0x... from=shard-4 to=... reason="remove shard shard-4"
```

Then verify the key again:

```bash
curl http://localhost:3000/data/alpha
```

---

# 16. Compare modulo N against consistent hashing

Stop the server with `Ctrl+C`.

Start modulo N:

```bash
SHARDING_STRATEGY=modulo npm run dev
```

Populate data:

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{"count":10000,"prefix":"modulo"}'
```

Simulate an additional shard:

```bash
curl -s "http://localhost:3000/benchmark/stats?shard=shard-4" | jq '.simulatedAddShard'
```

Then repeat the same experiment using consistent hashing:

```bash
SHARDING_STRATEGY=consistent npm run dev
```

Populate the same order of magnitude of keys:

```bash
curl -X POST http://localhost:3000/benchmark/populate \
  -H "Content-Type: application/json" \
  -d '{"count":10000,"prefix":"consistent"}'
```

Simulate the new shard:

```bash
curl -s "http://localhost:3000/benchmark/stats?shard=shard-4" | jq '.simulatedAddShard'
```

The important measurement is:

```text
simulatedAddShard.remappedPercentage
```

Modulo N and consistent hashing have different remapping behavior because their partitioning algorithms react differently to a change in node count.

---

# 17. What to inspect in server logs

For a write:

```text
[HTTP] POST /data
[PUT] key="alpha" hash=0x... shard=shard-2 previous=<none>
```

For a read:

```text
[HTTP] GET /data/alpha
[GET] key="alpha" hash=0x... shard=shard-2 found=true
```

For rebalancing:

```text
[SHARD] adding shard=shard-4; starting rebalance
[MIGRATE] key="..." hash=0x... from=shard-2 to=shard-4 reason="add shard shard-4"
[REBALANCE] reason="add shard shard-4" moved=.../... (...%) strategy=consistent-hashing
```

This makes the routing decision and migration behavior observable without a debugger.

---

# 18. Important implementation notes

### In-memory only

Restarting the server deletes all data. There is no database or persistence layer.

### Single-process concurrency model

Express and the cluster run in one Node.js process. JavaScript execution is event-loop based; this project intentionally focuses on the sharding model rather than distributed-process consensus or replication.

### No replication

A key has one owner shard at a time. There is no replica/failover mechanism.

### Migration is value-preserving

During a rebalance, the cluster:

1. calculates the old owner for every key;
2. calculates the new owner using the new topology;
3. moves only keys whose owner changed;
4. deletes the old copy after writing the new copy;
5. switches the active strategy topology.

This is enough for an educational in-memory implementation, but a production distributed store would need transactional/dual-write coordination, failure handling, versioning, replication, and recovery semantics.

### Why `moveShard` exists

`moveShard(key, targetShardId)` is exposed as a cluster-level operation for explicit migration/testing. Normal shard add/remove operations use the internal rebalance mechanism so the target is selected automatically by the active strategy.

---

# 19. Quick command sheet

Start:

```bash
npm install
npm run dev
```

Write:

```bash
curl -X POST http://localhost:3000/data -H "Content-Type: application/json" -d '{"key":"hello","value":"world"}'
```

Read:

```bash
curl http://localhost:3000/data/hello
```

Distribution:

```bash
curl http://localhost:3000/shards/distribution
```

Populate 10k:

```bash
curl -X POST http://localhost:3000/benchmark/populate -H "Content-Type: application/json" -d '{"count":10000}'
```

Stats:

```bash
curl http://localhost:3000/benchmark/stats
```

Simulate adding shard-4:

```bash
curl "http://localhost:3000/benchmark/stats?shard=shard-4"
```

Add shard:

```bash
curl -X POST http://localhost:3000/shards -H "Content-Type: application/json" -d '{"id":"shard-4"}'
```

Remove shard:

```bash
curl -X DELETE http://localhost:3000/shards/shard-4
```
