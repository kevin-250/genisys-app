# set_volume
Set the system volume to a level from 0 to 100 (approximate, steps of 2).

`level` is a whole number 0-100.

Example:
```json
{"action":"set_volume","params":{"level":30}}
```

Common mistakes: Do not use for muting a single app.
