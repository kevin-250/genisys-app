// shadcn/ui Button (cva variants) with Animate UI-style press feedback from Motion (spring scale on tap/hover).
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { cva } from 'class-variance-authority';
import { cn } from './cn.js';

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-full border-0 p-0 outline-none '
  + 'transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] '
  + 'focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none '
  + '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand text-brand-ink shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-brand/90',
        ghost: 'bg-transparent text-fg/60 hover:bg-fg/[0.08] hover:text-fg',
        subtle: 'bg-fg/[0.08] text-fg hover:bg-fg/[0.14]',
      },
      size: { icon: 'size-9 [&_svg]:size-[18px]', sm: 'size-8 [&_svg]:size-4' },
    },
    defaultVariants: { variant: 'default', size: 'icon' },
  },
);

export const Button = forwardRef(function Button({ className, variant, size, ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.6 }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
