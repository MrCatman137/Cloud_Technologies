import { formatHash, hashString } from "./hash";
import { ShardNode, StoredValue } from "./shard";
import { IShardingStrategy } from "./strategies/interface";

export interface PutResult {
  key: string;
  hash: number;
  shardId: string;
  previousValue: StoredValue | undefined;
}

export interface GetResult {
  key: string;
  hash: number;
  shardId: string;
  value: StoredValue;
}

export interface Distribution {
  strategy: Record<string, unknown>;
  totalKeys: number;
  shards: Array<{ id: string; keyCount: number; percentage: number }>;
  ascii: string;
}

export interface RebalanceResult {
  reason: string;
  movedKeys: number;
  totalKeys: number;
  remappedPercentage: number;
  movements: Array<{ key: string; from: string; to: string; hash: number }>;
}

export class ShardingCluster {
  private readonly nodes = new Map<string, ShardNode>();
  private strategy: IShardingStrategy;
  private lastRebalance: RebalanceResult | null = null;

  public constructor(strategy: IShardingStrategy, initialNodeIds: string[]) {
    if (initialNodeIds.length === 0) {
      throw new Error("Cluster requires at least one shard");
    }

    this.strategy = strategy.withNodes(initialNodeIds);
    for (const id of [...new Set(initialNodeIds)].sort()) {
      this.nodes.set(id, new ShardNode(id));
    }

    console.log(`[CLUSTER] initialized strategy=${this.strategy.name} shards=${this.nodeIds().join(",")}`);
  }

  public put(key: string, value: StoredValue): PutResult {
    this.validateKey(key);

    const hash = hashString(key);
    const shardId = this.strategy.getNodeByHash(hash);
    const shard = this.requireNode(shardId);
    const previousValue = shard.get(key);

    shard.put(key, value);

    console.log(
      `[PUT] key="${key}" hash=${formatHash(hash)} shard=${shardId} ` +
      `previous=${previousValue === undefined ? "<none>" : JSON.stringify(previousValue)}`
    );

    return { key, hash, shardId, previousValue };
  }

  public get(key: string): GetResult | null {
    this.validateKey(key);

    const hash = hashString(key);
    const shardId = this.strategy.getNodeByHash(hash);
    const shard = this.requireNode(shardId);
    const value = shard.get(key);

    console.log(
      `[GET] key="${key}" hash=${formatHash(hash)} shard=${shardId} ` +
      `found=${value !== undefined}`
    );

    if (value === undefined) {
      return null;
    }

    return { key, hash, shardId, value };
  }

  public addShard(nodeId: string): RebalanceResult {
    this.validateNodeId(nodeId);
    if (this.nodes.has(nodeId)) {
      throw new Error(`Shard "${nodeId}" already exists`);
    }

    console.log(`[SHARD] adding shard=${nodeId}; starting rebalance`);
    this.nodes.set(nodeId, new ShardNode(nodeId));
    return this.rebalanceTo([...this.nodeIds()], `add shard ${nodeId}`);
  }

