export class FirmwareOperationGate {
  #generation = 0;

  begin() {
    this.#generation += 1;
    return this.#generation;
  }

  current() {
    return this.#generation;
  }

  isCurrent(operation) {
    return operation === this.#generation;
  }
}
