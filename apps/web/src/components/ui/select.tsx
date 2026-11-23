import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { field } from './input';

/** A native select (keyboard and screen reader behaviour for free) in the look of the other fields. */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select className={cn(field, 'h-9 appearance-none py-1 pr-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
}

export { Select };
