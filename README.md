# P2.6.4a1 — prototype token identity fix

Corrects P2.6.4a.

The previous patch inserted the prototype-token synchronization after the first
`data.name = nameOf(...)` occurrence, which belongs to Item construction.
This patch moves the synchronization into `buildActor()` immediately after the
native Actor template is cloned and renamed.

Expected Tetsucabra dry-run:
- actorName: Tetsucabra
- prototypeTokenName: Tetsucabra

The Hunting Notes implementation from P2.6.4a is preserved unchanged.
