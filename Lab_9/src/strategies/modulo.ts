import { hashString } from "../hash";
import { IShardingStrategy } from "./interface";

export class ModuloNStrategy implements IShardingStrategy {
  public readonly name = "modulo-n";
  private nodes: string[] = [];

  public constructor(nodeIds: string[] = []) {
    if (nodeIds.length > 0) this.setNodes(nodeIds);
  }

  public setNodes(nodeIds: string[]): void {
    const unique = [...new Set(nodeIds)].sort();
    if (unique.length === 0) {
      throw new Error("Modulo N strategy requires at least one node");
    }
    this.nodes = unique;
  }

  public getNode(key: string): string {
    return this.getNodeByHash(hashString(key));
  }

  public getNodeByHash(hash: number): string {
    if (this.nodes.length === 0) {
      throw new Error("Modulo N strategy has no nodes");
    }
    return this.nodes[hash % this.nodes.length];
  }

  public withNodes(nodeIds: string[]): IShardingStrategy {
    return new ModuloNStrategy(nodeIds);
  }

  public describe(): Record<string, unknown> {
    return {
      type: this.name,
      nodeCount: this.nodes.length,
      nodes: [...this.nodes]
    };
  }
}
