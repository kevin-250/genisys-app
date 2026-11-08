# open_folder
Open a known folder (downloads, documents, desktop, pictures, videos, music, home) or a folder found by name.

Use `folder` for the standard folders, otherwise `name` with (part of) the folder name.

Example:
```json
{"action":"open_folder","params":{"folder":"downloads"}}
```

Common mistakes: Give exactly one of folder or name.
