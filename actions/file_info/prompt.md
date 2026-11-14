# file_info
Size, dates and location of ONE file or folder. A folder's size is everything inside it.

Full path of the file or folder. When the user says "it" / "that" / "the first one", take the exact path from the rows of CONVERSATION SO FAR.

Example:
```json
{"action":"file_info","params":{"path":"C:\\Users\\me\\Videos\\Movies\\film.mkv"}}
```

Common mistakes: Guessing a path that is not in the conversation or the user's message. Using it to list many files (use browse_files).
