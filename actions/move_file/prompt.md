# move_file
Move or rename a file (asks the user first).

`to` is the full new file path including the file name.

Example:
```json
{"action":"move_file","params":{"from":"C:\\Users\\me\\Desktop\\a.txt","to":"C:\\Users\\me\\Documents\\b.txt"}}
```

Common mistakes: Always destructive: the user is asked to confirm.
