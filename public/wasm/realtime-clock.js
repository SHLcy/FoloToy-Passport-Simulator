// ESP32-C3 firmware and button delays use a 160 MHz virtual clock. Limit fast
// hosts to real time; after a stall allow only a short catch-up, never a burst.
export class RealtimeClock {
  constructor(now, cycles, cyclesPerMs = 160_000) {
    this.wall = now;
    this.cycles = cycles;
    this.rate = cyclesPerMs;
  }

  target(now, currentCycles) {
    let target = this.cycles + (now - this.wall) * this.rate;
    if (target - currentCycles > this.rate * 50) {
      target = currentCycles + this.rate * 50;
      this.wall = now;
      this.cycles = target;
    }
    return target;
  }
}
