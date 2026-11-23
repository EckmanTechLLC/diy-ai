import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Maximize2, Palette, ZoomIn, ZoomOut } from 'lucide-react';
import type { CircuitModel } from '@diy-ai/core';
import { DiagramInspector } from '@/components/DiagramInspector';
import { DiagramLegend } from '@/components/DiagramLegend';
import { Button } from '@/components/ui/button';
import { highlightOf, sameSelection, wireTooltip, type Highlight, type Selection } from '@/lib/inspect';
import { CLICK_DISTANCE, MAX_ZOOM, useZoomPan } from '@/lib/useZoomPan';
import { cn } from '@/lib/utils';

/** What a pointer event landed on: a wire (its net), else a device, splice or cable, else nothing. */
function selectionAt(target: EventTarget | null): Selection | null {
  if (!(target instanceof Element)) return null;
  const net = target.closest('[data-net]')?.getAttribute('data-net');
  if (net) return { kind: 'net', net };
  const device = target.closest('[data-device]')?.getAttribute('data-device');
  if (device) return { kind: 'device', id: device };
  const splice = target.closest('[data-splice]')?.getAttribute('data-splice');
  if (splice) return { kind: 'splice', id: splice };
  const cable = target.closest('[data-cable]')?.getAttribute('data-cable');
  if (cable) return { kind: 'cable', id: cable };
  return null;
}

/** Marks what is highlighted (class dg-hl) and whether the rest of the wires should dim (class dg-focus on the svg). */
function applyHighlight(svg: SVGSVGElement, h: Highlight | null) {
  svg.querySelectorAll('.dg-hl').forEach((n) => n.classList.remove('dg-hl'));
  svg.classList.toggle('dg-focus', h !== null);
  if (!h) return;
  svg.querySelectorAll('g.wire').forEach((g) => {
    const conn = g.getAttribute('data-connection');
    const net = g.querySelector('path')?.getAttribute('data-net');
    if ((conn !== null && h.connections.has(conn)) || (h.net !== null && net === h.net)) g.classList.add('dg-hl');
  });
  const mark = (attr: string, ids: Set<string>, wires: boolean) =>
    svg.querySelectorAll(`g[${attr}]`).forEach((g) => {
      if (!ids.has(g.getAttribute(attr)!)) return;
      g.classList.add('dg-hl');
      if (wires) g.querySelectorAll('g.wire').forEach((w) => w.classList.add('dg-hl'));
    });
  mark('data-device', h.devices, false);
  mark('data-splice', h.splices, false);
  mark('data-cable', h.cables, true);
  if (h.boxes) mark('data-box', h.boxes, false);
}

/** A set of ids to light up because a rule finding involves them. */
export interface FindingFocus {
  /** Identifies the finding group, so a new one re-fits the view. */
  key: string;
  highlight: Highlight;
}

interface Hover {
  net: string;
  x: number;
  y: number;
  flip: boolean;
}