  public removeShard(nodeId: string): RebalanceResult {
    this.validateNodeId(nodeId);
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Shard "${nodeId}" does not exist`);
    }
    if (this.nodes.size === 1) {
      throw new Error("Cannot remove the last shard");
    }

    console.log(`[SHARD] removing shard=${nodeId}; starting rebalance`);
    const remainingNodeIds = this.nodeIds().filter((id) => id !== nodeId);
    const result = this.rebalanceTo(remainingNodeIds, `remove shard ${nodeId}`);
    this.nodes.delete(nodeId);
    return result;
  }

  public moveShard(key: string, targetShardId: string): void {
    this.validateKey(key);
    const target = this.requireNode(targetShardId);
    const hash = hashString(key);
    const sourceShardId = this.strategy.getNodeByHash(hash);
    const source = this.requireNode(sourceShardId);
    const value = source.get(key);

    if (value === undefined) {
      throw new Error(`Key "${key}" does not exist`);
    }
    if (sourceShardId === targetShardId) {
      console.log(`[MIGRATE] key="${key}" hash=${formatHash(hash)} already on shard=${targetShardId}`);
      return;
    }

    target.put(key, value);
    source.delete(key);
    console.log(
      `[MIGRATE] key="${key}" hash=${formatHash(hash)} from=${sourceShardId} to=${targetShardId}`
    );
  }

  public distribution(): Distribution {
    const counts = this.nodeIds().map((id) => this.nodes.get(id)!.size());
    const totalKeys = counts.reduce((sum, count) => sum + count, 0);

    const shards = this.nodeIds().map((id, index) => ({
      id,
      keyCount: counts[index],
      percentage: totalKeys === 0 ? 0 : Number(((counts[index] / totalKeys) * 100).toFixed(2))
    }));

    const max = Math.max(...counts, 1);
    const width = 40;
    const ascii = shards
      .map((shard) => {
        const barLength = totalKeys === 0 ? 0 : Math.round((shard.keyCount / max) * width);
        return `${shard.id.padEnd(12)} | ${"#".repeat(barLength).padEnd(width)} | ${shard.keyCount}`;
      })
      .join("\n");

    return {
      strategy: this.strategy.describe(),
      totalKeys,
      shards,
      ascii
    };
  }

  public allKeys(): string[] {
    const keys: string[] = [];
    for (const node of this.nodes.values()) {
      for (const entry of node.entries()) keys.push(entry.key);
    }
    return keys.sort();
  }

  public keyCount(): number {
    return this.allKeys().length;
  }

  public simulateAddShard(nodeId: string): {
    nodeId: string;
    movedKeys: number;
    totalKeys: number;
    remappedPercentage: number;
    fromTo: Record<string, number>;
  } {
    this.validateNodeId(nodeId);
    if (this.nodes.has(nodeId)) {
      throw new Error(`Shard "${nodeId}" already exists`);
    }

    const futureStrategy = this.strategy.withNodes([...this.nodeIds(), nodeId]);
    let movedKeys = 0;
    const fromTo: Record<string, number> = {};

    for (const key of this.allKeys()) {
      const hash = hashString(key);
      const current = this.strategy.getNodeByHash(hash);
      const future = futureStrategy.getNodeByHash(hash);
      if (current !== future) {
        movedKeys += 1;
        const route = `${current}->${future}`;
        fromTo[route] = (fromTo[route] ?? 0) + 1;
      }
    }

    const totalKeys = this.keyCount();
    return {
      nodeId,
      movedKeys,
      totalKeys,
      remappedPercentage: totalKeys === 0 ? 0 : Number(((movedKeys / totalKeys) * 100).toFixed(2)),
      fromTo
    };
  }

  public benchmarkStats(simulatedShardId = this.nextSimulationId()): Record<string, unknown> {
    const counts = this.nodeIds().map((id) => this.nodes.get(id)!.size());
    const mean = counts.length === 0 ? 0 : counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.length === 0
      ? 0
      : counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length;
    const standardDeviation = Math.sqrt(variance);
    const simulation = this.simulateAddShard(simulatedShardId);

    return {
      strategy: this.strategy.describe(),
      totalKeys: this.keyCount(),
      shardCount: this.nodes.size,
      counts,
      mean: Number(mean.toFixed(2)),
      standardDeviation: Number(standardDeviation.toFixed(2)),
      coefficientOfVariation: mean === 0 ? 0 : Number((standardDeviation / mean).toFixed(4)),
      simulatedAddShard: simulation,
      lastRebalance: this.lastRebalance
    };
  }

  public populate(count: number, prefix = "bench"): { inserted: number; totalKeys: number } {
    if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
      throw new Error("count must be an integer between 1 and 1,000,000");
    }

    for (let i = 0; i < count; i += 1) {
      const key = `${prefix}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}`;
      this.put(key, {
        source: "benchmark",
        sequence: i,
        createdAt: new Date().toISOString()
      });
    }

    return { inserted: count, totalKeys: this.keyCount() };
  }

  public nodeIds(): string[] {
    return [...this.nodes.keys()].sort();
  }

  public strategyInfo(): Record<string, unknown> {
    return this.strategy.describe();
  }

  private rebalanceTo(newNodeIds: string[], reason: string): RebalanceResult {
    const keys = this.allKeys();
    const oldOwners = new Map<string, string>();

    for (const key of keys) {
      oldOwners.set(key, this.strategy.getNodeByHash(hashString(key)));
    }

    const nextStrategy = this.strategy.withNodes(newNodeIds);
    const movements: RebalanceResult["movements"] = [];

    for (const key of keys) {
      const hash = hashString(key);
      const from = oldOwners.get(key)!;
      const to = nextStrategy.getNodeByHash(hash);

      if (from !== to) {
        movements.push({ key, from, to, hash });
      }
    }

    this.strategy = nextStrategy;

    for (const movement of movements) {
      const source = this.nodes.get(movement.from);
      const target = this.nodes.get(movement.to);
      if (!source || !target) {
        throw new Error(`Invalid migration ${movement.from} -> ${movement.to}`);
      }

      const value = source.get(movement.key);
      if (value === undefined) {
        throw new Error(`Key "${movement.key}" missing from source shard ${movement.from}`);
      }

      target.put(movement.key, value);
      source.delete(movement.key);

      console.log(
        `[MIGRATE] key="${movement.key}" hash=${formatHash(movement.hash)} ` +
        `from=${movement.from} to=${movement.to} reason="${reason}"`
      );
    }

    const result: RebalanceResult = {
      reason,
      movedKeys: movements.length,
      totalKeys: keys.length,
      remappedPercentage: keys.length === 0 ? 0 : Number(((movements.length / keys.length) * 100).toFixed(2)),
      movements
    };

    this.lastRebalance = result;

    console.log(
      `[REBALANCE] reason="${reason}" moved=${result.movedKeys}/${result.totalKeys} ` +
      `(${result.remappedPercentage}%) strategy=${this.strategy.name}`
    );

    return result;
  }

  private requireNode(nodeId: string): ShardNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Shard "${nodeId}" does not exist`);
    return node;
  }

  private validateKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("key must be a non-empty string");
    }
  }

  private validateNodeId(nodeId: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(nodeId)) {
      throw new Error("shard id may contain only letters, numbers, underscore, and hyphen");
    }
  }

  private nextSimulationId(): string {
    let index = this.nodes.size + 1;
    while (this.nodes.has(`sim-${index}`)) index += 1;
    return `sim-${index}`;
  }
}
