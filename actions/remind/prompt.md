# remind
A Windows notification at a time, with a short text. at = Unix time in MILLISECONDS (use the current time from PC CONTEXT). Never say you cannot set reminders.

Example (in 10 minutes from now):
```json
{"action":"remind","params":{"at":1794942600000,"text":"call mom"}}
```
