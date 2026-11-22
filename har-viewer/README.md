# HAR File Viewer

Opens `.har` files (HTTP Archive, the format browsers export from the Network tab) as a request table inside VS Code, instead of a wall of JSON.

It is read-only and works offline: it never changes the file and makes no network requests.

## What it does

- **Opens `.har` files directly.** Click a `.har` file and it opens as a table. No command needed.
- **Request table:** number, method, status, host, path, type, size, time and start offset. Failed and 4xx/5xx requests are marked.
- **Filter** as you type. Words are combined, all must match:
  - `checkout` matches the URL
  - `status:404`, `status:4xx`, `status:5`
  - `method:post`
  - `type:json`, `type:image`
  - `host:api.example.com`, `path:/v2/`
  - `-analytics` or `-type:image` to exclude
- **Sort** by any column: click its header, click again to reverse.
- **Detail pane** for the selected request: general info, request and response headers, query parameters, cookies, timings (blocked, DNS, connect, SSL, send, wait, receive), request body and response body. JSON bodies are indented. A Copy button copies a body.
- **Large files:** the file is parsed outside the editor window and only the rows on screen are drawn, so a capture with tens of thousands of requests still scrolls.
- **Open as JSON text:** one button (also in the editor title bar) switches back to the normal text editor.
- **Reload** reads the file again after it changed on disk.

Arrow keys move the selection once the table has focus.

## What it does not do

- It does not edit, redact or export HAR files.
- It does not replay requests or generate code from them.
- Bodies are shown as text only. Images and other binary bodies are not rendered; the pane says how large they are.
- Bodies longer than 200,000 characters are cut in the pane (the full body is in the JSON text view).
- No waterfall chart.
- The file is loaded into memory whole. Captures of several hundred megabytes can be too large to open; the viewer then says so and you can still open the file as text.

## Privacy

HAR files often hold cookies, tokens and personal data. This extension reads the file on your machine and shows it to you. It has no telemetry, collects nothing, and sends nothing anywhere. The view runs under a content-security policy that blocks all remote resources. It has no runtime dependencies.

## Switching between the table and the text

- Table to text: the **Open as JSON text** button, or **HAR: Open as JSON Text** in the Command Palette.
- Text to table: **HAR: Open in HAR File Viewer** in the Command Palette, the editor title bar or the Explorer context menu.
- To make text the default again: right-click a `.har` file, **Open With...**, **Configure default editor for '*.har'**.

## About

This extension was written by an AI agent (Claude), which also maintains it. The source is plain JavaScript and is in the repository linked from this page; issues can be reported there.

MIT license.
