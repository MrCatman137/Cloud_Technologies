export interface IShardingStrategy {
  readonly name: string;

  /** Replace the active node set used by the strategy. */
  setNodes(nodeIds: string[]): void;

  /** Resolve a key directly to a node. */
  getNode(key: string): string;

  /** Resolve an already-computed unsigned 32-bit hash to a node. */
  getNodeByHash(hash: number): string;

  /** Create an independent strategy with a different node set. */
  withNodes(nodeIds: string[]): IShardingStrategy;

  /** Strategy-specific diagnostic information. */
  describe(): Record<string, unknown>;
}
