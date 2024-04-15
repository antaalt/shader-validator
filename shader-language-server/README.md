# Shader language server

## Build

cargo build --lib --target wasm32-unknown-unknown --no-default-features

Should not require bindgen as we directly instantiate wasm file ?

wasm-bindgen .\target\wasm32-unknown-unknown\debug\shader_language_server.wasm --out-dir ./pkg --out-name shader_language_server --target no-modules
