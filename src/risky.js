// shortcut: regex blocklist, not a sandbox; a determined command (e.g. via powershell -enc) can slip by.
const RISKY = /\b(del|erase|rd|rmdir|format(?!-)|diskpart|shutdown|bcdedit|takeown|icacls|reg\s+(delete|add|import)|cipher\s+\/w|remove-item|rm|move|ren|robocopy\s+.*\/mir|taskkill|sc\s+(delete|stop|config)|net\s+user|netsh|schtasks|set-executionpolicy|stop-process|stop-service|clear-disk)\b|\s-enc(odedcommand)?\b/i;

export const isRisky = (cmd) => RISKY.test(cmd);
