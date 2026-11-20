// The AI's work trace under a request, built from prompt-kit pieces:
// ChainOfThought for the steps, Reasoning for "Thought for 4.5s", Steps + Source for web searches.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, Check, Globe, Loader2, Square, TerminalSquare, X } from 'lucide-react';
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtItem, ChainOfThoughtStep, ChainOfThoughtTrigger } from './prompt-kit/chain-of-thought.jsx';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './prompt-kit/reasoning.jsx';
import { Steps, StepsContent, StepsItem, StepsTrigger } from './prompt-kit/steps.jsx';
import { Source, SourceContent, SourceTrigger } from './prompt-kit/source.jsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './prompt-kit/collapsible.jsx';
import { cn } from './cn.js';

const fmt = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const useNow = (on) => {
  const [, tick] = useState(0);
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => tick((n) => n + 1), 200); return () => clearInterval(t); }, [on]);
  return Date.now();
};

// a DOM node made elsewhere in the app (command output, file tree, globe…) shown inside a step
function Foreign({ node }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current && node && node.parentNode !== ref.current) ref.current.replaceChildren(node); }, [node]);
  return <div ref={ref} className="min-w-0" />;
}

const icon = (s) => {
  if (s.state === 'on') return <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />;
  if (s.state === 'bad') return <X className="text-danger size-3.5" />;
  if (s.kind === 'think') return <Brain className="size-3.5" />;
  if (s.kind === 'web') return <Globe className="size-3.5" />;
  return <Check className="size-3.5" />;
};

function ThinkStep({ s, now }) {
  const ms = s.state === 'on' ? now - s.t0 : s.ms;
  if (!s.reasons.length) return <span className={cn('text-muted-foreground text-sm', s.state === 'on' && 'pk-shimmer')}>{s.state === 'on' ? 'Thinking…' : `Thought for ${fmt(ms)}`}</span>;
  return (
    <Reasoning isStreaming={s.state === 'on'}>
      <ReasoningTrigger><span className={cn('text-muted-foreground', s.state === 'on' && 'pk-shimmer')}>{s.state === 'on' ? 'Thinking…' : `Thought for ${fmt(ms)}`}</span></ReasoningTrigger>
      <ReasoningContent className="ml-1" contentClassName="mt-1 border-l-2 border-l-fg/15 px-2 pb-1">{s.reasons.join('\n\n')}</ReasoningContent>
    </Reasoning>
  );
}

function WebStep({ s, now, onOpen }) {
  const ms = s.state === 'on' ? now - s.t0 : s.ms;
  return (
    <Steps defaultOpen={false}>
      <StepsTrigger>
        <span className={cn(s.state === 'on' && 'pk-shimmer')}>{s.state === 'on' ? 'Searching the web' : 'Searched the web'}: </span>
        <span className="text-fg/80">{s.detail}</span> <span className="text-muted-foreground/70 ml-1 tabular-nums">{fmt(ms)}</span>
      </StepsTrigger>
      <StepsContent>
        {s.sources.length ? <StepsItem>Top matches</StepsItem> : <StepsItem>{s.state === 'on' ? 'Searching…' : 'No results'}</StepsItem>}
        {s.sources.length ? (
          <div className="flex flex-wrap gap-1.5">
            {s.sources.map((x) => (
              <Source key={x.url} href={x.url} onOpen={onOpen}>
                <SourceTrigger showFavicon label={(() => { try { return new URL(x.url).hostname.replace(/^www\./, ''); } catch { return x.url; } })()} />
                <SourceContent title={x.title || x.url} description={x.snippet || ''} />
              </Source>
            ))}
          </div>
        ) : null}
        {s.outs.map((o, i) => (typeof o === 'string' ? <StepsItem key={i}>{o}</StepsItem> : <Foreign key={i} node={o} />))}
      </StepsContent>
    </Steps>
  );
}

