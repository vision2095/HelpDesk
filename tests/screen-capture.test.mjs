import { test } from "node:test";
import assert from "node:assert/strict";
import { captureBrowserScreen } from "../src/screen-capture.ts";
function fixture({ playError, encodeError, width = 1920 } = {}) {
  let stopped = 0;
  const video = {
    videoWidth: width,
    videoHeight: 1080,
    srcObject: null,
    play: async () => {
      if (playError) throw playError;
    },
    pause() {},
  };
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => {
      if (encodeError) throw encodeError;
      return "data:image/jpeg;base64,test";
    },
  };
  return {
    video,
    canvas,
    stopped: () => stopped,
    dependencies: {
      devices: {
        getDisplayMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                stopped++;
              },
            },
          ],
        }),
      },
      createVideo: () => video,
      createCanvas: () => canvas,
    },
  };
}
test("one-shot browser capture releases sharing after success", async () => {
  const f = fixture();
  assert.equal(
    await captureBrowserScreen(f.dependencies),
    "data:image/jpeg;base64,test",
  );
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});
test("browser capture releases sharing on playback, empty frame and encoding failures", async () => {
  for (const options of [
    { playError: new Error("play denied") },
    { width: 0 },
    { encodeError: new Error("canvas failed") },
  ]) {
    const f = fixture(options);
    await assert.rejects(captureBrowserScreen(f.dependencies));
    assert.equal(f.stopped(), 1);
    assert.equal(f.video.srcObject, null);
  }
});
