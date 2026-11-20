// prompt-kit Source (https://prompt-kit.com), ported to JSX. One change: no favicons. They load from Google (blocked by
// this app's CSP, and it would tell Google every site the user looks at), so a letter badge stands in for the icon.
import { createContext, useContext } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { cn } from '../cn.js';

const Ctx = createContext(null);
const useSource = () => { const c = useContext(Ctx); if (!c) throw new Error('Source.* must be used inside <Source>'); return c; };
const Badge = ({ domain, className }) => (
  <span className={cn('bg-fg/15 text-fg inline-grid size-3.5 shrink-0 place-items-center rounded-full text-[9px] font-semibold uppercase', className)} aria-hidden>
    {domain.replace(/^www\./, '').charAt(0)}
  </span>
);

export function Source({ href, onOpen, children }) {
  let domain = '';
  try { domain = new URL(href).hostname; } catch { domain = href.split('/').pop() || href; }
  return <Ctx.Provider value={{ href, domain, onOpen }}><HoverCard.Root openDelay={150} closeDelay={0}>{children}</HoverCard.Root></Ctx.Provider>;
}

// links open in the user's browser (the app's own window never navigates away)
const click = (onOpen, href) => (e) => { e.preventDefault(); onOpen?.(href); };

export function SourceTrigger({ label, showFavicon = false, className }) {
  const { href, domain, onOpen } = useSource();
  return (
    <HoverCard.Trigger asChild>
      <a href={href} onClick={click(onOpen, href)}
        className={cn('bg-muted text-muted-foreground hover:bg-muted-foreground/30 hover:text-primary inline-flex h-5 max-w-40 items-center gap-1 overflow-hidden rounded-full py-0 text-xs no-underline transition-colors duration-150', showFavicon ? 'pr-2 pl-1' : 'px-1.5', className)}>
        {showFavicon && <Badge domain={domain} />}
        <span className="truncate text-center font-normal tabular-nums">{label ?? domain.replace('www.', '')}</span>
      </a>
    </HoverCard.Trigger>
  );
}

export function SourceContent({ title, description, className }) {
  const { href, domain, onOpen } = useSource();
  return (
    <HoverCard.Portal>
      <HoverCard.Content sideOffset={6}
        className={cn('bg-popover text-popover-foreground border-fg/10 z-[200] w-80 rounded-xl border p-0 shadow-lg outline-none',
          'pk-pop', className)}>
        <a href={href} onClick={click(onOpen, href)} className="flex flex-col gap-2 p-3 no-underline">
          <div className="flex items-center gap-1.5">
            <Badge domain={domain} className="size-4" />
            <div className="text-primary truncate text-sm">{domain.replace('www.', '')}</div>
          </div>
          <div className="text-fg line-clamp-2 text-sm font-medium">{title}</div>
          {description ? <div className="text-muted-foreground line-clamp-2 text-sm">{description}</div> : null}
        </a>
      </HoverCard.Content>
    </HoverCard.Portal>
  );
}
