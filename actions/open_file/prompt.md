# open_file
Find a file or movie/song/document by name and open it with its default program.

`query` = the name words only (no "movie", no year). Add `ext` (e.g. pdf) if the user said the type.

Example:
```json
{"action":"open_file","params":{"query":"mousetrap"}}
```

Common mistakes: Never pass a path here; use open_file for names.
