# pc
Built-in PC controls. Pick one control in "do"; "value" is a number (volume/brightness level, minutes, step); "name" is an app name (close_app) or a Settings page (open_settings: settings, display, sound, bluetooth, wifi, network, airplane, battery, power, storage, apps, updates, notifications, default_apps, mouse, keyboard, date_time, privacy, personalization, night_light, camera).

Examples:
```json
{"action":"pc","params":{"do":"volume","value":40}}
{"action":"pc","params":{"do":"close_app","name":"spotify"}}
{"action":"pc","params":{"do":"open_settings","name":"bluetooth"}}
{"action":"pc","params":{"do":"shutdown_in","value":30}}
```
