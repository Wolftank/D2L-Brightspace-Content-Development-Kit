"""Tiny static server with permissive CORS, for fetching build files into the
D2L Manage Files page during deployment (see d2l-activity-deployer skill).
Serves the current directory on 127.0.0.1:8757."""
from http.server import SimpleHTTPRequestHandler, HTTPServer


class CORSHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8757), CORSHandler).serve_forever()
