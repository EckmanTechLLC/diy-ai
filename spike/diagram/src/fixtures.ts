import type { Box, CircuitModel, Cable, Connection, Device, DeviceType, Endpoint, Splice, WireColor } from './model';

const T = (device: string, terminal: string): Endpoint => ({ kind: 'terminal', device, terminal });
const C = (cable: string, color: WireColor, box: string): Endpoint => ({ kind: 'conductor', cable, color, box });
const S = (splice: string): Endpoint => ({ kind: 'splice', splice });

const TWO: WireColor[] = ['black', 'white', 'bare'];
const THREE: WireColor[] = ['black', 'red', 'white', 'bare'];

class Builder {
  boxes: Box[] = [];
  devices: Device[] = [];
  cables: Cable[] = [];
  splices: Splice[] = [];
  connections: Connection[] = [];
  constructor(private id: string, private title: string) {}
  box(id: string, label: string, kind: Box['kind'] = 'box') {
    this.boxes.push({ id, label, kind });
  }
  device(id: string, box: string, type: DeviceType, label: string) {
    this.devices.push({ id, box, type, label });
  }
  cable(id: string, type: string, from: string, to: string, conductors: WireColor[], name: string) {
    this.cables.push({ id, label: `${type} "${name}"`, from, to, conductors });
  }
  splice(id: string, box: string) {
    this.splices.push({ id, box });
  }
  wire(a: Endpoint, b: Endpoint, color: WireColor) {
    this.connections.push({ id: `${this.id}-w${this.connections.length + 1}`, a, b, color });
  }
  /** Panel with a breaker feeding cable `feed` (black/white/bare). */
  panel(amps: number, feed: string) {
    this.box('panel', 'Panel', 'panel');
    this.device('breaker', 'panel', 'breaker', `${amps}A breaker`);
    this.device('nbar', 'panel', 'neutral_bar', 'Neutral bar');
    this.device('gbar', 'panel', 'ground_bar', 'Ground bar');
    this.wire(C(feed, 'black', 'panel'), T('breaker', 'out'), 'black');
    this.wire(C(feed, 'white', 'panel'), T('nbar', 'neutral_bar'), 'white');
    this.wire(C(feed, 'bare', 'panel'), T('gbar', 'ground_bar'), 'bare');
  }
  /** Light box fed by cable `load` (black->hot, white->neutral, bare->ground). */
  lightBox(box: string, label: string, load: string, light: string) {
    this.box(box, label);
    this.device(light, box, 'light', 'Light');
    this.wire(C(load, 'black', box), T(light, 'hot'), 'black');
    this.wire(C(load, 'white', box), T(light, 'neutral'), 'white');
    this.wire(C(load, 'bare', box), T(light, 'ground'), 'bare');
  }
  build(): CircuitModel {
    return {
      id: this.id,
      title: this.title,
      boxes: this.boxes,
      devices: this.devices,
      cables: this.cables,
      splices: this.splices,
      connections: this.connections,
    };
  }
}

function circuit1(): CircuitModel {
  const b = new Builder('c1', 'Circuit 1: single-pole switch, power at switch');
  b.panel(15, 'feed');
  b.box('swbox', 'Switch box');
  b.device('sw', 'swbox', 'switch_sp', 'Switch');
  b.cable('feed', '14/2 NM-B', 'panel', 'swbox', TWO, 'feed');
  b.cable('load', '14/2 NM-B', 'swbox', 'lightbox', TWO, 'load');
  b.splice('wn', 'swbox');
  b.splice('gn', 'swbox');
  b.wire(C('feed', 'black', 'swbox'), T('sw', 't1'), 'black');
  b.wire(C('load', 'black', 'swbox'), T('sw', 't2'), 'black');
  b.wire(C('feed', 'white', 'swbox'), S('wn'), 'white');
  b.wire(C('load', 'white', 'swbox'), S('wn'), 'white');
  b.wire(C('feed', 'bare', 'swbox'), S('gn'), 'bare');
  b.wire(C('load', 'bare', 'swbox'), S('gn'), 'bare');
  b.wire(S('gn'), T('sw', 'ground'), 'green');
  b.lightBox('lightbox', 'Light box', 'load', 'fix');
  return b.build();
}

