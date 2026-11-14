// shortcut: regex blocklist, not a sandbox; a determined command (e.g. via powershell -enc) can slip by.
const RISKY = /\b(del|erase|rd|rmdir|format(?!-)|diskpart|shutdown|bcdedit|takeown|icacls|reg\s+(delete|add)|cipher\s+\/w|remove-item|rm|move|ren|robocopy\s+.*\/mir)\b|\s-enc(odedcommand)?\b/i;

export const isRisky = (cmd) => RISKY.test(cmd);
