// shadcn/ui DropdownMenu (Radix), the parts the prompt bar and the app menu use.
import * as M from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from './cn.js';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;
export const DropdownMenuRadioGroup = M.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset}
        className={cn('pk-pop z-[300] min-w-40 overflow-hidden rounded-xl border border-fg/10 bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none', className)}
        {...props} />
    </M.Portal>
  );
}

const item = 'relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none transition-colors duration-150 data-[highlighted]:bg-fg/[0.07] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

export const DropdownMenuItem = ({ className, ...props }) => <M.Item className={cn(item, className)} {...props} />;
export const DropdownMenuLabel = ({ className, ...props }) => <M.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
export const DropdownMenuSeparator = ({ className, ...props }) => <M.Separator className={cn('-mx-1 my-1 h-px bg-fg/10', className)} {...props} />;
export const DropdownMenuShortcut = ({ className, ...props }) => <span className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />;

export function DropdownMenuRadioItem({ className, children, ...props }) {
  return (
    <M.RadioItem className={cn(item, 'pr-8', className)} {...props}>
      {children}
      <span className="absolute right-2 flex size-4 items-center justify-center"><M.ItemIndicator><Check className="!text-fg" /></M.ItemIndicator></span>
    </M.RadioItem>
  );
}
