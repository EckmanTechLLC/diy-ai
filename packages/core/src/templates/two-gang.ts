import { C, S, T, Builder, cableTypeFor } from './builder';
import { defineTemplate } from './spec';

export const twoGangTwoSwitches = defineTemplate({
  id: 'two_gang_two_switches',
  title: '2-gang box, two single-pole switches, each controlling its own light',
  description:
    'One breaker feeds a cable to a 2-gang switch box. The feed hot is spliced to the input of both single-pole switches. Each switch output goes to its own cable to its own light box with one light. Neutrals are spliced together and grounds are spliced together in the 2-gang box; both switches are grounded.',
  appliesWhen: 'Two switches in one 2-gang box, each controlling a separate light, with the power cable arriving at the switch box.',
  notFor:
    'Two switches controlling one light, 3-way switches, a switch with a receptacle, a dimmer or fan combination, or power arriving at a light box first.',
  params: {
    breakerAmps: { kind: 'amps', default: 15, description: 'Breaker size in amps: 15 (14 AWG cables) or 20 (12 AWG cables).' },
    gangBoxLabel: { kind: 'label', default: '2-gang box', description: 'Label of the 2-gang switch box.' },
    switchALabel: { kind: 'label', default: 'SW-A', description: 'Label of the first switch.' },
    switchBLabel: { kind: 'label', default: 'SW-B', description: 'Label of the second switch.' },
    lightABoxLabel: { kind: 'label', default: 'Light A box', description: 'Label of the box for the light controlled by the first switch.' },
    lightBBoxLabel: { kind: 'label', default: 'Light B box', description: 'Label of the box for the light controlled by the second switch.' },
    lightALabel: { kind: 'label', default: 'Light', description: 'Label of the light controlled by the first switch.' },
    lightBLabel: { kind: 'label', default: 'Light', description: 'Label of the light controlled by the second switch.' },
  },
  build(p) {
    const b = new Builder('two_gang_two_switches', '2-gang box, two switches, two lights');
    const cable = cableTypeFor(p.breakerAmps, 2);
    b.panel(p.breakerAmps, 'feed');
    b.box('gang', p.gangBoxLabel);
    b.device('swa', 'gang', 'switch_sp', p.switchALabel);
    b.device('swb', 'gang', 'switch_sp', p.switchBLabel);
    b.cable('feed', cable, 'panel', 'gang', 'feed');
    b.cable('loada', cable, 'gang', 'lightabox', 'load A');
    b.cable('loadb', cable, 'gang', 'lightbbox', 'load B');
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
    b.lightBox('lightabox', p.lightABoxLabel, 'loada', 'fixa', p.lightALabel);
    b.lightBox('lightbbox', p.lightBBoxLabel, 'loadb', 'fixb', p.lightBLabel);
    return b.build();
  },
});
