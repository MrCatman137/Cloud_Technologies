import express, { NextFunction, Request, Response } from "express";
import { ShardingCluster } from "./cluster";
import { formatHash, hashString } from "./hash";
import { ConsistentHashingStrategy } from "./strategies/consistent";
import { ModuloNStrategy } from "./strategies/modulo";
import { IShardingStrategy } from "./strategies/interface";

const PORT = Number(process.env.PORT ?? 3000);
const STRATEGY_NAME = (process.env.SHARDING_STRATEGY ?? "consistent").toLowerCase();
const VIRTUAL_NODES = Number(process.env.VIRTUAL_NODES ?? 100);
const INITIAL_SHARDS = (process.env.INITIAL_SHARDS ?? "shard-1,shard-2,shard-3")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function createStrategy(): IShardingStrategy {
  if (STRATEGY_NAME === "modulo" || STRATEGY_NAME === "modulo-n") {
    return new ModuloNStrategy(INITIAL_SHARDS);
  }

  if (STRATEGY_NAME === "consistent" || STRATEGY_NAME === "consistent-hashing") {
    return new ConsistentHashingStrategy(VIRTUAL_NODES, INITIAL_SHARDS);
  }

  throw new Error(`Unsupported SHARDING_STRATEGY: ${STRATEGY_NAME}`);
}

const cluster = new ShardingCluster(createStrategy(), INITIAL_SHARDS);
const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
  next();
});

app.get("/", (_req, res) => {
  res.json({
    service: "sharded-kv-store",
    strategy: cluster.strategyInfo(),
    endpoints: [
      "POST /data",
      "GET /data/:key",
      "POST /shards",
      "DELETE /shards/:id",
      "GET /shards/distribution",
      "POST /benchmark/populate",
      "GET /benchmark/stats"
    ]
  });
});

app.post("/data", (req, res) => {
  const { key, value } = req.body ?? {};
  if (typeof key !== "string" || key.length === 0 || !Object.prototype.hasOwnProperty.call(req.body ?? {}, "value")) {
    return res.status(400).json({ error: "Body must contain non-empty string 'key' and a 'value' field" });
  }

  const result = cluster.put(key, value);
  return res.status(201).json({
    ok: true,
    key: result.key,
    value,
    shard: result.shardId,
    hash: result.hash,
    hashHex: `0x${result.hash.toString(16).padStart(8, "0")}`,
    updated: result.previousValue !== undefined
  });
});

app.get("/data/:key", (req, res) => {
  const key = req.params.key;
  const result = cluster.get(key);

  if (!result) {
    const hash = hashString(key);
    return res.status(404).json({
      error: "Key not found",
      key,
      hash,
      hashHex: formatHash(hash),
      shard: cluster.strategyInfo()
    });
  }

  return res.json({
    ok: true,
    key: result.key,
    value: result.value,
    shard: result.shardId,
    hash: result.hash,
    hashHex: `0x${result.hash.toString(16).padStart(8, "0")}`
  });
});

app.post("/shards", (req, res) => {
  const { id } = req.body ?? {};
  if (typeof id !== "string" || id.length === 0) {
    return res.status(400).json({ error: "Body must contain a non-empty string 'id'" });
  }

  const result = cluster.addShard(id);
  return res.status(201).json({
    ok: true,
    addedShard: id,
    rebalance: result,
    distribution: cluster.distribution()
  });
});

app.delete("/shards/:id", (req, res) => {
  const result = cluster.removeShard(req.params.id);
  return res.json({
    ok: true,
    removedShard: req.params.id,
    rebalance: result,
    distribution: cluster.distribution()
  });
});

app.get("/shards/distribution", (_req, res) => {
  return res.json(cluster.distribution());
});

app.post("/benchmark/populate", (req, res) => {
  const rawCount = req.body?.count ?? 10_000;
  const count = Number(rawCount);
  const prefix = typeof req.body?.prefix === "string" && req.body.prefix.length > 0
    ? req.body.prefix
    : "bench";

  if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
    return res.status(400).json({ error: "count must be an integer between 1 and 1,000,000" });
  }

  const started = performance.now();
  const result = cluster.populate(count, prefix);
  const elapsedMs = Number((performance.now() - started).toFixed(2));

  return res.status(201).json({
    ok: true,
    ...result,
    elapsedMs,
    distribution: cluster.distribution()
  });
});

app.get("/benchmark/stats", (req, res) => {
  const simulatedShard = typeof req.query.shard === "string" && req.query.shard.length > 0
    ? req.query.shard
    : undefined;

  return res.json(cluster.benchmarkStats(simulatedShard));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error(`[ERROR] ${message}`);
  return res.status(400).json({ error: message });
});

app.listen(PORT, () => {
  console.log("============================================================");
  console.log(`Sharded KV Store listening on http://localhost:${PORT}`);
  console.log(`strategy=${cluster.strategyInfo().type}`);
  console.log(`shards=${cluster.nodeIds().join(",")}`);
  console.log("============================================================");
});
