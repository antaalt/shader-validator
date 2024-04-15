use wasm_bindgen::prelude::*;
use cfg_if::cfg_if;

cfg_if! {
    // When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
    // allocator.
    if #[cfg(feature = "wee_alloc")] {
        extern crate wee_alloc;
        #[global_allocator]
        static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
    }
}


#[wasm_bindgen]
extern {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    //alert("Hello, test-wasm!");
    println!("Hello, world!");
}

// Must return () or Result<(), JsValue>
#[wasm_bindgen(start)]
fn _start() -> Result<(), JsValue> {
    use log::Level;
    console_log::init_with_level(Level::Trace).expect("error initializing log");
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));

    greet();
    
    Ok(())
}

#[wasm_bindgen(main)]
fn main() -> Result<(), JsValue> {
    Err(JsValue::from("this error message will be thrown"))
}