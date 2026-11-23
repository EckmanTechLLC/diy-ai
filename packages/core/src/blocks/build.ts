// Block builders and the circuit composer (ADR-008). Pure code; one 120 V circuit, one breaker, NM-B, plastic boxes.
//
// Conventions: gauge from the breaker (15 A -> 14 AWG, 20 A -> 12 AWG), x/2 cable everywhere except the 3-way traveler
// cable (x/3). Receptacles are pigtailed; lights on one switch are daisy-chained with a splice in each non-last box;
// the last device of a chain is wired directly. A block with something after it continues the unswitched feed from its
// feed-through box with a pigtail to its device.
import type { CircuitModel, Endpoint, WireColor } from '../schema';
import { Builder, C, S, T, cableTypeFor } from '../templates/builder';
import type { BreakerAmps } from '../templates/builder';
import { CircuitSpecSchema, type Block, type CircuitSpec, type CircuitSpecInput } from './schema';

/** What a block hands back: the box its feed cable arrives in is internal; the composer needs only the feed-through box. */
interface BlockResult {
  feedThroughBox: string;
}

class Ctx {
  readonly b: Builder;
  readonly two;
  readonly three;
  private counts = new Map<string, number>();
  constructor(id: string, title: string, amps: BreakerAmps) {
    this.b = new Builder(id, title);
    this.two = cableTypeFor(amps, 2);
    this.three = cableTypeFor(amps, 3);
  }
  /** "Light 5": numbered across the whole circuit within a group. */
  num(group: string, prefix: string): string {
    const n = (this.counts.get(group) ?? 0) + 1;
    this.counts.set(group, n);
    return `${prefix} ${n}`;
  }
  /** One wire nut: every conductor goes to the splice with `color`; an optional pigtail leaves it for a device terminal. */
  join(id: string, box: string, color: WireColor, ends: Endpoint[], pigtail?: { to: Endpoint; color: WireColor }) {
    this.b.splice(id, box);
    for (const e of ends) this.b.wire(e, S(id), color);
    if (pigtail) this.b.wire(S(id), pigtail.to, pigtail.color);
  }
  /** The three conductors of a 2-wire cable end of `cable` in `box`. */
  ends(cable: string, box: string) {
    return { black: C(cable, 'black', box), white: C(cable, 'white', box), bare: C(cable, 'bare', box) };
  }
}

interface Feed {
  /** Id of the cable arriving at this block. */
  cable: string;
  /** Box it comes from (the panel, or the previous block's feed-through box). */
  from: string;
  /** Cable name shown to the user. */
  name: string;
  /** Id of the cable that leaves this block's feed-through box toward the next block, or null if this is the last block. */
  onward: string | null;
}

function receptacleRun(ctx: Ctx, p: string, prm: Extract<Block, { type: 'receptacle_run' }>, feed: Feed): BlockResult {
  const { b } = ctx;
  const n = prm.count;
  for (let k = 1; k <= n; k++) {
    const box = `${p}-r${k}`;
    const dev = `${p}-rec${k}`;
    const inCable = k === 1 ? feed.cable : `${p}-run${k - 1}`;
    const outCable = k < n ? `${p}-run${k}` : feed.onward;
    const gfci = prm.gfciFirst && k === 1;
    b.box(box, ctx.num('receptacle-box', prm.boxLabel));
    if (k === 1) b.cable(feed.cable, ctx.two, feed.from, box, feed.name);
    else b.cable(inCable, ctx.two, `${p}-r${k - 1}`, box, `run ${k - 1}-${k}`);
    b.device(dev, box, gfci ? 'gfci' : 'duplex', ctx.num('receptacle', gfci ? prm.gfciLabel : prm.receptacleLabel));
    const inn = ctx.ends(inCable, box);
    const out = outCable === null ? null : ctx.ends(outCable, box);
    const g = T(dev, 'ground');
    if (gfci) {
      b.wire(inn.black, T(dev, 'line_hot'), 'black');
      b.wire(inn.white, T(dev, 'line_neutral'), 'white');
      if (out) {
        b.wire(out.black, T(dev, 'load_hot'), 'black');
        b.wire(out.white, T(dev, 'load_neutral'), 'white');
        ctx.join(`${p}-r${k}-g`, box, 'bare', [inn.bare, out.bare], { to: g, color: 'green' });
      } else b.wire(inn.bare, g, 'bare');
    } else if (out) {
      ctx.join(`${p}-r${k}-h`, box, 'black', [inn.black, out.black], { to: T(dev, 'brass'), color: 'black' });
      ctx.join(`${p}-r${k}-n`, box, 'white', [inn.white, out.white], { to: T(dev, 'silver'), color: 'white' });
      ctx.join(`${p}-r${k}-g`, box, 'bare', [inn.bare, out.bare], { to: g, color: 'green' });
    } else {
      b.wire(inn.black, T(dev, 'brass'), 'black');
      b.wire(inn.white, T(dev, 'silver'), 'white');
      b.wire(inn.bare, g, 'bare');
    }
  }
  return { feedThroughBox: `${p}-r${n}` };
}

