# chat_send
Open the chat with a contact in WhatsApp, Telegram, Signal, Discord or Slack and attach a file (path) or type a message (text). It never sends: say it is ready and the user must press Send. Never say "sent".

`to` is the contact name exactly as the user said it. To send a file made or found earlier in this chat, use its full path from the conversation.

Example:
```json
{"action":"chat_send","params":{"app":"whatsapp","to":"Kevin","path":"C:\\Users\\me\\Documents\\shopping.pdf"}}
```

Common mistakes: inventing a phone number; using a wa.me link (it cannot attach files); a file name without its folder.
