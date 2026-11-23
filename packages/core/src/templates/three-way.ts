import { C, S, T, Builder, cableTypeFor } from './builder';
import { defineTemplate } from './spec';

export const threeWaySwitches = defineTemplate({
  id: 'three_way_switches',
  title: '3-way switches, power at the first switch, light after the second',
  description:
    'One breaker feeds a cable to the first 3-way switch box. A 3-wire cable (black, red, white, bare) carries the two travelers to the second 3-way switch box. A 2-wire cable runs from the second switch to a light box with one light. The first switch common takes the feed hot; the second switch common goes to the light. Neutrals and grounds are spliced through; both switches are grounded.',
  appliesWhen: 'One light controlled from two places, with the power cable arriving at one of the two switch boxes and the light beyond the other.',
  notFor:
    'Power arriving at the light box first, more than two switch locations (4-way), several lights, or a switch box that has a neutral-less switch loop.',
  params: {
    breakerAmps: { kind: 'amps', default: 15, description: 'Breaker size in amps: 15 (14 AWG cables) or 20 (12 AWG cables).' },
    switch1BoxLabel: { kind: 'label', default: 'Box 1 (SW1)', description: 'Label of the first switch box (power arrives here).' },
    switch2BoxLabel: { kind: 'label', default: 'Box 2 (SW2)', description: 'Label of the second switch box.' },
    switch1Label: { kind: 'label', default: 'SW1', description: 'Label of the first switch.' },
    switch2Label: { kind: 'label', default: 'SW2', description: 'Label of the second switch.' },
    lightBoxLabel: { kind: 'label', default: 'Light box', description: 'Label of the light box.' },
    lightLabel: { kind: 'label', default: 'Light', description: 'Label of the light.' },
  },
  build(p) {
    const b = new Builder('three_way_switches', '3-way, power at first switch, light after second');
    const two = cableTypeFor(p.breakerAmps, 2);
    const three = cableTypeFor(p.breakerAmps, 3);
    b.panel(p.breakerAmps, 'feed');
    b.box('box1', p.switch1BoxLabel);
    b.box('box2', p.switch2BoxLabel);
    b.device('sw1', 'box1', 'switch_3way', p.switch1Label);
    b.device('sw2', 'box2', 'switch_3way', p.switch2Label);
    b.cable('feed', two, 'panel', 'box1', 'feed');
    b.cable('trav', three, 'box1', 'box2', 'travelers');
    b.cable('load', two, 'box2', 'lightbox', 'load');
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
    b.lightBox('lightbox', p.lightBoxLabel, 'load', 'fix', p.lightLabel);
    return b.build();
  },
});