function circuit2(): CircuitModel {
  const b = new Builder('c2', 'Circuit 2: 3-way, power at first switch, light after second');
  b.panel(15, 'feed');
  b.box('box1', 'Box 1 (SW1)');
  b.box('box2', 'Box 2 (SW2)');
  b.device('sw1', 'box1', 'switch_3way', 'SW1');
  b.device('sw2', 'box2', 'switch_3way', 'SW2');
  b.cable('feed', '14/2 NM-B', 'panel', 'box1', TWO, 'feed');
  b.cable('trav', '14/3 NM-B', 'box1', 'box2', THREE, 'travelers');
  b.cable('load', '14/2 NM-B', 'box2', 'lightbox', TWO, 'load');
  b.splice('w1', 'box1');
  b.splice('g1', 'box1');
  b.splice('w2', 'box2');
  b.splice('g2', 'box2');
  // Box 1
  b.wire(C('feed', 'black', 'box1'), T('sw1', 'common'), 'black');
  b.wire(C('trav', 'red', 'box1'), T('sw1', 'traveler_a'), 'red');
  b.wire(C('trav', 'black', 'box1'), T('sw1', 'traveler_b'), 'black');
  b.wire(C('feed', 'white', 'box1'), S('w1'), 'white');
  b.wire(C('trav', 'white', 'box1'), S('w1'), 'white');
  b.wire(C('feed', 'bare', 'box1'), S('g1'), 'bare');
  b.wire(C('trav', 'bare', 'box1'), S('g1'), 'bare');
  b.wire(S('g1'), T('sw1', 'ground'), 'green');
  // Box 2
  b.wire(C('trav', 'red', 'box2'), T('sw2', 'traveler_a'), 'red');
  b.wire(C('trav', 'black', 'box2'), T('sw2', 'traveler_b'), 'black');
  b.wire(C('load', 'black', 'box2'), T('sw2', 'common'), 'black');
  b.wire(C('trav', 'white', 'box2'), S('w2'), 'white');
  b.wire(C('load', 'white', 'box2'), S('w2'), 'white');
  b.wire(C('trav', 'bare', 'box2'), S('g2'), 'bare');
  b.wire(C('load', 'bare', 'box2'), S('g2'), 'bare');
  b.wire(S('g2'), T('sw2', 'ground'), 'green');
  b.lightBox('lightbox', 'Light box', 'load', 'fix');
  return b.build();
}

function circuit3(): CircuitModel {
  const b = new Builder('c3', 'Circuit 3: GFCI protecting a downstream receptacle');
  b.panel(20, 'feed');
  b.box('gfcibox', 'GFCI box');
  b.box('rbox', 'Receptacle box');
  b.device('gfci', 'gfcibox', 'gfci', 'GFCI');
  b.device('rec', 'rbox', 'duplex', 'Receptacle');
  b.cable('feed', '12/2 NM-B', 'panel', 'gfcibox', TWO, 'feed');
  b.cable('ds', '12/2 NM-B', 'gfcibox', 'rbox', TWO, 'downstream');
  b.splice('g', 'gfcibox');
  b.wire(C('feed', 'black', 'gfcibox'), T('gfci', 'line_hot'), 'black');
  b.wire(C('feed', 'white', 'gfcibox'), T('gfci', 'line_neutral'), 'white');
  b.wire(C('ds', 'black', 'gfcibox'), T('gfci', 'load_hot'), 'black');
  b.wire(C('ds', 'white', 'gfcibox'), T('gfci', 'load_neutral'), 'white');
  b.wire(C('feed', 'bare', 'gfcibox'), S('g'), 'bare');
  b.wire(C('ds', 'bare', 'gfcibox'), S('g'), 'bare');
  b.wire(S('g'), T('gfci', 'ground'), 'green');
  b.wire(C('ds', 'black', 'rbox'), T('rec', 'brass'), 'black');
  b.wire(C('ds', 'white', 'rbox'), T('rec', 'silver'), 'white');
  b.wire(C('ds', 'bare', 'rbox'), T('rec', 'ground'), 'bare');
  return b.build();
}

function circuit4(): CircuitModel {
  const b = new Builder('c4', 'Circuit 4: 2-gang box, two switches, two lights');
  b.panel(15, 'feed');
  b.box('gang', '2-gang box');
  b.device('swa', 'gang', 'switch_sp', 'SW-A');
  b.device('swb', 'gang', 'switch_sp', 'SW-B');
  b.cable('feed', '14/2 NM-B', 'panel', 'gang', TWO, 'feed');
  b.cable('loada', '14/2 NM-B', 'gang', 'lightabox', TWO, 'load A');
  b.cable('loadb', '14/2 NM-B', 'gang', 'lightbbox', TWO, 'load B');
  b.splice('hot', 'gang');
  b.splice('wh', 'gang');
  b.splice('gr', 'gang');
  b.wire(C('feed', 'black', 'gang'), S('hot'), 'black');
  b.wire(S('hot'), T('swa', 't1'), 'black');
  b.wire(S('hot'), T('swb', 't1'), 'black');
  b.wire(C('loada', 'black', 'gang'), T('swa', 't2'), 'black');
  b.wire(C('loadb', 'black', 'gang'), T('swb', 't2'), 'black');
  b.wire(C('feed', 'white', 'gang'), S('wh'), 'white');
  b.wire(C('loada', 'white', 'gang'), S('wh'), 'white');
  b.wire(C('loadb', 'white', 'gang'), S('wh'), 'white');
  b.wire(C('feed', 'bare', 'gang'), S('gr'), 'bare');
  b.wire(C('loada', 'bare', 'gang'), S('gr'), 'bare');
  b.wire(C('loadb', 'bare', 'gang'), S('gr'), 'bare');
  b.wire(S('gr'), T('swa', 'ground'), 'green');
  b.wire(S('gr'), T('swb', 'ground'), 'green');
  b.lightBox('lightabox', 'Light A box', 'loada', 'fixa');
  b.lightBox('lightbbox', 'Light B box', 'loadb', 'fixb');
  return b.build();
}

export const FIXTURES: CircuitModel[] = [circuit1(), circuit2(), circuit3(), circuit4()];
