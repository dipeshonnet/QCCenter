from __future__ import annotations

import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}"


def qsr_already_running() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/api/status", timeout=1) as response:
            return response.status == 200 and "Quality Sample Randomizer" in response.read().decode("utf-8", "ignore")
    except Exception:
        return False


def port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex((HOST, PORT)) == 0


def open_browser_later() -> None:
    for _ in range(30):
        time.sleep(0.25)
        try:
            with urllib.request.urlopen(f"{URL}/api/status", timeout=0.5) as response:
                if response.status == 200:
                    webbrowser.open(URL)
                    return
        except Exception:
            pass


if __name__ == "__main__":
    if qsr_already_running():
        webbrowser.open(URL)
        print(f"Quality Sample Randomizer is already running at {URL}")
        raise SystemExit(0)
    if port_in_use():
        print(f"Port {PORT} is already in use by another application. Close that application or change PORT in launcher.py.")
        input("Press Enter to close...")
        raise SystemExit(1)

    print(f"Starting Quality Sample Randomizer at {URL}")
    print("Close this window or press Ctrl+C to stop the application.")
    threading.Thread(target=open_browser_later, daemon=True).start()
    uvicorn.run("app:app", host=HOST, port=PORT, reload=False, access_log=False)
