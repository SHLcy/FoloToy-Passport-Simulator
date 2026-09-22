const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.42001E",
  "video/mp4",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function supportsScreenRecording(canvas, Recorder = globalThis.MediaRecorder) {
  return typeof canvas?.captureStream === "function" &&
    typeof Recorder === "function" &&
    Boolean(selectRecordingType(Recorder));
}

export function selectRecordingType(Recorder = globalThis.MediaRecorder) {
  if (typeof Recorder !== "function") return null;
  if (typeof Recorder.isTypeSupported !== "function") {
    // Older Safari versions expose MediaRecorder without the static probe and
    // record canvas streams as MP4 by default.
    return "video/mp4";
  }
  return VIDEO_TYPES.find((type) => Recorder.isTypeSupported(type)) || null;
}

export function recordingFilename(mimeType, date = new Date()) {
  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  return `ai-passport-${date.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

export function startScreenRecording(canvas, {
  Recorder = globalThis.MediaRecorder,
  createCanvas = () => document.createElement("canvas"),
  schedule = globalThis.requestAnimationFrame,
  unschedule = globalThis.cancelAnimationFrame,
} = {}) {
  if (!supportsScreenRecording(canvas, Recorder)) {
    throw new Error("当前浏览器不支持屏幕录制，请使用新版 Chrome、Edge 或 Safari");
  }

  // Repaint a separate canvas so even a static screen has a complete timeline.
  // Capturing it also keeps recorder cleanup independent of the emulator display.
  const capture = createCanvas();
  capture.width = canvas.width;
  capture.height = canvas.height;
  const context = capture.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法读取模拟器屏幕");
  const draw = () => context.drawImage(canvas, 0, 0, capture.width, capture.height);
  draw();
  const stream = capture.captureStream(60);
  let recorder;
  try {
    const mimeType = selectRecordingType(Recorder);
    recorder = new Recorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_000_000,
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  let timer;
  let settled = false;
  let stopping = false;
  let chunks = [];
  let resolve;
  let reject;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });

  function cleanup() {
    unschedule(timer);
    recorder.removeEventListener("dataavailable", onData);
    recorder.removeEventListener("stop", onStop);
    recorder.removeEventListener("error", onError);
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    chunks = [];
  }

  function finish(error, result) {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(result);
  }

  function onData(event) {
    if (event.data?.size) chunks.push(event.data);
  }

  function onStop() {
    const type = recorder.mimeType || chunks[0]?.type;
    const blob = new Blob(chunks, { type });
    if (!blob.size) finish(new Error("没有录到画面，请稍候再停止录制"));
    else finish(null, blob);
  }

  function onError() {
    finish(new Error("屏幕录制失败，请重新录制"));
  }

  recorder.addEventListener("dataavailable", onData);
  recorder.addEventListener("stop", onStop);
  recorder.addEventListener("error", onError);
  try {
    recorder.start(1000);
    draw();
    const paint = () => {
      if (settled || stopping) return;
      try {
        draw();
        timer = schedule(paint);
      } catch { onError(); }
    };
    timer = schedule(paint);
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    completed,
    stop() {
      if (!settled && !stopping && recorder.state !== "inactive") {
        stopping = true;
        try { recorder.stop(); } catch { onError(); }
      }
      return completed;
    },
    cancel() { finish(null, null); },
  };
}
