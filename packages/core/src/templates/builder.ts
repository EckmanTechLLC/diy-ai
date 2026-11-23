import type { DeviceType } from '../catalogue';
import type { Box, Cable, CableType, CircuitModel, Connection, Device, Endpoint, Splice, WireColor } from '../schema';

export const T = (device: string, terminal: string): Endpoint => ({ kind: 'terminal', device, terminal });
export const C = (cable: string, color: WireColor, box: string): Endpoint => ({ kind: 'conductor', cable, color, box });
export const S = (splice: string): Endpoint => ({ kind: 'splice', splice });

export type BreakerAmps = 15 | 20;

/** Fixed gauge mapping: 15 A -> 14 AWG, 20 A -> 12 AWG. `poles` is the conductor count: 2 or 3. */
export function cableTypeFor(amps: BreakerAmps, poles: 2 | 3): CableType {
  return `${amps === 15 ? 14 : 12}/${poles}` as CableType;
}

/** Same construction as the verified fixtures, so default templates reproduce them connection for connection. */
export class Builder {
  boxes: Box[] = [];
  devices: Device[] = [];
  cables: Cable[] = [];
  splices: Splice[] = [];
  connections: Connection[] = [];
  constructor(private id: string, private title: string) {}
  box(id: string, label: string, kind: Box['kind'] = 'box') {
    this.boxes.push({ id, label, kind });
  }
  device(id: string, box: string, type: DeviceType, label: string, amps?: number) {
    this.devices.push(amps === undefined ? { id, box, type, label } : { id, box, type, label, amps });
  }
  cable(id: string, type: CableType, from: string, to: string, name: string) {
    this.cables.push({ id, name, type, from, to });
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
    this.device('breaker', 'panel', 'breaker', `${amps}A breaker`, amps);
    this.device('nbar', 'panel', 'neutral_bar', 'Neutral bar');
    this.device('gbar', 'panel', 'ground_bar', 'Ground bar');
    this.wire(C(feed, 'black', 'panel'), T('breaker', 'out'), 'black');
    this.wire(C(feed, 'white', 'panel'), T('nbar', 'neutral_bar'), 'white');
    this.wire(C(feed, 'bare', 'panel'), T('gbar', 'ground_bar'), 'bare');
  }
  /** Light box fed by cable `load` (black->hot, white->neutral, bare->ground). */
  lightBox(box: string, boxLabel: string, load: string, light: string, lightLabel: string) {
    this.box(box, boxLabel);
    this.device(light, box, 'light', lightLabel);
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