/** Light (or fan) boxes after a switch: `load` arrives at the first; each box but the last passes the cable on. */
function loadChain(
  ctx: Ctx,
  p: string,
  load: { cable: string; from: string },
  n: number,
  kind: 'light' | 'fan',
  labels: { box: string; device: string },
) {
  const { b } = ctx;
  for (let k = 1; k <= n; k++) {
    const box = kind === 'fan' ? `${p}-fan` : `${p}-l${k}`;
    const dev = kind === 'fan' ? `${p}-fan-dev` : `${p}-light${k}`;
    const inCable = k === 1 ? load.cable : `${p}-chain${k - 1}`;
    const outCable = k < n ? `${p}-chain${k}` : null;
    b.box(box, ctx.num(`${kind}-box`, labels.box));
    if (k === 1) b.cable(inCable, ctx.two, load.from, box, 'load');
    else b.cable(inCable, ctx.two, `${p}-l${k - 1}`, box, `light ${k - 1}-${k}`);
    b.device(dev, box, kind, ctx.num(kind, labels.device));
    const inn = ctx.ends(inCable, box);
    if (outCable === null) {
      b.wire(inn.black, T(dev, 'hot'), 'black');
      b.wire(inn.white, T(dev, 'neutral'), 'white');
      b.wire(inn.bare, T(dev, 'ground'), 'bare');
    } else {
      const out = ctx.ends(outCable, box);
      ctx.join(`${p}-l${k}-h`, box, 'black', [inn.black, out.black], { to: T(dev, 'hot'), color: 'black' });
      ctx.join(`${p}-l${k}-n`, box, 'white', [inn.white, out.white], { to: T(dev, 'neutral'), color: 'white' });
      ctx.join(`${p}-l${k}-g`, box, 'bare', [inn.bare, out.bare], { to: T(dev, 'ground'), color: 'green' });
    }
  }
}

function switchLoads(
  ctx: Ctx,
  p: string,
  prm: { switchLabel: string; switchBoxLabel: string },
  feed: Feed,
  n: number,
  kind: 'light' | 'fan',
  labels: { box: string; device: string },
): BlockResult {
  const { b } = ctx;
  const box = `${p}-sw`;
  const sw = `${p}-switch`;
  const load = `${p}-load`;
  b.box(box, ctx.num('switch-box', prm.switchBoxLabel));
  b.cable(feed.cable, ctx.two, feed.from, box, feed.name);
  b.device(sw, box, 'switch_sp', ctx.num('switch', prm.switchLabel));
  const inn = ctx.ends(feed.cable, box);
  const ld = ctx.ends(load, box);
  const out = feed.onward === null ? null : ctx.ends(feed.onward, box);
  if (out) ctx.join(`${p}-sw-h`, box, 'black', [inn.black, out.black], { to: T(sw, 't1'), color: 'black' });
  else b.wire(inn.black, T(sw, 't1'), 'black');
  b.wire(ld.black, T(sw, 't2'), 'black');
  ctx.join(`${p}-sw-n`, box, 'white', out ? [inn.white, ld.white, out.white] : [inn.white, ld.white]);
  ctx.join(`${p}-sw-g`, box, 'bare', out ? [inn.bare, ld.bare, out.bare] : [inn.bare, ld.bare], { to: T(sw, 'ground'), color: 'green' });
  loadChain(ctx, p, { cable: load, from: box }, n, kind, labels);
  return { feedThroughBox: box };
}

