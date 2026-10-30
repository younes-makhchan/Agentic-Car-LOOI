let module, kws, stream;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const f = data.files,
        scriptURLs = [];
      const script = (path) => {
        const u = URL.createObjectURL(
          new Blob([f[path]], { type: "text/javascript" }),
        );
        scriptURLs.push(u);
        return u;
      };
      importScripts(
        script("vendor/wake/sherpa-onnx-wasm-kws-main.js"),
        script("vendor/wake/sherpa-onnx-kws.js"),
      );
      module = await createSherpaKws({
        wasmBinary: f["vendor/wake/sherpa-onnx-wasm-kws-main.wasm"],
        print: () => {},
        printErr: () => {},
      });
      module.FS.mkdir("/models");
      for (const [path, bytes] of Object.entries(f))
        if (path.startsWith("models/wake/"))
          module.FS.writeFile(
            "/models/" + path.split("/").at(-1),
            new Uint8Array(bytes),
          );
      const find = (part) =>
        "/models/" +
        Object.keys(f)
          .find(
            (p) => p.endsWith(".onnx") && p.split("/").at(-1).startsWith(part),
          )
          .split("/")
          .at(-1);
      kws = createKws(module, {
        featConfig: { samplingRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: find("encoder"),
            decoder: find("decoder"),
            joiner: find("joiner"),
          },
          tokens: "/models/tokens.txt",
          provider: "cpu",
          modelType: "zipformer2",
          modelingUnit: "cjkchar",
          bpeVocab: "",
          numThreads: 1,
          debug: 0,
        },
        maxActivePaths: 4,
        numTrailingBlanks: 1,
        keywordsScore: 1,
        keywordsThreshold: 0.25,
        keywords: new TextDecoder().decode(
          f["models/wake/" + data.preset + ".txt"],
        ),
      });
      if (!kws.handle) throw Error("Keyword model initialization failed");
      stream = kws.createStream();
      for (const u of scriptURLs) URL.revokeObjectURL(u);
      postMessage({ type: "ready" });
    } else if (data.type === "pcm") {
      stream.acceptWaveform(16000, new Float32Array(data.samples));
      let count = 0;
      while (kws.isReady(stream) && count++ < 100) {
        kws.decode(stream);
        const r = kws.getResult(stream);
        if (r.keyword) {
          postMessage({ type: "wake", generation: data.generation });
          kws.reset(stream);
          break;
        }
      }
      postMessage({ type: "processed", generation: data.generation });
    } else if (data.type === "reset") {
      kws?.reset(stream);
    } else if (data.type === "close") {
      stream?.free();
      kws?.free();
      close();
    }
  } catch (e) {
    postMessage({ type: "error", reason: e.message });
  }
};
