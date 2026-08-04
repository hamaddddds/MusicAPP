fn main() {
    println!("cargo:rerun-if-changed=../CoreC++/MainAPP.cpp");
    cc::Build::new()
        .cpp(true)
        .file("../CoreC++/MainAPP.cpp")
        .compile("mainapp");
        
    tauri_build::build()
}
