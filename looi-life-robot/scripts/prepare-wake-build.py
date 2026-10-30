"""Build the pinned upstream runtime without embedding model downloads or local paths."""
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
p = root / 'wasm/kws/CMakeLists.txt'
s = p.read_text()
start=s.index('if(NOT EXISTS');end=s.index('endif()',start)+len('endif()')
s=s[:start]+s[end:]
s='\n'.join(line for line in s.splitlines() if '--preload-file' not in line and 'main.data' not in line)
s=s.replace('-s FORCE_FILESYSTEM=1 -s INITIAL_MEMORY=512MB','-sMODULARIZE=1 -sEXPORT_NAME=createSherpaKws -sENVIRONMENT=worker,node -s FORCE_FILESYSTEM=1 -s INITIAL_MEMORY=128MB')
s=s.replace("['ccall'", "['FS','ccall'")
p.write_text(s+'\n')
p=root/'build-wasm-simd-kws.sh';s=p.read_text();s=s.replace('cmake \\\n', 'cmake \\\n  -DCMAKE_C_FLAGS="-ffile-prefix-map=$(dirname "$PWD")=sherpa-onnx-2.0.0" \\\n  -DCMAKE_CXX_FLAGS="-ffile-prefix-map=$(dirname "$PWD")=sherpa-onnx-2.0.0" \\\n');p.write_text(s)
