import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFound({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-3 px-6 py-24 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button asChild className="mt-2">
        <Link to="/">Back to projects</Link>
      </Button>
    </div>
  );
}
