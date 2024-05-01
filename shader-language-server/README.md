# Shader language server

## Build

The server is built using [WASI](https://wasi.dev/) to interface with VS Code WASI support.

To build it, install target first :
```shell
rustup target add wasm32-wasi
```

Then build the app with:

```shell
cargo build --target wasm32-wasi
```


## Issues

We rely on dxc dll which is not loadable with wasi for security...
Should instead compile dxc to WASI and import it as module if we can ?