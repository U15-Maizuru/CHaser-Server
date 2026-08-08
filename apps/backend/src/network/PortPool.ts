export class PortPool {
  private readonly available: Set<number>;

  constructor(start: number, end: number) {
    this.available = new Set<number>();
    for (let p = start; p <= end; p++) this.available.add(p);
  }

  alloc(): number | null {
    const port = this.available.values().next().value;
    if (port === undefined) return null;
    this.available.delete(port);
    return port;
  }

  release(port: number): void {
    this.available.add(port);
  }
}