export function DiagramCanvas({
  circuit,
  svg,
  width,
  height,
  focus,
  onFocusChange,
}: {
  focus: FindingFocus | null;
  /** Called with null when the canvas takes over the highlight (a selection, Escape). */
  onFocusChange: (f: null) => void;
  circuit: CircuitModel;
  svg: string;
  width: number;
  height: number;
}) {
  const zoom = useZoomPan({ width, height });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();
  const press = useRef<{ x: number; y: number } | null>(null);

  // hovering a wire shows its net; otherwise the selection stays lit
  const active: Selection | null = hover ? { kind: 'net', net: hover.net } : selection;
  const activeKey = active ? (active.kind === 'net' ? `net:${active.net}` : `${active.kind}:${active.id}`) : '';
  // a hover or a selection wins over the finding highlight, which comes back when they end
  const focusKey = focus?.key ?? '';
  useEffect(() => {
    const el = zoom.viewportRef.current?.querySelector('svg');
    if (el) applyHighlight(el, active ? highlightOf(circuit, active) : (focus?.highlight ?? null));
  }, [circuit, activeKey, focusKey, svg]);

  // choosing a finding replaces the selection; a new finding group is brought into view
  useEffect(() => {
    if (!focus) return;
    setSelection(null);
    const el = zoom.viewportRef.current?.querySelector('svg');
    if (!el) return;
    applyHighlight(el, focus.highlight);
    let rect: { left: number; top: number; right: number; bottom: number } | null = null;
    el.querySelectorAll('.dg-hl').forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      rect = rect
        ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    if (rect) zoom.reveal(rect);
  }, [focusKey]);

  const choose = (s: Selection | null) => {
    setSelection(s);
    if (s) onFocusChange(null);
  };

  const hoverNet = hover?.net;
  const tip = useMemo(() => (hoverNet ? wireTooltip(circuit, hoverNet) : null), [circuit, hoverNet]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    press.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.focus({ preventScroll: true });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.buttons !== 0) return setHover(null);
    const net = selectionAt(e.target);
    if (net?.kind !== 'net') return setHover(null);
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    setHover((h) => (h && h.net === net.net && h.x === x && h.y === y ? h : { net: net.net, x, y, flip: x > r.width * 0.6 }));
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_DISTANCE) return; // that was a pan
    choose(selectionAt(e.target));
  };
  const percent = Math.round(zoom.zoom * 100);
  return (
    <div className="absolute inset-0" onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        setSelection(null);
        onFocusChange(null);
      }}>
      <div
        ref={zoom.surfaceRef}
        tabIndex={0}
        role="group"
        aria-label={`Wiring diagram: ${circuit.title}. Drag to pan, scroll to zoom. Keys: plus and minus zoom, 0 fits, arrows pan, Escape clears the selection.`}
        className={cn(
          'absolute inset-0 touch-none overflow-hidden outline-none select-none',
          'cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onKeyDown={zoom.onKeyDown}
      >
        <div
          ref={zoom.viewportRef}
          className="absolute top-0 left-0 origin-top-left [&>svg]:block"
          style={{ width, height }}
          // Output of this project's own renderer, which escapes all model text.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {hover && tip && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 max-w-64 rounded-md border bg-card px-2.5 py-1.5 text-xs text-card-foreground shadow-md"
            style={{ left: hover.x, top: hover.y, transform: `translate(${hover.flip ? 'calc(-100% - 14px)' : '14px'}, 14px)` }}
          >
            <p className="font-medium">{tip.title}</p>
            {tip.detail && <p className="text-muted-foreground">{tip.detail}</p>}
          </div>
        )}
      </div>

      <DiagramInspector
        model={circuit}
        selection={selection}
        onSelect={(s) => {
          if (!sameSelection(selection, s)) choose(s);
        }}
        onClose={() => choose(null)}
      />
      {legendOpen && <DiagramLegend id={legendId} />}

      <div
        role="toolbar"
        aria-label="Diagram view"
        className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border bg-card/95 p-1 text-card-foreground shadow-md backdrop-blur"
      >
        <Button variant="ghost" size="icon" className="size-8" onClick={zoom.zoomOut} disabled={zoom.atMin} aria-label="Zoom out" title="Zoom out (-)">
          <ZoomOut />
        </Button>
        <span className="min-w-11 text-center text-xs tabular-nums" title={`Zoom level (up to ${MAX_ZOOM * 100}%)`}>
          {percent}%
        </span>
        <Button variant="ghost" size="icon" className="size-8" onClick={zoom.zoomIn} disabled={zoom.atMax} aria-label="Zoom in" title="Zoom in (+)">
          <ZoomIn />
        </Button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={zoom.fit} title="Fit whole diagram in view (0)">
          <Maximize2 /> Fit
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={zoom.actualSize} title="Actual size, 100%">
          100%
        </Button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 px-2', legendOpen && 'bg-accent text-accent-foreground')}
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          aria-controls={legendOpen ? legendId : undefined}
          title="What the colours mean"
        >
          <Palette /> Legend
        </Button>
      </div>
    </div>
  );
}