function threeWayLights(ctx: Ctx, p: string, prm: Extract<Block, { type: 'three_way_lights' }>, feed: Feed): BlockResult {
  const { b } = ctx;
  const box1 = `${p}-sw1`;
  const box2 = `${p}-sw2`;
  const trav = `${p}-trav`;
  const load = `${p}-load`;
  // Box 1: feed arrives, traveler cable leaves; power may continue onward from here (unswitched).
  b.box(box1, ctx.num('switch-box', prm.switchBoxLabel));
  b.cable(feed.cable, ctx.two, feed.from, box1, feed.name);
  b.device(`${p}-switch1`, box1, 'switch_3way', ctx.num('switch', prm.switchLabel));
  b.box(box2, ctx.num('switch-box', prm.switchBoxLabel));
  b.cable(trav, ctx.three, box1, box2, 'travelers');
  b.device(`${p}-switch2`, box2, 'switch_3way', ctx.num('switch', prm.switchLabel));
  const sw1 = `${p}-switch1`;
  const sw2 = `${p}-switch2`;
  const f1 = ctx.ends(feed.cable, box1);
  const t1 = ctx.ends(trav, box1);
  const o1 = feed.onward === null ? null : ctx.ends(feed.onward, box1);
  if (o1) ctx.join(`${p}-sw1-h`, box1, 'black', [f1.black, o1.black], { to: T(sw1, 'common'), color: 'black' });
  else b.wire(f1.black, T(sw1, 'common'), 'black');
  b.wire(C(trav, 'red', box1), T(sw1, 'traveler_a'), 'red');
  b.wire(t1.black, T(sw1, 'traveler_b'), 'black');
  ctx.join(`${p}-sw1-n`, box1, 'white', o1 ? [f1.white, t1.white, o1.white] : [f1.white, t1.white]);
  ctx.join(`${p}-sw1-g`, box1, 'bare', o1 ? [f1.bare, t1.bare, o1.bare] : [f1.bare, t1.bare], { to: T(sw1, 'ground'), color: 'green' });
  // Box 2: travelers arrive, load cable leaves.
  const t2 = ctx.ends(trav, box2);
  const l2 = ctx.ends(load, box2);
  b.wire(C(trav, 'red', box2), T(sw2, 'traveler_a'), 'red');
  b.wire(t2.black, T(sw2, 'traveler_b'), 'black');
  b.wire(l2.black, T(sw2, 'common'), 'black');
  ctx.join(`${p}-sw2-n`, box2, 'white', [t2.white, l2.white]);
  ctx.join(`${p}-sw2-g`, box2, 'bare', [t2.bare, l2.bare], { to: T(sw2, 'ground'), color: 'green' });
  loadChain(ctx, p, { cable: load, from: box2 }, prm.count, 'light', { box: prm.lightBoxLabel, device: prm.lightLabel });
  return { feedThroughBox: box1 };
}

