import uvicorn
from app.main import app
import multiprocessing

if __name__ == "__main__":
    # Required for PyInstaller when using multiprocessing
    multiprocessing.freeze_support()
    
    # Run uvicorn on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
