// The prompt bar, laid out like shadcn's prompt-input (an InputGroup: the text on top, a row of icon buttons under it).
// React draws it once; app.js and voice/ui.js drive it through the same ids as before (#form, #input, #send, #mic,
// #vpill, #ps), so it never re-renders over their changes. The model / effort menus are small components of their own.
import { useEffect, useState } from 'react';
import { ArrowUp, ChevronDown, Mic, Plus, Slash, Square } from 'lucide-react';
import { Button } from './button.jsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './dropdown-menu.jsx';
import { cn } from './cn.js';

const BARS = 7;
const click = (id) => () => document.getElementById(id)?.click(); // the old buttons stay (hidden): their handlers do the work

// outline pill like shadcn's InputGroupButton size="sm"
const pill = 'glass inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-3 text-xs text-fg/80 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-brand/40 [&_svg]:size-3.5';

function ModelMenu() {
  const [models, setModels] = useState([]);
  const load = async (open) => { if (open) { try { const c = await window.api.config(); setModels(c.models || []); } catch {} } };
  useEffect(() => { load(true); }, []);
  const cur = models[0] || '';
  const short = (m) => String(m).replace(/:free$/, '').split('/').pop();
  const pick = async (m) => {
    const list = [m, ...models.filter((x) => x !== m)]; // tried top to bottom: the chosen one goes first
    setModels(list);
    await window.api.db('setSetting', 'models', list);
  };
  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(pill, 'ms-auto max-w-44')} aria-label="Model" title="Model">
          <span className="truncate">{cur ? short(cur) : 'Model'}</span><ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Model (the next one takes over when busy)</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={cur} onValueChange={pick}>
          {models.length ? models.map((m) => <DropdownMenuRadioItem key={m} value={m}><span className="truncate">{short(m)}</span></DropdownMenuRadioItem>)
            : <div className="px-2 py-1.5 text-muted-foreground">Loading…</div>}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const EFFORTS = [{ id: 'normal', name: 'Normal' }, { id: 'deep', name: 'Think harder' }];
function EffortMenu() {
  const [effort, setEffort] = useState('normal');
  const load = async (open) => { if (open) { try { const p = await window.api.db('getSetting', 'prefs', {}); setEffort(p?.deep ? 'deep' : 'normal'); } catch {} } };
  useEffect(() => { load(true); }, []);
  const pick = async (id) => {
    setEffort(id);
    const p = (await window.api.db('getSetting', 'prefs', {})) || {};
    await window.api.db('setSetting', 'prefs', { ...p, deep: id === 'deep' });
  };
  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={pill} aria-label="Effort" title="Effort">
          <span className="text-muted-foreground">Effort</span>{EFFORTS.find((e) => e.id === effort)?.name}<ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effort} onValueChange={pick}>
          {EFFORTS.map((e) => <DropdownMenuRadioItem key={e.id} value={e.id}>{e.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InputBar() {
  return (
    <form id="form" className="pi relative flex w-full flex-col">
      <span id="ps" className="ps hidden" aria-hidden="true">genisys⟹</span>
      <span id="vpill" role="status" aria-label="Listening" title="Click (or press Enter) to send">
        {Array.from({ length: BARS }, (_, i) => <i key={i} />)}
      </span>
      <textarea
        id="input"
        rows={1}
        spellCheck={false}
        aria-label="Message"
        className="min-h-11 max-h-[160px] w-full resize-none overflow-y-auto border-0 bg-transparent px-3 pt-3 pb-1 text-[15px] leading-[22px] text-fg caret-brand outline-none placeholder:text-fg/40"
      />
      {/* the InputGroupAddon align="block-end" row: icon buttons only (titles say what they do) */}
      <div className="pi-bar flex items-center gap-1.5 px-2 pb-2">
        <button type="button" className="glass pi-ico" onClick={click('attach')} aria-label="Attach files" title="Attach files"><Plus aria-hidden /></button>
        <button type="button" className="glass pi-ico" onClick={click('slashbtn')} aria-label="Actions" title="Actions: agents, browser, script, search (/)"><Slash aria-hidden /></button>
        <ModelMenu />
        <EffortMenu />
        <Button type="button" id="mic" variant="ghost" className="glass" title="Speak, then press Enter" aria-label="Speak"><Mic strokeWidth={2.1} /></Button>
        <Button type="submit" id="send" title="Send (Enter)" aria-label="Send">
          <ArrowUp className="i-up" strokeWidth={2.4} />
          <Square className="i-stop" strokeWidth={0} fill="currentColor" />
        </Button>
      </div>
    </form>
  );
}
