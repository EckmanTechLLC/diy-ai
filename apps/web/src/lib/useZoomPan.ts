import { useCallback, useEffect, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom';

/** Space kept around the diagram when it is fitted, in screen pixels. */
export const FIT_PADDING = 24;
/** Largest zoom (8 = 800%). The smallest is half of the fit zoom. */
export const MAX_ZOOM = 8;
/** A fitted view never magnifies a small diagram beyond this. */
export const MAX_FIT_ZOOM = 1.5;
/** A press that moves farther than this (screen px) is a drag, not a click. */
export const CLICK_DISTANCE = 4;
const KEY_ZOOM = 1.25;
const KEY_PAN = 60;

/** Zoom that fits `content` in `view` with padding, before clamping. */
export const fitZoom = (view: { width: number; height: number }, content: { width: number; height: number }): number =>
  Math.min((view.width - 2 * FIT_PADDING) / content.width, (view.height - 2 * FIT_PADDING) / content.height);

interface View {
  /** Zoom as a fraction, 1 = 100%. */
  k: number;
  min: number;
}

/**
 * Pan and zoom for a fixed-size content box, using d3-zoom. `surfaceRef` is the element that receives the
 * gestures (wheel, drag, pinch, double-click); `viewportRef` is the element whose CSS transform is moved.
 * The view re-fits when the surface is resized, unless the user has zoomed or panned since the last fit.
 */
export function useZoomPan(content: { width: number; height: number }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const fitted = useRef(true);
  const [view, setView] = useState<View>({ k: 1, min: 0.1 });
  const { width, height } = content;

  const fit = useCallback(() => {
    const el = surfaceRef.current;
    const b = behavior.current;
    if (!el || !b || el.clientWidth === 0 || el.clientHeight === 0) return;
    const k = Math.min(fitZoom({ width: el.clientWidth, height: el.clientHeight }, { width, height }), MAX_FIT_ZOOM);
    const t = zoomIdentity.translate((el.clientWidth - width * k) / 2, (el.clientHeight - height * k) / 2).scale(k);
    fitted.current = true;
    select(el).call(b.transform, t);
  }, [width, height]);

  useEffect(() => {
    const el = surfaceRef.current;
    const vp = viewportRef.current;
    if (!el || !vp) return;
    const b = zoom<HTMLDivElement, unknown>()
      .clickDistance(CLICK_DISTANCE)
      .scaleExtent([0.1, MAX_ZOOM])
      .translateExtent([
        [-width, -height],
        [2 * width, 2 * height],
      ])
      .on('zoom', (e) => {
        const t = e.transform;
        vp.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        // gestures (a sourceEvent) end fit mode; programmatic fits do not
        if (e.sourceEvent) fitted.current = false;
        setView((v) => (v.k === t.k ? v : { ...v, k: t.k }));
      });
    behavior.current = b;
    select(el).call(b);

    const onResize = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const min = Math.min(fitZoom({ width: el.clientWidth, height: el.clientHeight }, { width, height }), 1) * 0.5;
      b.scaleExtent([min, MAX_ZOOM]);
      setView((v) => ({ ...v, min }));
      if (fitted.current) fit();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    onResize();
    return () => {
      ro.disconnect();
      select(el).on('.zoom', null);
      behavior.current = null;
    };
  }, [width, height, fit]);

  const zoomBy = useCallback((factor: number) => {
    const el = surfaceRef.current;
    const b = behavior.current;
    if (!el || !b) return;
    fitted.current = false;
    select(el).call(b.scaleBy, factor);
  }, []);

  const actualSize = useCallback(() => {
    const el = surfaceRef.current;
    const b = behavior.current;
    if (!el || !b) return;
    fitted.current = false;
    select(el).call(b.scaleTo, 1);
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    const el = surfaceRef.current;
    const b = behavior.current;
    if (!el || !b) return;
    fitted.current = false;
    // translateBy works in content units, and the content moves opposite to the view
    const k = zoomTransform(el).k;
    select(el).call(b.translateBy, -dx / k, -dy / k);
  }, []);

  /**
   * Bring a screen-space rectangle (e.g. from getBoundingClientRect) into view: nothing happens when it is
   * already inside the surface; otherwise it is centred, zooming out only as far as needed to fit it.
   */
  const reveal = useCallback((target: { left: number; top: number; right: number; bottom: number }) => {
    const el = surfaceRef.current;
    const vp = viewportRef.current;
    const b = behavior.current;
    if (!el || !vp || !b || el.clientWidth === 0 || el.clientHeight === 0) return;
    const s = el.getBoundingClientRect();
    const inset = FIT_PADDING / 2;
    if (target.left >= s.left + inset && target.top >= s.top + inset && target.right <= s.right - inset && target.bottom <= s.bottom - inset) return;
    const k = zoomTransform(el).k;
    const v = vp.getBoundingClientRect();
    // the rectangle in content units
    const w = (target.right - target.left) / k;
    const h = (target.bottom - target.top) / k;
    const cx = (target.left - v.left) / k + w / 2;
    const cy = (target.top - v.top) / k + h / 2;
    const [min] = b.scaleExtent();
    const k2 = Math.max(min, Math.min(k, fitZoom({ width: el.clientWidth, height: el.clientHeight }, { width: w, height: h })));
    fitted.current = false;
    select(el).call(b.transform, zoomIdentity.translate(el.clientWidth / 2 - cx * k2, el.clientHeight / 2 - cy * k2).scale(k2));
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      switch (e.key) {
        case '+':
        case '=':
          zoomBy(KEY_ZOOM);
          break;
        case '-':
        case '_':
          zoomBy(1 / KEY_ZOOM);
          break;
        case '0':
          fit();
          break;
        case 'ArrowLeft':
          panBy(-KEY_PAN, 0);
          break;
        case 'ArrowRight':
          panBy(KEY_PAN, 0);
          break;
        case 'ArrowUp':
          panBy(0, -KEY_PAN);
          break;
        case 'ArrowDown':
          panBy(0, KEY_PAN);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    },
    [zoomBy, fit, panBy],
  );

  return {
    surfaceRef,
    viewportRef,
    /** Current zoom, 1 = 100%. */
    zoom: view.k,
    atMin: view.k <= view.min + 1e-6,
    atMax: view.k >= MAX_ZOOM - 1e-6,
    zoomIn: () => zoomBy(KEY_ZOOM),
    zoomOut: () => zoomBy(1 / KEY_ZOOM),
    fit,
    actualSize,
    reveal,
    onKeyDown,
  };
}
