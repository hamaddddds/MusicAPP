# -*- mode: python ; coding: utf-8 -*-
# Build from Backend/:  python -m PyInstaller backend.spec  ->  dist/backend.exe
# Used by both AGENTS.md (local) and .github/workflows/build.yml (CI).
import os

from PyInstaller.utils.hooks import collect_data_files

a = Analysis(
    ['run.py'],
    pathex=[],
    # QuickJS solves YouTube's JS challenge when no deno/node/bun is installed.
    binaries=[(os.path.join(SPECPATH, 'bin', 'qjs.exe'), 'bin')],
    # ytmusicapi loads gettext locales at YTMusic() init; without them every
    # metadata endpoint fails with "No translation file found for domain: 'base'".
    datas=collect_data_files('ytmusicapi') + collect_data_files('yt_dlp', includes=['**/*.js']),
    hiddenimports=[
        'app',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
