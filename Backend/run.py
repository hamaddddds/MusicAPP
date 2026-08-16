import sys
import uvicorn
from app.main import app
import multiprocessing

# When frozen with PyInstaller --noconsole (windowed app), sys.stdout/sys.stderr
# are None. uvicorn's logging config calls .isatty() on them and crashes, so
# redirect to devnull before uvicorn configures logging.
if sys.stdout is None:
    sys.stdout = open("nul", "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open("nul", "w", encoding="utf-8")

if __name__ == "__main__":
    # Required for PyInstaller when using multiprocessing
    multiprocessing.freeze_support()

    # Run uvicorn on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
