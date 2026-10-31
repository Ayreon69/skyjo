# Skyjo

**Retourne, échange, et finis avec le moins de points.**

Jeu de cartes multijoueur en ligne, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Skyjo*, le jeu d'Alexander Bernhardt édité par Magilano (création de fans, non officielle, avec ses propres visuels).

## Règles en bref

- De 2 à 8 joueurs. 150 cartes de −2 à 12 : cinq −2, quinze 0, et dix de chacune des autres valeurs.
- Quand la pioche est vide, on la reconstitue avec la défausse mélangée, sauf sa carte du dessus.
- Chacun reçoit 12 cartes face cachée, en 3 rangées de 4, et en retourne deux. À la première manche, celui qui montre le plus gros total commence ; ensuite, c'est celui qui a fini la manche précédente.
- À son tour, au choix :
  - **prendre la carte de la défausse** et l'échanger avec une carte de sa grille, visible ou cachée ;
  - **piocher une carte**, puis l'échanger avec une carte de sa grille, ou bien la défausser et retourner une de ses cartes cachées.
- La carte remplacée part sur la défausse, face visible.
- **Trois cartes identiques et visibles dans une colonne** : la colonne quitte la grille et part sur la défausse.
- Dès qu'un joueur a retourné toutes ses cartes, chacun des autres joue une dernière fois. Puis tout se retourne et on compte.
- Celui qui a fini la manche doit avoir **strictement le plus petit score**, sinon ses points sont **doublés** (seulement s'ils sont positifs).
- La partie s'arrête à la fin de la manche où quelqu'un atteint la limite. Le plus petit total gagne.

Les règles suivent le livret Magilano : matériel, mise en place, premier joueur, deux façons de jouer son tour, colonne, dernier tour, doublement et fin de partie.

Sont des choix de ce jeu :

- **Une colonne de trois identiques qui apparaît au retournement final part aussi**, avant le décompte.
- **Limite à 100 points, ou 50 en partie express.** Le livret prévoit 100.
- **Aucun total n'est affiché pendant la manche**, ni pour soi ni pour les autres : compter fait partie du jeu. La feuille de marque des manches passées reste consultable, et le nombre de cartes dans la pioche est visible, comme sur une vraie table.
- **Ce qui vient de se passer s'affiche quelques secondes, puis disparaît.** Aucun historique n'est envoyé au client.
- **Un joueur absent plus de 20 secondes est remplacé par le pilote automatique** jusqu'à son retour. Le temps par tour est réglable par l'hôte (sans limite, 30 ou 60 secondes) ; le temps écoulé, le pilote joue aussi.
- **Entre deux manches, la table attend que chacun soit prêt**, avec un départ automatique au bout d'une minute ; l'hôte peut lancer sans attendre.

## Les bots

Ils ne voient que ce qu'un joueur voit : les cartes visibles de chacun et le dessus de la défausse. Ils estiment la valeur d'une carte cachée par la moyenne des cartes pas encore apparues, côté serveur.

- ils prennent la défausse si elle améliore nettement leur grille, et visent les colonnes de cartes identiques ;
- sinon ils piochent, puis gardent la carte ou la défaussent pour retourner une carte cachée ;
- ils ne finissent la manche que s'ils sont confortablement en tête, en tenant compte des cartes encore cachées des autres.

Entre bots, une manche coûte en moyenne 16 points à 2 joueurs et 25 à 8, et le finisseur est doublé dans 9 % des manches à 2 joueurs, 26 % à 8 (`npx tsx test/sim.ts 300` pour mesurer).

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- Partie contre 1 à 7 bots en un clic
- Un geste par décision : toucher la pioche ou la défausse, puis une carte de sa grille ; les cartes jouables s'illuminent
- Les cartes volent de la pioche à la grille et de la grille à la défausse, se retournent, et les colonnes s'envolent
- Grilles des adversaires en miniature, qui défilent à 8 joueurs ; celui qui joue reste en vue
- Fin de manche en volet : les grilles se retournent, le décompte monte, le doublement est annoncé ; un tap replie le volet pour regarder les grilles
- Feuille de marque, podium et revanche
- Réactions, règles consultables en jeu
- Reprise automatique après une coupure, pilote automatique, spectateurs
- Sons synthétisés et vibrations, animations réduites si le système le demande

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3160
npm run dev:client   # interface sur http://localhost:5195
npm test             # paquet, manches, colonnes, doublement, bots et table
npm run build && npm run e2e   # parties complètes avec de vrais clients connectés
npx tsx test/sim.ts 300        # force des bots : 300 parties par nombre de joueurs
```

`SK_FAST=1` accélère les bots et les chronos (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur, constantes du paquet et de la grille
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots (`bots.ts`), table et minuteries (`room.ts`). Le serveur fait autorité : une carte cachée ne quitte jamais le serveur, pas même vers son propriétaire, et l'ordre de la pioche n'est jamais envoyé
- `client/` : React + Vite + Framer Motion. Les cartes sont dans `components/Card.tsx`, les grilles dans `components/Grid.tsx`, la fin de manche dans `components/RoundEnd.tsx`, la table et ses vols de cartes dans `screens/Table.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
