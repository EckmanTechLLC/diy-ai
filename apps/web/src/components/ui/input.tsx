import * as React from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive/40';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(field, 'h-9 py-1', className)} {...props} />;
}

export { Input, field };
