// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eprintln!("[Otonome] native process starting…");
    app_lib::run();
    eprintln!("[Otonome] native process exited.");
}
