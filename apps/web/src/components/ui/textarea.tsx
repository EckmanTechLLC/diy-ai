import * as React from 'react';
import { cn } from '@/lib/utils';
import { field } from './input';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-20 resize-y py-2', className)} {...props} />;
}

export { Textarea };
