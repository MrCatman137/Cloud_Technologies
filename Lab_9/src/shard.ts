export type StoredValue = unknown;

export interface ShardEntry {
  key: string;
  value: StoredValue;
}

export class ShardNode {
  private readonly data = new Map<string, StoredValue>();

  public constructor(public readonly id: string) {}

  public put(key: string, value: StoredValue): void {
    this.data.set(key, value);
  }

  public get(key: string): StoredValue | undefined {
    return this.data.get(key);
  }

  public has(key: string): boolean {
    return this.data.has(key);
  }

  public delete(key: string): boolean {
    return this.data.delete(key);
  }

  public size(): number {
    return this.data.size;
  }

  public entries(): ShardEntry[] {
    return Array.from(this.data.entries(), ([key, value]) => ({ key, value }));
  }

  public clear(): void {
    this.data.clear();
  }
}
