// prompt-kit Steps (https://prompt-kit.com), ported to JSX.
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.jsx';
import { cn } from '../cn.js';

export const StepsItem = ({ children, className, ...props }) => (
  <div className={cn('text-muted-foreground text-sm', className)} {...props}>{children}</div>
);

export const StepsTrigger = ({ children, className, leftIcon, swapIconOnHover = true, ...props }) => (
  <CollapsibleTrigger
    className={cn('group text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center justify-start gap-1 border-0 bg-transparent p-0 text-sm transition-colors', className)}
    {...props}
  >
    <div className="flex items-center gap-2">
      {leftIcon ? (
        <span className="relative inline-flex size-4 items-center justify-center">
          <span className={cn('transition-opacity', swapIconOnHover && 'group-hover:opacity-0')}>{leftIcon}</span>
          {swapIconOnHover && <ChevronDown className="absolute size-4 opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:rotate-180" />}
        </span>
      ) : null}
      <span>{children}</span>
    </div>
    {!leftIcon && <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />}
  </CollapsibleTrigger>
);

export const StepsBar = ({ className, ...props }) => <div className={cn('bg-muted h-full w-[2px]', className)} aria-hidden {...props} />;

export const StepsContent = ({ children, className, bar, ...props }) => (
  <CollapsibleContent
    className={cn('text-popover-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden', className)}
    {...props}
  >
    <div className="mt-3 grid max-w-full min-w-0 grid-cols-[min-content_minmax(0,1fr)] items-start gap-x-3">
      <div className="min-w-0 self-stretch">{bar ?? <StepsBar />}</div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  </CollapsibleContent>
);

export function Steps({ defaultOpen = true, className, ...props }) {
  return <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />;
}
