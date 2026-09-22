import assert from "node:assert/strict";
import test from "node:test";

import { FirmwareOperationGate } from "../public/firmware-operation.js";

test("a newer provisioning or firmware load invalidates older async work", () => {
  const gate = new FirmwareOperationGate();
  const slowDownload = gate.begin();
  assert.equal(gate.isCurrent(slowDownload), true);

  const provisioning = gate.begin();
  assert.equal(gate.isCurrent(slowDownload), false);
  assert.equal(gate.isCurrent(provisioning), true);
  assert.equal(gate.current(), provisioning);
});
