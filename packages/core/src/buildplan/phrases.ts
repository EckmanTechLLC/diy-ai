// The one table that turns a device type and a catalogue terminal name into words a person can follow.
// Internal terminal names ("t1", "line_hot", ...) never appear in step text.
import type { DeviceType } from '../catalogue';

/** Phrase for a terminal; gets the device's label for devices whose phrase names the device. */
export type TerminalPhrase = (deviceLabel: string) => string;

const screw = (text: string): TerminalPhrase => (label) => `${text} of ${label}`;

export const TERMINAL_PHRASES: Record<DeviceType, Record<string, TerminalPhrase>> = {
  breaker: { out: (label) => `the output terminal of the ${label}` },
  neutral_bar: { neutral_bar: (label) => `the ${label}` },
  ground_bar: { ground_bar: (label) => `the ${label}` },
  switch_sp: {
    t1: screw('one of the two brass screws'),
    t2: screw('the other brass screw'),
    ground: screw('the green ground screw'),
  },
  switch_3way: {
    common: screw('the dark-coloured common screw'),
    traveler_a: screw('one of the two brass traveler screws'),
    traveler_b: screw('the other brass traveler screw'),
    ground: screw('the green ground screw'),
  },
  duplex: {
    brass: screw('a brass screw (hot side)'),
    silver: screw('a silver screw (neutral side)'),
    ground: screw('the green ground screw'),
  },
  gfci: {
    line_hot: screw('the brass LINE screw'),
    line_neutral: screw('the silver LINE screw'),
    load_hot: screw('the brass LOAD screw'),
    load_neutral: screw('the silver LOAD screw'),
    ground: screw('the green ground screw'),
  },
  light: {
    hot: () => "the fixture's black (hot) lead or terminal",
    neutral: () => "the fixture's white (neutral) lead or terminal",
    ground: () => "the fixture's ground lead or green screw",
  },
  fan: {
    hot: () => "the fan's black (hot) lead or terminal",
    neutral: () => "the fan's white (neutral) lead or terminal",
    ground: () => "the fan's ground lead or green screw",
  },
};

export function terminalPhrase(type: DeviceType, terminal: string, deviceLabel: string): string {
  const p = TERMINAL_PHRASES[type][terminal];
  if (!p) throw new Error(`no phrase for terminal "${terminal}" of device type "${type}"`);
  return p(deviceLabel);
}
