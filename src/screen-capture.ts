/** Capture one user-selected screen/window and release sharing on every outcome. */
export async function captureBrowserScreen({
  devices = navigator.mediaDevices,
  createVideo = () => document.createElement("video"),
  createCanvas = () => document.createElement("canvas"),
}: {
  devices?: Pick<MediaDevices, "getDisplayMedia">;
  createVideo?: () => HTMLVideoElement;
  createCanvas?: () => HTMLCanvasElement;
} = {}) {
  if (!devices?.getDisplayMedia)
    throw new Error(
      "Screen capture is unavailable in this browser. Use a supported browser or the desktop app.",
    );
  const media = await devices.getDisplayMedia({ video: true, audio: false });
  let video: HTMLVideoElement | undefined;
  try {
    video = createVideo();
    video.srcObject = media;
    await video.play();
    if (!video.videoWidth || !video.videoHeight)
      throw new Error(
        "The selected source returned no image. Check screen recording permission and select it again.",
      );
    const scale = Math.min(
        1,
        1920 / Math.max(video.videoWidth, video.videoHeight),
      ),
      canvas = createCanvas();
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screen image processing is unavailable.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    media.getTracks().forEach((track) => track.stop());
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }
}
