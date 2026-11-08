# copy_file
Copy a file to a new path (never overwrites).

`to` is the full new file path, not just a folder.

Example:
```json
{"action":"copy_file","params":{"from":"C:\\Users\\me\\Desktop\\a.txt","to":"C:\\Users\\me\\Documents\\a.txt"}}
```

Common mistakes: Include the file name in `to`.
