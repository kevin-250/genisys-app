// The top bar's one menu (replaces the row of icons). Each item clicks the old, now hidden, button, so every existing
// handler (panels, theme, quit…) keeps working unchanged.
import { BookUser, Brain, Ellipsis, HelpCircle, LayoutGrid, MessagesSquare, Moon, Plus, Power, Settings, Sun } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './dropdown-menu.jsx';

const press = (sel) => () => setTimeout(() => document.querySelector(sel)?.click(), 0); // after the menu closes
const ITEMS = [
  [{ label: 'New agent', icon: Plus, sel: '#add', keys: 'Ctrl Alt N' }],
  [{ label: 'Chats', icon: MessagesSquare, sel: '[data-open="chats"]' }, { label: 'Tools', icon: LayoutGrid, sel: '[data-open="tools"]' },
    { label: 'Memory', icon: Brain, sel: '[data-open="memory"]' }, { label: 'About you', icon: BookUser, sel: '[data-open="about"]' }],
  [{ label: 'Settings', icon: Settings, sel: '[data-open="settings"]', keys: 'Ctrl ,' }, { label: 'Help', icon: HelpCircle, sel: '#help-ico', keys: 'F1' }],
];

export function AppMenu() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  return (
    <DropdownMenu onOpenChange={(o) => o && setDark(document.documentElement.dataset.theme === 'dark')}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ico app-menu" aria-label="Menu" title="Menu"><Ellipsis aria-hidden /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {ITEMS.map((group, gi) => (
          <div key={gi}>
            {gi ? <DropdownMenuSeparator /> : null}
            {group.filter((it) => document.querySelector(it.sel)).map((it) => (
              <DropdownMenuItem key={it.label} onSelect={press(it.sel)}>
                <it.icon aria-hidden />{it.label}{it.keys ? <DropdownMenuShortcut>{it.keys}</DropdownMenuShortcut> : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={press('#theme')}>{dark ? <Sun aria-hidden /> : <Moon aria-hidden />}{dark ? 'Light mode' : 'Dark mode'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={press('#quit')} className="text-danger"><Power aria-hidden className="!text-danger" />Quit Genisys</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
