// Tiny loader: the floating to-do widget loads only its own small module; every other window loads the full app.
const mode = new URLSearchParams(location.search).get('mode');
// the window's look is set right now, before the big app script loads: the Alt+Space bar never draws as the main window
document.body.classList.add(`m-${mode || 'main'}`);
if (mode === 'todo') import('./todo.js'); else if (mode === 'tool') import('./toolwin.js'); else import('./ui/mount.jsx').then((m) => { m.mountInputBar(); return import('./app.js'); }); // the React prompt bar first: app.js looks up its ids