function ActStep({ s, now, isLast }) {
  const ms = s.state === 'on' ? now - s.t0 : s.ms;
  const has = s.outs.length > 0;
  const label = (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn('shrink-0', s.state === 'on' && 'pk-shimmer', s.state === 'bad' && 'text-danger')}>{s.label}</span>
      {s.detail ? <code className="bg-fg/[0.06] text-fg/80 truncate rounded-md px-1.5 py-0.5 font-mono text-xs">{s.detail}</code> : null}
      <span className="text-muted-foreground/70 shrink-0 tabular-nums">{fmt(ms)}</span>
    </span>
  );
  return (
    <ChainOfThoughtStep isLast={isLast} open={has ? s.open : false} onOpenChange={(v) => { s.open = v; s.rerender(); }}>
      <ChainOfThoughtTrigger leftIcon={icon(s)} swapIconOnHover={has} disabled={!has}>{label}</ChainOfThoughtTrigger>
      {has ? (
        <ChainOfThoughtContent>
          {s.outs.map((o, i) => (typeof o === 'string' ? <ChainOfThoughtItem key={i} className="whitespace-pre-wrap">{o}</ChainOfThoughtItem> : <Foreign key={i} node={o} />))}
        </ChainOfThoughtContent>
      ) : null}
    </ChainOfThoughtStep>
  );
}

// A step of the chain. Thinking and web steps wrap their own prompt-kit widget in a plain chain link.
function ChainLink({ s, now, onOpen, isLast }) {
  if (s.kind === 'act') return <ActStep s={s} now={now} isLast={isLast} />;
  return (
    <ChainOfThoughtStep isLast={isLast} open={false}>
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">{icon(s)}</span>
        <div className="min-w-0 flex-1">{s.kind === 'think' ? <ThinkStep s={s} now={now} /> : <WebStep s={s} now={now} onOpen={onOpen} />}</div>
      </div>
    </ChainOfThoughtStep>
  );
}

function StepList({ steps, now, onOpen }) {
  return (
    <ChainOfThought>
      {steps.map((s) => <ChainLink key={s.id} s={s} now={now} onOpen={onOpen} />)}
    </ChainOfThought>
  );
}

export function Trace({ m }) {
  const now = useNow(m.phase === 'working');
  const ms = (m.t1 || now) - m.t0;
  const working = m.phase === 'working';
  const count = m.steps.filter((s) => s.kind !== 'think').length + m.groups.reduce((n, g) => n + g.kids.filter((s) => s.kind !== 'think').length, 0);
  const title = working ? (m.groups.length ? `${m.groups.filter((g) => g.state === 'done').length} of ${m.groups.length} done` : 'Working')
    : m.label || (m.phase === 'done' ? `Done in ${count} step${count === 1 ? '' : 's'}` : `Couldn't finish · ${count} step${count === 1 ? '' : 's'}`);
  return (
    <Collapsible open={m.open} onOpenChange={(v) => { m.open = v; m.rerender(); }} className="trace-card" data-phase={m.phase}>
      <div className="flex items-center gap-2">
        <span className="lorb orb-slot" />
        <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-sm transition-colors" title={m.task}>
          {m.phase === 'done' ? <Check className="size-4 text-emerald-600" /> : m.phase === 'bad' ? <X className="text-danger size-4" /> : null}
          <span className={cn('truncate', working && 'pk-shimmer')}>{title}</span>
          <svg viewBox="0 0 24 24" className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </CollapsibleTrigger>
        <span className="text-muted-foreground/70 text-xs tabular-nums">{fmt(ms)}</span>
        {working ? (
          <button type="button" onClick={m.onStop} title="Stop (Esc)" className="text-muted-foreground hover:text-danger inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-2 py-0.5 text-xs">
            <Square className="size-3 fill-current" />stop
          </button>
        ) : null}
      </div>
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="mt-3 pl-1">
          {m.groups.length ? (
            <ChainOfThought>
              {m.groups.map((g, i) => (
                <ChainOfThoughtStep key={`g${i}`} open={g.open} onOpenChange={(v) => { g.open = v; m.rerender(); }}>
                  <ChainOfThoughtTrigger leftIcon={g.state === 'done' ? <Check className="size-3.5 text-emerald-600" /> : g.state === 'now' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <span className="bg-fg/25 block size-1.5 rounded-full" />}>
                    <span className={cn(g.state === 'now' && 'text-fg', g.state === 'todo' && 'opacity-70')}>{g.text}</span>
                    {g.kids.length ? <span className="text-muted-foreground/70 ml-1.5 text-xs">{g.kids.length}</span> : null}
                  </ChainOfThoughtTrigger>
                  <ChainOfThoughtContent>{g.kids.length ? <StepList steps={g.kids} now={now} onOpen={m.onOpenLink} /> : <ChainOfThoughtItem>Not started</ChainOfThoughtItem>}</ChainOfThoughtContent>
                </ChainOfThoughtStep>
              ))}
            </ChainOfThought>
          ) : null}
          {m.steps.length ? <div className={m.groups.length ? 'mt-3' : ''}><StepList steps={m.steps} now={now} onOpen={m.onOpenLink} /></div> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
