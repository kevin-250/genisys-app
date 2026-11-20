// prompt-kit Reasoning (https://prompt-kit.com), ported to JSX. Opens by itself while streaming, closes when done.
// Plain text only here (no markdown package): the model's notes are short sentences.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '../cn.js';

const Ctx = createContext(null);
const useReasoning = () => { const c = useContext(Ctx); if (!c) throw new Error('Reasoning.* must be inside <Reasoning>'); return c; };

export function Reasoning({ children, className, open, onOpenChange, isStreaming }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [wasAutoOpened, setWasAutoOpened] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const handleOpenChange = (v) => { if (!isControlled) setInternalOpen(v); onOpenChange?.(v); };
  useEffect(() => {
    if (isStreaming && !wasAutoOpened) { if (!isControlled) setInternalOpen(true); setWasAutoOpened(true); }
    if (!isStreaming && wasAutoOpened) { if (!isControlled) setInternalOpen(false); setWasAutoOpened(false); }
  }, [isStreaming, wasAutoOpened, isControlled]);
  return <Ctx.Provider value={{ isOpen, onOpenChange: handleOpenChange }}><div className={className}>{children}</div></Ctx.Provider>;
}

export function ReasoningTrigger({ children, className, ...props }) {
  const { isOpen, onOpenChange } = useReasoning();
  return (
    <button type="button" className={cn('flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-sm', className)} onClick={() => onOpenChange(!isOpen)} aria-expanded={isOpen} {...props}>
      <span className="text-primary">{children}</span>
      <div className={cn('transform transition-transform', isOpen ? 'rotate-180' : '')}><ChevronDownIcon className="size-4" /></div>
    </button>
  );
}

export function ReasoningContent({ children, className, contentClassName, ...props }) {
  const contentRef = useRef(null), innerRef = useRef(null);
  const { isOpen } = useReasoning();
  useEffect(() => {
    if (!contentRef.current || !innerRef.current) return undefined;
    const ro = new ResizeObserver(() => { if (contentRef.current && innerRef.current && isOpen) contentRef.current.style.maxHeight = `${innerRef.current.scrollHeight}px`; });
    ro.observe(innerRef.current);
    contentRef.current.style.maxHeight = isOpen ? `${innerRef.current.scrollHeight}px` : '0px';
    return () => ro.disconnect();
  }, [isOpen]);
  return (
    <div ref={contentRef} className={cn('overflow-hidden transition-[max-height] duration-150 ease-out motion-reduce:transition-none', className)} style={{ maxHeight: isOpen ? undefined : '0px' }} {...props}>
      <div ref={innerRef} className={cn('text-muted-foreground text-sm whitespace-pre-wrap', contentClassName)}>{children}</div>
    </div>
  );
}
