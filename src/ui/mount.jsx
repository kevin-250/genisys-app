// Draws the React prompt bar in place of #bar-host before app.js starts (flushSync: the ids exist when app.js looks them up).
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { InputBar } from './InputBar.jsx';
import { AppMenu } from './AppMenu.jsx';
import './bar.css';

export function mountInputBar() {
  const host = document.getElementById('bar-host');
  if (!host) return;
  const root = createRoot(host);
  flushSync(() => root.render(<MotionConfig reducedMotion="user"><InputBar /></MotionConfig>));
  const menu = document.getElementById('menu-host'); // the top bar's one menu
  if (menu) createRoot(menu).render(<AppMenu />);
}
