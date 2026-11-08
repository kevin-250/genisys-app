# delete_file
Delete a file or folder by sending it to the Recycle Bin (asks the user first).

Full path. It goes to the Recycle Bin so it can be restored.

Example:
```json
{"action":"delete_file","params":{"path":"C:\\Users\\me\\Desktop\\old.txt"}}
```

Common mistakes: Never guess a path. If unsure, answer unknown.
