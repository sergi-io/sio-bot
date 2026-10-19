export function stringToSha256(input: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  return hasher.update(input).digest('hex');
}
