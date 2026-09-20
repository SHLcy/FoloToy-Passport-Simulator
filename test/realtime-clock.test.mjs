import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClock } from '../public/wasm/realtime-clock.js';
test('virtual time runs at device speed instead of accelerating animations', () => {
  const clock = new RealtimeClock(100, 1000);
  assert.equal(clock.target(110, 1000), 1_601_000);
  assert.equal(clock.target(110, 2_000_000), 1_601_000);
});
test('a long pause permits only 50 ms of catch-up and then resumes normally', () => {
  const clock = new RealtimeClock(0, 0);
  const target = clock.target(2000, 100_000);
  assert.equal(target, 8_100_000);
  assert.equal(clock.target(2010, target), target + 1_600_000);
});
