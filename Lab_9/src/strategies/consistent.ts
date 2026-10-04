import { hashString } from "../hash";
import { IShardingStrategy } from "./interface";

interface RingPoint {
  hash: number;
  nodeId: string;
  virtualNode: number;
}

export class ConsistentHashingStrategy implements IShardingStrategy {
  public readonly name = "consistent-hashing";
  private nodes: string[] = [];
  private ring: RingPoint[] = [];

  public constructor(private readonly virtualNodes = 100, nodeIds: string[] = []) {
    if (!Number.isInteger(virtualNodes) || virtualNodes < 1) {
      throw new Error("virtualNodes must be a positive integer");
    }
    if (nodeIds.length > 0) this.setNodes(nodeIds);
  }

  public setNodes(nodeIds: string[]): void {
    const unique = [...new Set(nodeIds)].sort();
    if (unique.length === 0) {
      throw new Error("Consistent hashing requires at least one node");
    }

    this.nodes = unique;
    this.ring = [];

    for (const nodeId of this.nodes) {
      for (let vnode = 0; vnode < this.virtualNodes; vnode += 1) {
        this.ring.push({
          hash: hashString(`${nodeId}#${vnode}`),
          nodeId,
          virtualNode: vnode
        });
      }
    }

    this.ring.sort((a, b) => {
      if (a.hash !== b.hash) return a.hash - b.hash;
      if (a.nodeId !== b.nodeId) return a.nodeId.localeCompare(b.nodeId);
      return a.virtualNode - b.virtualNode;
    });
  }

  public getNode(key: string): string {
    return this.getNodeByHash(hashString(key));
  }

  public getNodeByHash(hash: number): string {
    if (this.ring.length === 0) {
      throw new Error("Consistent hashing ring has no nodes");
    }

    let low = 0;
    let high = this.ring.length;

    // First ring point whose hash is >= key hash.
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.ring[mid].hash >= hash) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    const index = low === this.ring.length ? 0 : low;
    return this.ring[index].nodeId;
  }

  public withNodes(nodeIds: string[]): IShardingStrategy {
    return new ConsistentHashingStrategy(this.virtualNodes, nodeIds);
  }

  public describe(): Record<string, unknown> {
    return {
      type: this.name,
      nodeCount: this.nodes.length,
      virtualNodesPerNode: this.virtualNodes,
      ringPoints: this.ring.length,
      nodes: [...this.nodes]
    };
  }

  public ringPreview(limit = 20): RingPoint[] {
    return this.ring.slice(0, limit).map((point) => ({ ...point }));
  }
}
