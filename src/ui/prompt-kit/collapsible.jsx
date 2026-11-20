// shadcn/ui Collapsible (Radix), as prompt-kit expects it.
import * as C from '@radix-ui/react-collapsible';

export const Collapsible = (props) => <C.Root data-slot="collapsible" {...props} />;
export const CollapsibleTrigger = (props) => <C.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
export const CollapsibleContent = (props) => <C.CollapsibleContent data-slot="collapsible-content" {...props} />;
