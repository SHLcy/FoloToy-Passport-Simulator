import assert from "node:assert/strict";
import test from "node:test";
import {
  recordingFilename,
  startScreenRecording,
  supportsScreenRecording,
} from "../public/screen-recording.js";

function harness({ supported = ["video/mp4"], constructorError, startError } = {}) {
  const state = { draws: 0, trackStops: 0, stopCalls: 0, timers: new Map() };
  const stream = { getTracks: () => [{ stop() { state.trackStops += 1; } }] };
  const source = { width: 240, height: 320, captureStream() { assert.fail("source is untouched"); } };
  const capture = {
    getContext() {
      return {
        drawImage(canvas, x, y, width, height) {
          assert.equal(canvas, source);
          assert.deepEqual([x, y, width, height], [0, 0, 240, 320]);
          state.draws += 1;
        },
      };
    },
    captureStream(fps) { assert.equal(fps, 60); return stream; },
  };
  class Recorder extends EventTarget {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(receivedStream, options) {
      super();
      if (constructorError) throw constructorError;
      assert.equal(receivedStream, stream);
      this.mimeType = options.mimeType;
      this.state = "inactive";
      state.recorder = this;
    }
    start(timeslice) {
      if (startError) throw startError;
      assert.equal(timeslice, 1000);
      this.state = "recording";
    }
    emitData(text) {
      const event = new Event("dataavailable");
      event.data = new Blob([text], { type: this.mimeType });
      this.dispatchEvent(event);
    }
    stop() {
      state.stopCalls += 1;
      this.state = "inactive";
      queueMicrotask(() => {
        this.emitData(state.tail ?? "last");
        this.dispatchEvent(new Event("stop"));
      });
    }
  }
  const options = {
    Recorder,
    createCanvas: () => capture,
    schedule(fn) { state.timers.set(1, fn); return 1; },
    unschedule(id) { state.timers.delete(id); },
  };
  return { source, options, state, capture };
}

test("records native screen dimensions and keeps static frames in the timeline", async () => {
  const { source, options, state, capture } = harness();
  const recording = startScreenRecording(source, options);
  assert.deepEqual([capture.width, capture.height], [240, 320]);
  const before = state.draws;
  state.timers.get(1)();
  state.timers.get(1)();
  assert.equal(state.draws, before + 2);
  state.recorder.emitData("first");
  state.recorder.emitData("");
  const result = recording.stop();
  assert.equal(recording.stop(), result);
  const blob = await result;
  assert.equal(await blob.text(), "firstlast");
  assert.equal(blob.type, "video/mp4");
  assert.equal(state.stopCalls, 1);
  assert.equal(state.trackStops, 1);
  assert.equal(state.timers.size, 0);
  recording.cancel();
  assert.equal(state.trackStops, 1);
});

test("falls back to WebM and uses the correct download extension", async () => {
  const { source, options } = harness({ supported: ["video/webm;codecs=vp8"] });
  const blob = await startScreenRecording(source, options).stop();
  const date = new Date("2026-09-14T08:00:00.000Z");
  assert.equal(recordingFilename(blob.type, date), "ai-passport-2026-09-14T08-00-00-000Z.webm");
  assert.match(recordingFilename("video/mp4;codecs=avc1", date), /\.mp4$/);
});

test("unsupported browsers fail before allocating capture resources", () => {
  const { source, options, state } = harness({ supported: [] });
  assert.equal(supportsScreenRecording(source, options.Recorder), false);
  assert.equal(supportsScreenRecording({}, options.Recorder), false);
  assert.equal(supportsScreenRecording(source, null), false);
  assert.throws(() => startScreenRecording(source, options), /不支持屏幕录制/);
  assert.equal(state.draws, 0);
});

test("constructor and start failures release the stream", () => {
  for (const failure of ["constructorError", "startError"]) {
    const { source, options, state } = harness({ [failure]: new Error("encoder unavailable") });
    assert.throws(() => startScreenRecording(source, options), /encoder unavailable/);
    assert.equal(state.trackStops, 1);
    assert.equal(state.timers.size, 0);
  }
});

test("an encoder error releases resources and reports failure", async () => {
  const { source, options, state } = harness();
  const recording = startScreenRecording(source, options);
  const failed = assert.rejects(recording.completed, /屏幕录制失败/);
  state.recorder.dispatchEvent(new Event("error"));
  await failed;
  assert.equal(state.trackStops, 1);
  assert.equal(state.timers.size, 0);
});

test("empty recordings are rejected instead of downloading an unusable file", async () => {
  const { source, options, state } = harness();
  state.tail = "";
  const recording = startScreenRecording(source, options);
  await assert.rejects(recording.stop(), /没有录到画面/);
  assert.equal(state.trackStops, 1);
});

test("page teardown cancels the recording without producing a download", async () => {
  const { source, options, state } = harness();
  const recording = startScreenRecording(source, options);
  recording.cancel();
  assert.equal(await recording.completed, null);
  assert.equal(state.trackStops, 1);
  assert.equal(state.timers.size, 0);
});

test("successive recordings never reuse the previous video chunks", async () => {
  const { source, options, state } = harness();
  const first = startScreenRecording(source, options);
  state.recorder.emitData("old");
  assert.equal(await (await first.stop()).text(), "oldlast");
  const second = startScreenRecording(source, options);
  state.recorder.emitData("new");
  assert.equal(await (await second.stop()).text(), "newlast");
  assert.equal(state.trackStops, 2);
});
