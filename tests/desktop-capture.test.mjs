import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createCapture } = createRequire(import.meta.url)(
  "../desktop/capture.cjs",
);
function fixture({
  permission = "granted",
  response = 1,
  empty = false,
  failure = false,
  multiDisplay = false,
  hangingQuery = 0,
} = {}) {
  let visible = true,
    hides = 0,
    shows = 0,
    queries = 0;
  const sources = ["screen:one", "screen:two"].map((id) => ({
    id,
    name: id,
    display_id: id === "screen:one" ? "1" : "2",
    thumbnail: { isEmpty: () => empty, toDataURL: () => `data:${id}` },
  }));
  const tools = createCapture({
    platform: "darwin",
    screen: {
      getCursorScreenPoint: () => ({ x: -900, y: 50 }),
      getDisplayNearestPoint: () => ({ id: 2 }),
    },
    systemPreferences: { getMediaAccessStatus: () => permission },
    desktopCapturer: {
      getSources: async () => {
        queries++;
        if (queries === hangingQuery) return new Promise(() => {});
        if (failure && queries === 2) throw new Error("capture failure");
        return sources;
      },
    },
    dialog: { showMessageBox: async () => ({ response }) },
    getWindow: () => ({
      isDestroyed: () => false,
      isVisible: () => visible,
      hide: () => {
        visible = false;
        hides++;
      },
      show: () => {
        visible = true;
        shows++;
      },
    }),
    wait: async () => {},
    captureTimeoutMs: 20,
  });
  return { tools, stats: () => ({ hides, shows, queries, visible }) };
}
test("capture uses explicitly selected monitor and restores window", async () => {
  const f = fixture();
  const result = await f.tools.capture();
  assert.equal(result.image, "data:screen:two");
  assert.deepEqual(f.stats(), {
    hides: 1,
    shows: 1,
    queries: 2,
    visible: true,
  });
});
test("desktop capture keeps lossless PNG data URLs for the archive", async () => {
  const tools = createCapture({
    platform: "darwin",
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    desktopCapturer: {
      getSources: async () => [
        {
          id: "screen:png",
          thumbnail: {
            isEmpty: () => false,
            toDataURL: () => "data:image/png;base64,cG5n",
            toJPEG: () => Buffer.from("jpeg"),
          },
        },
      ],
    },
    getWindow: () => ({ isDestroyed: () => false, isVisible: () => false }),
  });
  const result = await tools.capture({ id: "screen:png" });
  assert.equal(result.image, "data:image/png;base64,cG5n");
});

test("capture denial does not enumerate or hide application", async () => {
  const f = fixture({ permission: "denied" });
  await assert.rejects(f.tools.capture(), /System Settings/);
  assert.equal(f.stats().queries, 0);
  assert.equal(f.stats().hides, 0);
});
test("capture cancel produces no screenshot", async () => {
  const f = fixture({ response: 2 });
  await assert.rejects(f.tools.capture(), /canceled/);
  assert.equal(f.stats().hides, 0);
});
test("capture empty image fails visibly and restores window", async () => {
  const f = fixture({ empty: true });
  await assert.rejects(f.tools.capture(), /unavailable/);
  assert.equal(f.stats().shows, 1);
});
test("source capture error restores hidden window", async () => {
  const f = fixture({ failure: true });
  await assert.rejects(f.tools.capture(), /capture failure/);
  assert.equal(f.stats().shows, 1);
});
test("stalled macOS capture restores the hidden window and permits a retry", async () => {
  const f = fixture({ hangingQuery: 2 });
  await assert.rejects(f.tools.capture(), /timed out/);
  assert.equal(f.stats().visible, true);
  assert.equal(f.stats().shows, 1);
  assert.equal((await f.tools.capture()).image, "data:screen:two");
});
test("reopening LensDesk recovers a window while macOS capture is pending", async () => {
  const f = fixture({ hangingQuery: 2 });
  const pending = assert.rejects(f.tools.capture(), /timed out/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.stats().visible, false);
  f.tools.restoreWindow();
  assert.equal(f.stats().visible, true);
  await pending;
  assert.equal(f.stats().shows, 1);
});
test("capture rejects invalid or vanished explicit source", async () => {
  const f = fixture();
  await assert.rejects(f.tools.capture({ id: 123 }), /valid capture source/);
  await assert.rejects(f.tools.capture({ id: "screen:gone" }), /unavailable/);
});
test("active capture follows the cursor's display and specific capture never falls back to another display", async () => {
  const f = fixture();
  assert.equal(
    (await f.tools.capture({ mode: "active" })).image,
    "data:screen:two",
  );
  assert.equal(
    (await f.tools.capture({ mode: "specific", displayId: "1" })).image,
    "data:screen:one",
  );
  await assert.rejects(
    f.tools.capture({ mode: "specific", displayId: "gone" }),
    /unavailable/,
  );
  await assert.rejects(
    f.tools.capture({ id: "screen:gone", silent: true }),
    /unavailable/,
  );
});
test("all display capture returns both real source thumbnails in order and validates modes", async () => {
  const f = fixture();
  assert.deepEqual((await f.tools.capture({ mode: "all" })).images, [
    "data:screen:one",
    "data:screen:two",
  ]);
  await assert.rejects(
    f.tools.capture({ mode: "invented" }),
    /valid capture source/,
  );
  assert.equal(f.stats().visible, true);
});

for (const failure of [false, true]) {
  test(`Windows capture restores original opacity after ${failure ? "failure" : "success"}`, async () => {
    let opacity = 0.83;
    let visible = true;
    let inactiveShows = 0;
    const tools = createCapture({
      platform: "win32",
      getWindow: () => ({
        isDestroyed: () => false,
        isVisible: () => visible,
        getOpacity: () => opacity,
        setOpacity: (value) => { opacity = value; },
        hide: () => { visible = false; },
        showInactive: () => { visible = true; inactiveShows++; },
      }),
      wait: async () => {
        assert.equal(visible, false);
        assert.equal(opacity, 0);
      },
      desktopCapturer: {
        getSources: async () => {
          if (failure) throw new Error("capture failed");
          return [{ id: "screen:1", thumbnail: {
            isEmpty: () => false, toDataURL: () => "data:image/png;base64,test",
          } }];
        },
      },
    });
    if (failure) await assert.rejects(tools.capture({ id: "screen:1" }), /capture failed/);
    else await tools.capture({ id: "screen:1" });
    assert.equal(opacity, 0.83);
    assert.equal(visible, true);
    assert.equal(inactiveShows, 1);
  });
}
