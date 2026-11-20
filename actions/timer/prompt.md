# timer
Countdown timer that rings when done: op set (seconds, optional label), status (time left), cancel.

Countdown timer. "set a timer for 10 minutes" -> {"action":"timer","params":{"op":"set","seconds":600}}. "how long left" -> op status. "cancel the timer" -> op cancel.
