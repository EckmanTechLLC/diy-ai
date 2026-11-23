import { C, S, T, Builder, cableTypeFor } from './builder';
import { defineTemplate } from './spec';

export const gfciDownstreamReceptacle = defineTemplate({
  id: 'gfci_downstream_receptacle',
  title: 'GFCI receptacle protecting one downstream receptacle',
  description:
    'One breaker feeds a cable to a GFCI receptacle box (cable on the LINE terminals). A second cable from the GFCI LOAD terminals runs to a box with one standard receptacle, which is thereby GFCI-protected. Grounds are spliced at the GFCI box.',
  appliesWhen: 'A GFCI receptacle with exactly one standard receptacle downstream of it on the same circuit.',
  notFor:
    'More than one downstream receptacle, a GFCI breaker instead of a receptacle, switched receptacles, multi-wire circuits, or a GFCI at the end of the run with nothing downstream.',
  params: {
    breakerAmps: { kind: 'amps', default: 20, description: 'Breaker size in amps: 15 (14 AWG cable) or 20 (12 AWG cable).' },
    gfciBoxLabel: { kind: 'label', default: 'GFCI box', description: 'Label of the GFCI box.' },
    gfciLabel: { kind: 'label', default: 'GFCI', description: 'Label of the GFCI receptacle.' },
    receptacleBoxLabel: { kind: 'label', default: 'Receptacle box', description: 'Label of the downstream receptacle box.' },
    receptacleLabel: { kind: 'label', default: 'Receptacle', description: 'Label of the downstream receptacle.' },
  },
  build(p) {
    const b = new Builder('gfci_downstream_receptacle', 'GFCI protecting a downstream receptacle');
    const cable = cableTypeFor(p.breakerAmps, 2);
    b.panel(p.breakerAmps, 'feed');
    b.box('gfcibox', p.gfciBoxLabel);
    b.box('rbox', p.receptacleBoxLabel);
    b.device('gfci', 'gfcibox', 'gfci', p.gfciLabel);
    b.device('rec', 'rbox', 'duplex', p.receptacleLabel);
    b.cable('feed', cable, 'panel', 'gfcibox', 'feed');
    b.cable('ds', cable, 'gfcibox', 'rbox', 'downstream');
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
  },
});
