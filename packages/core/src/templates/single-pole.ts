import { C, S, T, Builder, cableTypeFor } from './builder';
import { defineTemplate } from './spec';

export const singlePoleSwitch = defineTemplate({
  id: 'single_pole_switch',
  title: 'Single-pole switch, power at the switch',
  description:
    'One breaker feeds a cable to a switch box. The switch interrupts the hot conductor of a second cable that runs to a light box with one light. Neutrals and grounds are spliced through the switch box; the switch is grounded.',
  appliesWhen: 'One switch controls one light and the power cable arrives at the switch box first (the light is the last box).',
  notFor:
    'Power arriving at the light box first (switch loop), more than one switch per light (use 3-way), several lights on one switch, or lights that also feed other loads.',
  params: {
    breakerAmps: { kind: 'amps', default: 15, description: 'Breaker size in amps: 15 (14 AWG cable) or 20 (12 AWG cable).' },
    switchBoxLabel: { kind: 'label', default: 'Switch box', description: 'Label of the switch box.' },
    switchLabel: { kind: 'label', default: 'Switch', description: 'Label of the switch.' },
    lightBoxLabel: { kind: 'label', default: 'Light box', description: 'Label of the light box.' },
    lightLabel: { kind: 'label', default: 'Light', description: 'Label of the light.' },
  },
  build(p) {
    const b = new Builder('single_pole_switch', 'Single-pole switch, power at switch');
    const cable = cableTypeFor(p.breakerAmps, 2);
    b.panel(p.breakerAmps, 'feed');
    b.box('swbox', p.switchBoxLabel);
    b.device('sw', 'swbox', 'switch_sp', p.switchLabel);
    b.cable('feed', cable, 'panel', 'swbox', 'feed');
    b.cable('load', cable, 'swbox', 'lightbox', 'load');
    b.splice('wn', 'swbox');
    b.splice('gn', 'swbox');
    b.wire(C('feed', 'black', 'swbox'), T('sw', 't1'), 'black');
    b.wire(C('load', 'black', 'swbox'), T('sw', 't2'), 'black');
    b.wire(C('feed', 'white', 'swbox'), S('wn'), 'white');
    b.wire(C('load', 'white', 'swbox'), S('wn'), 'white');
    b.wire(C('feed', 'bare', 'swbox'), S('gn'), 'bare');
    b.wire(C('load', 'bare', 'swbox'), S('gn'), 'bare');
    b.wire(S('gn'), T('sw', 'ground'), 'green');
    b.lightBox('lightbox', p.lightBoxLabel, 'load', 'fix', p.lightLabel);
    return b.build();
  },
});
