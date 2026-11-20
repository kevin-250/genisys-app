// shadcn/ui's class helper: merge Tailwind classes, later ones win.
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));
