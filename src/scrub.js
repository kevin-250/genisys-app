// Removes the user's home folder and Windows user name from text before it leaves the PC (error reports).
export function scrub(s, max, home, user) {
  let t = String(s ?? '');
  if (home) t = t.split(home).join('~');
  if (user && user.length >= 3) t = t.split(user).join('<user>'); // very short names would mangle normal words
  return t.slice(0, max);
}
