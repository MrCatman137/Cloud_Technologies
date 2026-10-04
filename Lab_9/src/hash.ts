/**
 * Deterministic MurmurHash3 x86 32-bit implementation.
 *
 * A well-distributed non-cryptographic hash is useful for this project because
 * consistent hashing depends on evenly spread positions on the ring.
 */
export function hashString(input: string): number {
  const bytes = new TextEncoder().encode(input);
  const length = bytes.length;
  const roundedEnd = length & 0xfffffffc;
  let hash = 0;

  for (let i = 0; i < roundedEnd; i += 4) {
    let k =
      bytes[i] |
      (bytes[i + 1] << 8) |
      (bytes[i + 2] << 16) |
      (bytes[i + 3] << 24);

    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);

    hash ^= k;
    hash = (hash << 13) | (hash >>> 19);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }

  let k1 = 0;
  switch (length & 3) {
    case 3:
      k1 ^= bytes[roundedEnd + 2] << 16;
      // falls through
    case 2:
      k1 ^= bytes[roundedEnd + 1] << 8;
      // falls through
    case 1:
      k1 ^= bytes[roundedEnd];
      k1 = Math.imul(k1, 0xcc9e2d51);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, 0x1b873593);
      hash ^= k1;
  }

  hash ^= length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

export function formatHash(hash: number): string {
  return `0x${hash.toString(16).padStart(8, "0")}`;
}
