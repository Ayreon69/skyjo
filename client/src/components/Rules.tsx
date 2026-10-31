// Les règles, lisibles en deux minutes et consultables à tout moment.
import { Columns3, Flag, Layers, RefreshCw, Repeat2, Trophy } from 'lucide-react';
import { useStore } from '../store';
import { SkyCard } from './Card';
import { Modal } from './Ui';

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <div className="rule-fan" aria-hidden>
            <SkyCard value={-2} size="sm" />
            <SkyCard value={0} size="sm" />
            <SkyCard size="sm" />
            <SkyCard value={12} size="sm" />
          </div>
          <p>
            Chacun a devant lui <b>12 cartes face cachée</b>, en 3 rangées de 4. Tu ne connais pas ton jeu : tu le découvres en jouant. Le but : <b>finir avec le moins de points possible</b>, manche après manche.
          </p>
        </section>

        <section>
          <h3>Les cartes</h3>
          <div className="rule-tones" aria-label="Les couleurs des cartes">
            {[-2, -1, 0, 4, 8, 12].map((v) => (
              <SkyCard key={v} value={v} size="sm" />
            ))}
          </div>
          <p>150 cartes de −2 à 12. Les couleurs aident à lire une grille d'un coup d'œil : du bleu nuit pour les négatives au rouge pour les plus fortes.</p>
        </section>

        <section>
          <h3>Début de manche</h3>
          <p>Chacun retourne <b>deux cartes</b> de son choix. À la première manche, celui qui montre le plus gros total commence ; ensuite, c'est celui qui a fini la manche précédente.</p>
        </section>

        <section>
          <h3>À ton tour, au choix</h3>
          <ul className="rule-actions">
            <li>
              <Layers size={20} aria-hidden />
              <div>
                <b>Prendre la carte de la défausse</b> et l'échanger aussitôt avec une carte de ta grille, visible ou cachée.
              </div>
            </li>
            <li>
              <Repeat2 size={20} aria-hidden />
              <div>
                <b>Piocher une carte</b>, puis soit l'échanger avec une carte de ta grille, soit <b>la défausser et retourner</b> une de tes cartes cachées.
              </div>
            </li>
          </ul>
          <p>La carte remplacée part toujours sur la défausse, face visible.</p>
        </section>

        <section className="rule-split">
          <div className="rule-case">
            <h3>
              <Columns3 size={18} aria-hidden /> La colonne
            </h3>
            <p>Trois cartes identiques et visibles dans une même colonne : elle quitte ta grille et part sur la défausse. Autant de points en moins !</p>
          </div>
          <div className="rule-case">
            <h3>
              <Flag size={18} aria-hidden /> Fin de manche
            </h3>
            <p>Dès qu'un joueur a retourné toutes ses cartes, chacun des autres joue <b>une dernière fois</b>. Puis tout se retourne, et on compte.</p>
          </div>
        </section>

        <section className="rule-warn">
          <h3>
            <RefreshCw size={18} aria-hidden /> Attention au doublé
          </h3>
          <p>
            Celui qui a fini la manche doit avoir <b>strictement le plus petit score</b>. Sinon, ses points sont <b>doublés</b> (seulement s'ils sont positifs). Finir trop tôt peut coûter cher !
          </p>
        </section>

        <section>
          <h3>
            <Trophy size={18} aria-hidden /> Fin de partie
          </h3>
          <p>La partie s'arrête à la fin de la manche où quelqu'un atteint la limite choisie (100 points, ou 50 en partie express). Le plus petit total gagne.</p>
        </section>

        <section className="rule-memory">
          <h3>Dans cette version</h3>
          <ul>
            <li>Touche la pioche ou la défausse, puis une carte de ta grille. Tu peux annuler ton choix tant que tu n'as pas pioché.</li>
            <li>Une colonne de trois identiques qui apparaît au retournement final part aussi.</li>
            <li>Aucun total n'est affiché pendant la manche : à toi de compter. La feuille de marque des manches passées reste consultable.</li>
            <li>Un joueur absent plus de 20 secondes est remplacé par le pilote automatique jusqu'à son retour.</li>
          </ul>
        </section>

        <p className="rule-foot">
          D'après <i>Skyjo</i>, le jeu d'Alexander Bernhardt (Magilano). Création de fans, non officielle, avec ses propres visuels.
        </p>
      </div>
    </Modal>
  );
}
