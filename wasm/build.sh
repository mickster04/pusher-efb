#!/usr/bin/env bash
# EXPERIMENTAL command-line build of the taxi module (PusherTaxi.wasm) and the files module (PusherFiles.wasm) without Visual Studio, for Git Bash on Windows.
# Run from anywhere:  bash wasm/build.sh        (optional SDK folder:  bash wasm/build.sh "/g/MSFS 2024 SDK")
#
# UNVERIFIED. The MSFS 2024 platform toolset's real flags are not published, so these are reconstructed from the SDK folder layout
# and the SDK's own SimUtils.vcxproj (defines, no exceptions, no entry point). It may fail to compile, fail to link, or build a
# module the sim will not load. If it does, the Visual Studio project in wasm/vs is the documented route.

set -euo pipefail
export MSYS2_ARG_CONV_EXCL="*"   # stop Git Bash rewriting arguments that start with a slash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${1:-${MSFS2024_SDK:-/g/MSFS 2024 SDK}}"
W() { cygpath -m "$1"; }          # Windows-style path with forward slashes, which the SDK's exes accept

# Everything printed from here on is also written to wasm/build.log, so it can be read without copying it out of the terminal.
exec > >(tee "$HERE/build.log") 2>&1
echo "build started $(date)  SDK: $SDK"

[ -d "$SDK/WASM/llvm/bin" ] || { echo "SDK not found at: $SDK (pass the folder as an argument)"; exit 1; }

CLANG="$SDK/WASM/llvm/bin/clang-cl.exe"
LD="$SDK/WASM/llvm/bin/wasm-ld.exe"
SYSROOT="$SDK/WASM/wasi-sysroot"
OUT="$HERE/build"
DEST="$HERE/../PackageSources/modules"
mkdir -p "$OUT" "$DEST"

CFLAGS=(
  --target=wasm32-unknown-wasi
  -c -fms-extensions
  # clang-cl takes plain clang flags only through /clang: (the MSFS docs do the same for -O3 and -g)
  # (exceptions are already off: clang-cl only enables them with /EH, which is not passed)
  /clang:-O3 /clang:-fno-rtti /clang:-std=c++17
  /GS-   # no stack-protector: the sim does not provide __stack_chk_fail (the VS projects set BufferSecurityCheck=false)
  -D__wasi__ -D_MSFS_WASM=1 -DNDEBUG
  -D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ -D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_
  -D_LIBCPP_NO_EXCEPTIONS
  "-I$(W "$SDK/WASM/include")"
  "-I$(W "$SDK/SimConnect SDK/include")"
  "-I$(W "$SYSROOT/include/c++/v1")"
  "-I$(W "$SYSROOT/include")"
)

OBJS=()
for src in module taxi_core; do
  echo "compile $src.cpp"
  "$CLANG" "${CFLAGS[@]}" "$(W "$HERE/src/$src.cpp")" -o "$(W "$OUT/$src.o")"
  OBJS+=("$(W "$OUT/$src.o")")
done

echo "link PusherTaxi.wasm"
# --export-table: the sim refuses a module without an exported function table ("Error getting indirect function table").
# --export=malloc/free: the sim looks them up ("Error get malloc function pointer") to allocate inside the module.
"$LD" --no-entry --allow-undefined --strip-all --export-table \
  --export=module_init --export=module_deinit \
  --export=malloc --export=free \
  -o "$(W "$OUT/PusherTaxi.wasm")" \
  "${OBJS[@]}" \
  "$(W "$SDK/WASM/WasmVersions/MSFS_WasmVersions.a")" \
  -L"$(W "$SYSROOT/lib/wasm32-wasi")" -lc++ -lc++abi -lc \
  "$(W "$SYSROOT/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a")"

cp "$OUT/PusherTaxi.wasm" "$DEST/PusherTaxi.wasm"
echo "Built $(wc -c < "$OUT/PusherTaxi.wasm") bytes -> $DEST/PusherTaxi.wasm"

echo "build the files module (kept separate from the taxi module above, which is proven)"
echo "compile files_module.cpp"
"$CLANG" "${CFLAGS[@]}" "$(W "$HERE/files/files_module.cpp")" -o "$(W "$OUT/files_module.o")"
echo "link PusherFiles.wasm"
"$LD" --no-entry --allow-undefined --strip-all --export-table \
  --export=module_init --export=module_deinit \
  --export=malloc --export=free \
  -o "$(W "$OUT/PusherFiles.wasm")" \
  "$(W "$OUT/files_module.o")" \
  "$(W "$SDK/WASM/WasmVersions/MSFS_WasmVersions.a")" \
  -L"$(W "$SYSROOT/lib/wasm32-wasi")" -lc++ -lc++abi -lc \
  "$(W "$SYSROOT/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a")"
cp "$OUT/PusherFiles.wasm" "$DEST/PusherFiles.wasm"
echo "Built $(wc -c < "$OUT/PusherFiles.wasm") bytes -> $DEST/PusherFiles.wasm"
