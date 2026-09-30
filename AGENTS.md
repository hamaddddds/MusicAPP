# Rules

## Backend Updates
Whenever you modify ANY file inside the `Backend/` directory (such as updating python scripts, installing new pip dependencies, or modifying metadata.py):
1. You MUST recompile the backend executable using PyInstaller.
   Command: `python -m PyInstaller --noconfirm backend.spec` (run this inside the `Backend` directory).
   The spec bundles ytmusicapi's locale files and the QuickJS solver (`Backend/bin/qjs.exe`); building from `run.py` without them yields an exe where every endpoint returns 502.
2. You MUST copy the resulting executable (`Backend/dist/backend.exe`) to `Frontend/src-tauri/binaries/backend-x86_64-pc-windows-msvc.exe`.
3. You MUST force add the binary to git (`git add -f Frontend/src-tauri/binaries/backend-x86_64-pc-windows-msvc.exe`).
4. You MUST commit and push the updated executable to GitHub, so that the GitHub Actions CI/CD pipeline builds the Desktop App with the newest backend code.
Failure to do this will result in the Tauri Desktop app running an outdated backend sidecar.
