import type { PoisoningScanResult } from "./detect";

export class PoisoningRejectedError extends Error {
  readonly scan: PoisoningScanResult;
  constructor(scan: PoisoningScanResult) {
    super(`Fact rejected: poisoning gate matched ${scan.findings.length} finding(s)`);
    this.name = "PoisoningRejectedError";
    this.scan = scan;
  }
}
