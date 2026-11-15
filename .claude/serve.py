"""Local test server for the Hebrew Class site (http://localhost:5180).

Like `python -m http.server`, with two differences:
- It tells the browser to check every file again on each load, so a reload
  never mixes new and old copies of app.js and styles.css.
- It only answers this computer, not other devices on the network (the local
  results-sheet/Code.gs holds the real teacher passcode).
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
    site = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=site)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("Serving the Hebrew Class site at http://localhost:%d" % port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
