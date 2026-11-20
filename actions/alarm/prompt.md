# alarm
Alarms that ring at a time (op set, at = Unix ms), list alarms and reminders (op list), cancel alarms (op cancel; kind reminder cancels reminders).

Alarm at a time. "wake me up at 6am" -> {"action":"alarm","params":{"op":"set","at":<Unix ms of the next 06:00 from the PC CONTEXT time>}}. "what alarms do I have" -> op list.
