# Daggerheart — Campaign Toolkit

## P2.2 — squelette minimal

Ce dossier est un **nouveau module Foundry v14**.

Objectifs de cette étape :

- le module est reconnu et activable ;
- il exige le système `daggerheart` ;
- il expose un premier compendium de macros ;
- il fournit un smoke test minimal ;
- il n'altère aucun document du système ;
- il ne dépend d'aucun module tiers.

## Installation locale de test

Copier le dossier :

```text
daggerheart-campaign-toolkit
```

dans :

```text
FoundryVTT/Data/modules/
```

Puis redémarrer Foundry et activer :

```text
Daggerheart — Campaign Toolkit
```

## Test

Après activation, ouvrir la console et lancer :

```js
await game.modules.get("daggerheart-campaign-toolkit").api.smokeTest();
```

Résultat attendu :

```text
systemOk: true
packAvailable: true
```

Le compendium **Campaign Toolkit — Macros** doit également apparaître.

Au premier `ready` GM, le module tente d'y ajouter automatiquement :

```text
Campaign Toolkit — Smoke Test
```

Cette macro relance le même test.

## Important

Cette étape ne fusionne pas encore :

- Daggerheart - Homebrew ;
- Blood Hunter v1.5.

La migration de leurs contenus commence seulement après validation de ce squelette.
