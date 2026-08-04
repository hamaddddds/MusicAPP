fn main() {
    println!("cargo:rerun-if-changed=../../Backend/CoreC++/MainAPP.cpp");
    cc::Build::new()
        .cpp(true)
        .file("../../Backend/CoreC++/MainAPP.cpp")
        .compile("mainapp");
        
    tauri_build::build()
}
