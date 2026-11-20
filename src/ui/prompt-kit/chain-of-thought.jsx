// prompt-kit ChainOfThought (https://prompt-kit.com), ported to JSX. Same structure and classes as the original.
import React from 'react';
import { ChevronDown, Circle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.jsx';
import { cn } from '../cn.js';

export const ChainOfThoughtItem = ({ children, className, ...props }) => (
  <div className={cn('text-muted-foreground text-sm', className)} {...props}>{children}</div>
);

export const ChainOfThoughtTrigger = ({ children, className, leftIcon, swapIconOnHover = true, ...props }) => (
  <CollapsibleTrigger
    className={cn('group text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-start gap-1 border-0 bg-transparent p-0 text-left text-sm transition-colors', className)}
    {...props}
  >
    <div className="flex min-w-0 items-center gap-2">
      {leftIcon ? (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
          <span className={cn('transition-opacity', swapIconOnHover && 'group-hover:opacity-0')}>{leftIcon}</span>
          {swapIconOnHover && <ChevronDown className="absolute size-4 opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:rotate-180" />}
        </span>
      ) : (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center"><Circle className="size-2 fill-current" /></span>
      )}
      <span className="min-w-0">{children}</span>
    </div>
    {!leftIcon && <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />}
  </CollapsibleTrigger>
);

export const ChainOfThoughtContent = ({ children, className, ...props }) => (
  <CollapsibleContent
    className={cn('text-popover-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden', className)}
    {...props}
  >
    <div className="grid grid-cols-[min-content_minmax(0,1fr)] gap-x-4">
      <div className="bg-primary/20 ml-1.75 h-full w-px group-data-[last=true]:hidden" />
      <div className="ml-1.75 h-full w-px bg-transparent group-data-[last=false]:hidden" />
      <div className="mt-2 min-w-0 space-y-2">{children}</div>
    </div>
  </CollapsibleContent>
);

export function ChainOfThought({ children, className }) {
  const kids = React.Children.toArray(children);
  return (
    <div className={cn('space-y-0', className)}>
      {kids.map((child, i) => (
        <React.Fragment key={child.key ?? i}>
          {React.isValidElement(child) && React.cloneElement(child, { isLast: i === kids.length - 1 })}
        </React.Fragment>
      ))}
    </div>
  );
}

export const ChainOfThoughtStep = ({ children, className, isLast = false, ...props }) => (
  <Collapsible className={cn('group', className)} data-last={isLast} {...props}>
    {children}
    <div className="flex justify-start group-data-[last=true]:hidden"><div className="bg-primary/20 ml-1.75 h-4 w-px" /></div>
  </Collapsible>
);
