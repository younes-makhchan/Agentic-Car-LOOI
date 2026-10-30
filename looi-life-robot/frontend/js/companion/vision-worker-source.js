import { ObjectDetector } from "@mediapipe/tasks-vision";
let detector;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const f = data.files;
      const loader = URL.createObjectURL(
        new Blob([f["vendor/vision/vision_wasm_internal.js"]], {
          type: "text/javascript",
        }),
      );
      const wasm = URL.createObjectURL(
        new Blob([f["vendor/vision/vision_wasm_internal.wasm"]], {
          type: "application/wasm",
        }),
      );
      detector = await ObjectDetector.createFromOptions(
        { wasmLoaderPath: loader, wasmBinaryPath: wasm },
        {
          baseOptions: {
            modelAssetBuffer: new Uint8Array(
              f["models/efficientdet_lite0.tflite"],
            ),
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          scoreThreshold: 0.6,
          maxResults: 12,
        },
      );
      URL.revokeObjectURL(loader);
      URL.revokeObjectURL(wasm);
      postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const frame = data.frame;
      const start = performance.now();
      try {
        const result = detector.detectForVideo(frame, data.timestamp);
        postMessage({
          type: "detections",
          time: data.timestamp / 1000,
          ms: performance.now() - start,
          values: result.detections.map((d, n) => ({
            id: `${data.timestamp}-${n}`,
            label: d.categories[0].categoryName,
            confidence: d.categories[0].score,
            box: {
              x: d.boundingBox.originX / frame.width,
              y: d.boundingBox.originY / frame.height,
              w: d.boundingBox.width / frame.width,
              h: d.boundingBox.height / frame.height,
            },
            time: data.timestamp / 1000,
          })),
        });
      } finally {
        frame.close();
      }
    } else if (data.type === "close") {
      detector?.close();
      close();
    }
  } catch (e) {
    postMessage({ type: "error", reason: e.message });
  }
};
