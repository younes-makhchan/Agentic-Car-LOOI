#!/usr/bin/env bash
set -euo pipefail
# Local toolchain only; no shell profile or global installation is modified.
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="${LOOI_WASM_BUILD_DIR:-$project_dir/../../tmp/web-wasm-rebuild}"
mkdir -p "$build_dir"
if [ ! -d "$build_dir/emsdk" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "$build_dir/emsdk"
fi
git -C "$build_dir/emsdk" checkout d7b4130688bfa348392b921ab04015aa15c4f154
"$build_dir/emsdk/emsdk" install 4.0.23
"$build_dir/emsdk/emsdk" activate 4.0.23
source "$build_dir/emsdk/emsdk_env.sh"
curl -fsSL --retry 3 https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v2.0.0.tar.gz -o "$build_dir/source.tar.gz"
echo "181edbe8d20046161b09786efdaa1cf5a1bf14386e0706589039304696bcb2d1  $build_dir/source.tar.gz" | shasum -a 256 -c -
mkdir -p "$build_dir/source"
tar -xzf "$build_dir/source.tar.gz" -C "$build_dir/source" --strip-components=1
python3 "$project_dir/scripts/prepare-wake-build.py" "$build_dir/source"
cd "$build_dir/source"
bash build-wasm-simd-kws.sh
cd "$project_dir"
LOOI_KWS_BUILD="$build_dir/source/build-wasm-simd-kws/install/bin/wasm" npm run resources