/** Two single-pole switches in one 2-gang box; each switch has its own load cable and its own daisy-chain of lights. */
function twoGangSwitches(ctx: Ctx, p: string, prm: Extract<Block, { type: 'two_gang_switches' }>, feed: Feed): BlockResult {
  const { b } = ctx;
  const box = `${p}-gang`;
  b.box(box, ctx.num('gang-box', prm.gangBoxLabel));
  b.cable(feed.cable, ctx.two, feed.from, box, feed.name);
  b.device(`${p}-swa`, box, 'switch_sp', ctx.num('switch', prm.switchLabel));
  b.device(`${p}-swb`, box, 'switch_sp', ctx.num('switch', prm.switchLabel));
  const inn = ctx.ends(feed.cable, box);
  const out = feed.onward === null ? null : ctx.ends(feed.onward, box);
  const sides = [
    { s: 'a', count: prm.countA },
    { s: 'b', count: prm.countB },
  ] as const;
  const load = (s: 'a' | 'b') => `${p}-load${s}`;
  const ld = { a: ctx.ends(load('a'), box), b: ctx.ends(load('b'), box) };
  // Hot: the feed hot (and the onward hot) meets a black pigtail to each switch input.
  b.splice(`${p}-hot`, box);
  for (const e of out ? [inn.black, out.black] : [inn.black]) b.wire(e, S(`${p}-hot`), 'black');
  for (const { s } of sides) b.wire(S(`${p}-hot`), T(`${p}-sw${s}`, 't1'), 'black');
  // Each switch output goes to its own load cable.
  for (const { s } of sides) b.wire(ld[s].black, T(`${p}-sw${s}`, 't2'), 'black');
  // Neutrals: feed + both loads (+ onward).
  b.splice(`${p}-wh`, box);
  for (const e of [inn.white, ld.a.white, ld.b.white, ...(out ? [out.white] : [])]) b.wire(e, S(`${p}-wh`), 'white');
  // Grounds: feed + both loads (+ onward), and a green pigtail to each switch.
  b.splice(`${p}-gr`, box);
  for (const e of [inn.bare, ld.a.bare, ld.b.bare, ...(out ? [out.bare] : [])]) b.wire(e, S(`${p}-gr`), 'bare');
  for (const { s } of sides) b.wire(S(`${p}-gr`), T(`${p}-sw${s}`, 'ground'), 'green');
  for (const { s, count } of sides)
    loadChain(ctx, `${p}-${s}`, { cable: load(s), from: box }, count, 'light', { box: prm.lightBoxLabel, device: prm.lightLabel });
  return { feedThroughBox: box };
}

/** Compose a circuit from blocks, in list order; block 1 is fed from the panel. Throws a readable Error on invalid input. */
export function buildCircuit(input: CircuitSpecInput): CircuitModel {
  const parsed = CircuitSpecSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `invalid circuit specification: ${parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`).join('; ')}`,
    );
  return composeCircuit(parsed.data);
}

function composeCircuit(spec: CircuitSpec): CircuitModel {
  const ctx = new Ctx(spec.id, spec.title, spec.breakerAmps);
  ctx.b.panel(spec.breakerAmps, 'b1-feed');
  let from = 'panel';
  spec.blocks.forEach((block, i) => {
    const p = `b${i + 1}`;
    const feed: Feed = {
      cable: `${p}-feed`,
      from,
      name: i === 0 ? 'feed' : `feed ${i + 1}`,
      onward: i + 1 < spec.blocks.length ? `b${i + 2}-feed` : null,
    };
    let result: BlockResult;
    switch (block.type) {
      case 'receptacle_run':
        result = receptacleRun(ctx, p, block, feed);
        break;
      case 'switch_lights':
        result = switchLoads(ctx, p, block, feed, block.count, 'light', { box: block.lightBoxLabel, device: block.lightLabel });
        break;
      case 'three_way_lights':
        result = threeWayLights(ctx, p, block, feed);
        break;
      case 'two_gang_switches':
        result = twoGangSwitches(ctx, p, block, feed);
        break;
      case 'switch_fan':
        result = switchLoads(ctx, p, block, feed, 1, 'fan', { box: block.fanBoxLabel, device: block.fanLabel });
        break;
    }
    from = result.feedThroughBox;
  });
  return ctx.b.build();
}
