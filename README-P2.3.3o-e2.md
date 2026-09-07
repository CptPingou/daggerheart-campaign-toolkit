# P2.3.3o-e2 — Mapping natif par spécimens Foundryborne

## Objet

Ce patch ne réimplémente aucune mécanique d'équipement.

Il construit à l'exécution un index des features d'équipement réellement présentes dans les compendiums natifs Foundryborne :

- `daggerheart.weapons`
- `daggerheart.armor`

Pour chaque feature native, le Toolkit ne considère un comportement comme automatisé que s'il existe un **spécimen SRD réel** avec `effectIds` et/ou `actionIds`.

Le comportement lié est cloné tel quel dans l'item importé, avec de nouveaux IDs embarqués.

## Effet recherché

Cela permet notamment de récupérer automatiquement la forme native exacte de `Paired`, sans hardcoder sa formule dans le Toolkit.

Le même mécanisme couvre les autres features statiques déjà implémentées par Foundryborne, sans deviner leurs clés ActiveEffect.

Une feature configurée mais sans spécimen comportemental reste importée comme avant et conserve :

`system.weaponFeatures:automation`

ou

`system.armorFeatures:automation`

dans les gaps.

## Sécurité

- aucun ActiveEffect inventé ;
- aucun script par équipement ;
- aucun remplacement d'une feature utilisateur ;
- les IDs des effets/actions clonés sont régénérés ;
- l'origine du compendium source n'est pas conservée comme parent de l'effet ;
- le spécimen natif utilisé est tracé dans :
  `flags.daggerheart-campaign-toolkit.nativeEquipmentFeature`.

## Fichiers modifiés

- `daggerheart-campaign-toolkit/scripts/pilot-import.mjs`
- `daggerheart-campaign-toolkit/scripts/full-import.mjs`

## Test

1. Remplacer ces deux fichiers dans le module.
2. F5 Foundry.
3. Lancer `importFullMapped()`.
4. Lancer `semanticAudit()`.

La console doit afficher une ligne :

`daggerheart-campaign-toolkit | P2.3.3o-e2 native equipment specimens`

avec le nombre de features natives comportementales trouvées pour `weapon` et `armor`.

### Attendus

- import : 1012/1012, 0 failure ;
- packs : inchangés en cardinalité ;
- provenance/template/stat issues : 0 ;
- `mappingGaps` doit être **inférieur à 334** si les compendiums natifs exposent bien les effets attendus ;
- une Shortsword importée avec `Paired` doit avoir un `weaponFeatures[0].effectIds` non vide ;
- son effet embarqué doit conserver la sémantique native Foundryborne.

Ne pas fixer un nombre exact de gaps avant le test runtime : la couverture dépend volontairement des spécimens réellement disponibles dans la version installée de Foundryborne.
