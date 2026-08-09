/*!
 * tyres-card        — le parc de pneumatiques d'un vehicule, et ses manoeuvres.
 * floor-tyres-badge — le meme etat, reduit a une pastille de plan.
 *
 * Les deux elements vivent dans ce fichier parce qu'ils lisent la meme
 * entite — le capteur « Pneumatiques » du composant tyre_tracker — et que la
 * pastille n'est que la carte vue de loin.
 *
 * Ils remplacent le template streamline `floor_pneus_planxy_v2`, un
 * mushroom-chips-card deshabille par une dizaine de regles `!important`, dont
 * les six expressions Jinja testaient `binary_sensor.snowtire` — une entite
 * jamais creee, si bien que la condition etait toujours fausse et la pastille
 * affichait « Ete » en permanence. Le popup, lui, empilait deux
 * mushroom-title-card, deux grid et quatre numberbox-card pour editer quatre
 * des six compteurs existants.
 *
 * Toute la matiere vient d'un seul attribut : `sets` porte une fiche complete
 * par jeu, `fitted` dit ce qui est monte a l'avant et a l'arriere. Une lecture,
 * aucun calcul cote carte — le kilometrage vivant est deja resolu par le
 * coordinateur, qui seul connait l'odometre de pose.
 *
 * Ce qui s'ecrit passe par les services du composant quand c'est une manoeuvre
 * — monter, deposer, permuter — et par le flux d'options quand c'est une fiche.
 * Ce flux-la, la carte le conduit en REST sans jamais montrer ses ecrans : elle
 * lit le schema d'un pas pour savoir quoi demander, dessine ses propres champs,
 * et reposte sous les memes noms. Les regles restent donc ecrites une seule
 * fois, en Python, et servent aussi bien Parametres — ou l'integration doit
 * rester utilisable sans la carte — que la carte, ou elles se presentent
 * autrement. `config_flow.py` decrit, `tyres-card.js` met en forme.
 *
 * Le fichier est livre par le composant lui-meme (custom_components/
 * tyre_tracker/frontend/), qui l'expose sur /tyre_tracker_frontend/tyres-card.js et
 * l'inscrit dans les ressources Lovelace : installer l'integration suffit,
 * rien a copier dans www/. Il est donc autonome — les cinq utilitaires que
 * les cartes du dossier www/floorplan/ se partagent dans `common.js` sont
 * recopies ci-dessous plutot qu'importes, car une carte distribuee par HACS
 * ne peut pas dependre d'un fichier de la configuration de l'utilisateur.
 *
 * Ecrit en JS natif (pas de build, pas de dependance).
 */

/* ---------- utilitaires (repris de www/floorplan/common.js) ---------- */

/** La banniere de console. */
function banner(name, version) {
  console.info(
    `%c 🙂 ${name} %c v${version} %c`,
    "background:#2196F3;color:white;padding:2px 8px;border-radius:3px 0 0 3px;font-weight:bold",
    "background:#4CAF50;color:white;padding:2px 8px;border-radius:0 3px 3px 0",
    "background:none"
  );
}

/**
 * Execute l'action d'un element, quelle qu'elle soit.
 *
 * Toutes les formes que Lovelace connait sont ici, y compris celles qu'aucune
 * des deux cartes n'utilise encore : c'est le seul moyen qu'une action
 * configuree fasse ce qu'elle annonce plutot que de retomber en silence sur
 * `more-info`.
 *
 * `fire-dom-event` part en `ll-custom`, le canal qu'ecoute browser_mod : la
 * carte n'a ainsi pas a connaitre browser_mod, et la configuration du popup
 * reste dans le YAML. `toggle` sur un bouton devient un `press` :
 * `homeassistant.toggle` ne sait rien faire d'un `button`.
 */
function performAction(el, hass, action, entityId) {
  const emit = (type, detail) =>
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

  const moreInfo = () => {
    const id = action?.entity ?? entityId;
    if (id) emit("hass-more-info", { entityId: id });
  };

  switch (action?.action) {
    case "none":
      return;

    case "more-info":
      moreInfo();
      return;

    case "toggle": {
      const id = action?.entity ?? entityId;
      if (!id || !hass) return;
      const domain = String(id).split(".")[0];
      if (domain === "button" || domain === "input_button") hass.callService(domain, "press", { entity_id: id });
      else hass.callService("homeassistant", "toggle", { entity_id: id });
      return;
    }

    case "navigate":
      if (!action.navigation_path) return;
      history.pushState(null, "", action.navigation_path);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return;

    case "url": {
      // Une URL de configuration reste une URL : `javascript:` s'executerait
      // dans la page. On n'ouvre que ce qui navigue.
      const url = String(action.url_path ?? "");
      if (!/^(https?:\/\/|\/)/.test(url)) return;
      window.open(url, "_blank", "noreferrer");
      return;
    }

    case "fire-dom-event":
      emit("ll-custom", action);
      return;

    case "perform-action":
    case "call-service": {
      // La cible est un quatrieme argument, pas des donnees de service : un
      // entity_id passe en donnees marche encore par heritage, un area_id ou
      // un device_id serait ignore sans un mot.
      const [domain, service] = String(action.perform_action ?? action.service ?? "").split(".");
      if (!domain || !service || !hass) return;
      hass.callService(domain, service, { ...(action.data ?? {}) }, action.target);
      return;
    }

    default:
      moreInfo();
  }
}

/**
 * La feuille d'une pastille de plan.
 *
 * Les pastilles de plan ne sont pas des cartes : elles n'ont ni ha-card ni
 * fond de theme, et doivent rester a la taille de leur texte — c'est la cle
 * `style` du picture-elements qui les place, et son `translate: -50% -100%`
 * ne tombe juste que si la boite ne triche pas sur sa taille.
 *
 * `dashed` reste au pointille des volets : c'est leur signature sur le plan,
 * et le partager la banaliserait. Les autres pastilles portent un trait plein.
 */
function planBadgeStyle({ dashed = false } = {}) {
  return `
  :host {
    display: inline-block;
    --badge-color: #fff;
    /* Les elements \`icon\` des templates streamline voisins posent
       \`rgba(102, 102, 102, 0.7)\`. La pastille va plus sombre : eux n'abritent
       qu'une icone, elle porte du texte, et un gris moyen sous du blanc de
       13 px ne donne pas de quoi le detacher du mur clair.

       Pour ajuster : le premier triplet est la teinte (0 = noir), le dernier
       nombre l'opacite. Monter l'opacite masque le plan, baisser la teinte
       assombrit sans le cacher. */
    --badge-background: rgba(51, 51, 51, 0.75);
  }

  .badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: 1px ${dashed ? "dashed" : "solid"} var(--badge-color);
    /* Le fond est systematique, et non conditionne a la clarte du dessous : la
       pastille flotte sur un plan ou toit clair et mur sombre se touchent, et
       une meme pastille peut chevaucher les deux.

       \`padding-box\` l'arrete au bord interieur du trait : par defaut un fond
       s'etend sous la bordure et ressort dans les creux d'un pointille. */
    background: var(--badge-background);
    background-clip: padding-box;
    /* Sans rayon, le fond fait une plaque rectangulaire dure au milieu d'un
       dessin en projection. Quatre pixels suffisent a l'adoucir. */
    border-radius: 4px;
    white-space: nowrap;
    color: var(--badge-color);
    font-family: var(--paper-font-body1_-_font-family, inherit);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    /* Le fond etant translucide, le contraste reste faible sur un toit tres
       clair : l'ombre portee garde son role, en appoint. */
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
  }
  .badge:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }

  /* Zone sensible debordante. Le libelle fait une vingtaine de pixels de haut,
     bien en dessous des 24 px minimum du WCAG 2.2, et on la vise au doigt sur
     un plan ou rien n'est agrandi. Le debordement passe par un pseudo-element
     plutot que par du remplissage : la pastille garde sa taille, donc son
     placement isometrique reste juste. */
  .badge::after {
    content: "";
    position: absolute;
    inset: -7px -6px;
  }

  /* ha-icon ne porte aucune regle de taille sur son hote : tout vit sur le
     ha-svg-icon qu'il contient, lequel est de niveau ligne. Sans \`flex\`, il
     cree une boite de ligne dimensionnee par le line-height herite et le
     glyphe deborde vers le haut. */
  ha-icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    --mdc-icon-size: 15px;
    width: 15px;
    height: 15px;
  }
  ha-icon[hidden] { display: none; }

  /* Le libelle rend la descente que « Fermé » n'utilise pas, faute de quoi son
     encre parait plus haute que le centre des icones. */
  .label {
    display: block;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }
`;
}

/**
 * Un editeur `ha-form` pour une carte, a partir de son schema.
 *
 * La configuration renvoyee part de celle recue : le formulaire ignore `type`
 * et `view_layout`, qui doivent survivre a une modification.
 */
function defineEditor(tag, schema, labels = {}) {
  if (customElements.get(tag)) return tag;

  customElements.define(
    tag,
    class extends HTMLElement {
      #hass = null;
      #config = {};
      #form = null;

      setConfig(config) {
        this.#config = { ...config };
        this.#sync();
      }

      set hass(hass) {
        this.#hass = hass;
        setLanguage(hass);
        this.#sync();
      }

      connectedCallback() {
        if (this.#form) return;
        this.#form = document.createElement("ha-form");
        this.#form.computeLabel = (s) =>
          (typeof labels === "function" ? labels() : labels)[s.name] ?? s.name;
        this.#form.addEventListener("value-changed", (event) => {
          event.stopPropagation();
          this.dispatchEvent(
            new CustomEvent("config-changed", {
              detail: { config: { ...this.#config, ...event.detail.value } },
              bubbles: true,
              composed: true,
            })
          );
        });
        this.appendChild(this.#form);
        this.#sync();
      }

      #sync() {
        if (!this.#form || !this.#hass) return;
        this.#form.hass = this.#hass;
        this.#form.schema = schema;
        this.#form.data = this.#config;
      }
    }
  );
  return tag;
}

/**
 * Home Assistant reaffecte `hass` a chaque changement d'etat de la maison,
 * mais reutilise l'objet d'etat des entites qui n'ont pas bouge : une
 * comparaison de reference par entite ecarte donc en quelques instructions
 * toutes les poussees qui ne nous concernent pas — la quasi-totalite.
 *
 * `seen` est une table tenue par l'appelant, mise a jour au passage.
 */
function watch(hass, ids, seen) {
  let changed = false;
  for (const id of ids) {
    const state = hass?.states?.[id];
    if (state === seen[id]) continue;
    seen[id] = state;
    changed = true;
  }
  return changed;
}

/* ---------- les mots ----------

   Une carte Lovelace ne peut pas lire `strings.json` : les categories que Home
   Assistant sert au navigateur sont fixees, et rien n'y accueille la prose
   d'une carte. Elle porte donc son propre dictionnaire, ce que font toutes les
   cartes distribuees.

   La langue vient de `hass.locale.language`, celle que l'utilisateur a choisie
   pour lui — et non celle du serveur, qui nomme les appareils et compose les
   etats cote Python. Deux personnes regardant le meme tableau de bord le
   lisent donc chacune dans la sienne.

   L'anglais sert de repli, cle par cle : une traduction incomplete laisse
   passer un mot anglais au milieu d'une phrase francaise, ce qui se voit et se
   corrige, la ou une cle brute ne se lit pas du tout. */

const WORDS = {
  en: {
    "editor.entity": "“Tyres” sensor",
    "msg.restored": "“{name}” put back into service.",
    "resync.tracking": "The tracking",
    "resync.sensor": "The sensor",
    "punct.and": "” and “",
    "punct.open": "“",
    "block.count_rotation": "of which {km} since the last rotation",
    "card.stored_at": "Stored at {place}",
    "sheet.mount_at": "Fit at the {position}. ",
    "act.move_to": "Move to the {position}",
    "act.mount_at": "Fit at the {position}",
    "status.filed_on": "filed away on {date}",
    "card.since_rotation": "{km} since the last rotation",
    "card.mounted_since": "Fitted since {date}",
    "card.stale_title": "No reading for {since} — the pressure shown is the one from before",
    "card.alarm_title": "Pressure out of its band — this tyre needs looking at",
    "card.alarm_note": " — pressure out of its band",
    "card.alarm_aside": "check",
    "card.alarm_short": ". Pressure alarm",
    "help.odo_added": "+{km} since the last reading.",
    "help.odo_below": "Below the current odometer ({km}) — the integration would refuse it.",
    "card.entity_missing": "Entity not found: {entity}",
    "msg.separated": "“{name}” separated into two pairs.",
    "msg.deleted": "“{name}” deleted.",
    "resync.explain": "Taking the sensor's reading settles the fitted set at {tracked} km — those kilometres stay its own — then counts again from {reading} km.",
    "resync.forever": " at {tracked} km for good.",
    "card.no_reading_for": " — no reading for {since}",
    "card.advice_short": ". Rotation advised",
    "status.mounted_at": "fitted at the {position}",
    "season.summer": "Summer",
    "season.winter": "Winter",
    "season.all_season": "All-season",
    "season.retired": "History",
    "axle.all": "4 wheels",
    "axle.pair": "2 wheels",
    "position.front": "Front",
    "position.rear": "Rear",
    "corner.front_left": "Front left",
    "corner.front_right": "Front right",
    "corner.rear_left": "Rear left",
    "corner.rear_right": "Rear right",
    "status.retired": "in the history",
    "status.mounted": "fitted",
    "status.removed": "off the car",
    "status.both_axles": "Front + rear",
    "status.filed": "filed away",
    "status.rotate_due": "Rotate",
    "card.badge_config": "floor-tyres-badge: `entity` must be the “Tyres” sensor.",
    "card.config": "tyres-card: `entity` must be the “Tyres” sensor.",
    "card.none_fitted": "No set fitted",
    "card.badge_none": "Tyres: no set fitted",
    "card.no_set": "No set",
    "card.no_reading": "no reading",
    "card.none_fitted_dot": "No set fitted.",
    "card.advice": "The coming days' weather suggests swapping.",
    "card.no_sets": "No set declared yet. Add one to start counting its kilometres.",
    "card.nothing_here": "Nothing fitted at this position",
    "card.age_hint": "A tyre ages standing still, whatever its mileage",
    "card.not_connected": "Home Assistant is not connected.",
    "card.no_entry": "This sensor does not say which vehicle it belongs to yet: restart Home Assistant after updating the integration.",
    "block.record": "Record",
    "block.record_empty": "Nothing beyond the reference.",
    "block.sensors": "Sensors",
    "block.sensors_none": "No sensor attached.",
    "block.count": "Count",
    "act.add_set": "Add a set",
    "act.add_vehicle": "Add another vehicle",
    "act.cancel": "Cancel",
    "act.close": "Close",
    "act.save": "Save",
    "act.edit": "Edit",
    "act.attach": "Attach",
    "act.correct": "Correct",
    "act.delete": "Delete",
    "act.delete_set": "Delete the set",
    "act.mount": "Fit",
    "act.mount_all": "Fit all 4",
    "act.unmount": "Remove",
    "act.rotate": "Rotate",
    "act.restore": "Put back into service",
    "act.retire": "Move to history",
    "act.separate": "Separate",
    "act.add_the_set": "Add the set",
    "act.create_copy": "Create the copy",
    "act.keep_tracking": "Keep the tracking",
    "act.take_sensor": "Take the sensor's reading",
    "act.update_odometer": "Update the odometer…",
    "act.integration_page": "Integration page",
    "act.card_options": "Card options",
    "act.settings": "Settings",
    "sheet.new_set": "New set",
    "sheet.new_set_note": "Mileage is attached to the set, not to its reference: correcting it later loses nothing.",
    "sheet.edit": "Edit the record",
    "sheet.edit_note": "The kilometres covered do not depend on anything written here: they stay.",
    "sheet.duplicate": "Duplicate the record",
    "sheet.duplicate_note": "A new set takes this record, with a counter of its own. Nothing is taken from the original.",
    "sheet.on_the_car": "On the car",
    "sheet.tpms": "Pressure sensors",
    "sheet.tpms_note": "A sensor is screwed to its wheel: it belongs to the set and follows it from one car to the next. Clearing a field detaches it.",
    "sheet.separate": "Separate into two pairs",
    "sheet.separate_note": "Both halves start from the same total — those kilometres were covered on all four tyres. From here each counts for itself. Nothing comes off the car.",
    "sheet.resync": "Two readings disagree",
    "sheet.settings": "Vehicle settings",
    "sheet.odometer": "Vehicle odometer",
    "sheet.odometer_note": "The total read on the dashboard. Every set's mileage follows from it, so it can only go up.",
    "sheet.reading": "Odometer reading",
    "sheet.set_total": "Set's total mileage",
    "sheet.adjust_note": "What you write here becomes its total, and the count starts again from there. Nothing else moves.",
    "sheet.rotate_note": "Each wheel moves to the other end of its side. The mileage does not change: only the reminder starts again, and the sensors follow their wheel.",
    "sheet.unmount_note": "This set's count stops here. The kilometres it covered stay its own.",
    "sheet.mount_all": "Fit all four wheels.",
    "group.vehicle": "The vehicle",
    "group.odometer": "The odometer",
    "group.rotation": "The rotation reminder",
    "group.odometer_src": "Odometer source",
    "help.pair": "a pair",
    "help.pair_note": "A pair fits either the front or the rear, and moves from one to the other.",
    "help.dot": "The four digits on the sidewall: the week, then the year. The whole DOT line can be pasted as it reads.",
    "help.label": "Replaces the reference on screen",
    "help.price": "For the whole set. Divided by what it covers, it says which reference was actually the cheapest.",
    "help.storage": "Garage, left shelf",
    "help.initial_total": "For taking over tracking kept elsewhere. Zero for tyres that have not turned yet.",
    "help.vehicle": "Names the device, and through it every entity — “Alfa GT Odometer”.",
    "help.rotation": "The rotation reminder, on a fitted four-wheel set. Zero says nothing about it.",
    "help.odometer_entity": "Linking the car's odometer saves typing it in at every move. Left empty, a field appears at the bottom of the card.",
    "help.replace": "What happens to the fitted set",
    "help.replaced": "Replaced",
    "help.replaced_note": "it moves to the history",
    "help.kept": "Left in place",
    "help.kept_note": "the copy waits in the garage",
    "help.pair_new": "Becomes a new set, with its sensors.",
    "help.pair_kept": "Stays with this record, and keeps its history.",
    "help.tracked_so_far": "counted so far",
    "help.odo_dashboard": "Enter the total read on the dashboard.",
    "help.odo_nothing": "No kilometre added.",
    "msg.saved_settings": "Settings saved.",
    "msg.vehicle_failed": "The vehicle could not be saved.",
    "msg.set_added": "Set added.",
    "msg.odometer_saved": "Odometer saved.",
    "msg.rotated": "Rotation recorded.",
    "msg.adjusted": "Total corrected.",
    "msg.retired": "Set moved to the history.",
    "msg.unmounted": "Set removed.",
    "msg.mounted": "Set fitted.",
    "msg.record_saved": "Record saved.",
    "msg.sensors_saved": "Sensors saved.",
    "msg.duplicated": "Record duplicated.",
    "resync.no_back": "An odometer does not go backwards: this reading would be refused, and the tracking",
    "resync.stuck": "would stay stuck",
    "delete.head": "The record will be erased, with its sensor and its device. Its",
    "delete.tail": "are kept: adding the set again finds them.",
    "retire.tail": "will be frozen. The set stays readable, filed in the history, and can no longer be fitted.",
    "mount.displaces_all": "” comes off entirely — half a set of four is not a set of four.",
    "mount.displaced_many": "” will come off, and their count closed at that reading.",
    "mount.displaced_one": "” will come off, and its count closed at that reading.",
    "editor.advice": "Rotation advice (snowtire)",
    "editor.pressures": "TPMS pressures under the badge",
    "editor.title": "Card title (default: the vehicle)",
    "editor.card_desc": "A vehicle's tyre fleet: state, fitting, removal, retirement",
    "editor.badge_desc": "Tyre badge for an isometric floor plan",
    "field.optional": "optional",
    "field.odometer": "Odometer",
    "field.total": "Total",
    "act.back": "Back",
    "act.confirm": "Confirm",
    "card.opening": "Opening…",
    "card.sets_label": "Sets",
    "card.tyres": "Tyres",
    "card.tyres_prefix": "Tyres: ",
    "card.pressures_said": ". Pressures: ",
    "card.odometer_reads": "{km}",
    "card.odometer_menu": "Odometer",
    "card.automatic": "automatic",
    "card.sensor_silent": "Sensor silent",
    "card.mute": "silent",
    "card.mute_for": "silent {since}",
    "card.no_sensor": "no sensor",
    "card.set_fallback": "Set",
    "card.unknown_error": "Unknown error.",
    "status.available": "Available",
    "block.one_sensor": "1 sensor",
    "block.n_sensors": "{n} sensors",
    "block.total_of": "{km} in total",
    "sheet.more_fields": "Size, DOT code, price, storage…",
    "punct.colon": ": ",
    "unit.years_one": "{n} year",
    "unit.years_many": "{n} years",
    "unit.days_short": "d",
    "short.front_left": "FL",
    "short.front_right": "FR",
    "short.rear_left": "RL",
    "short.rear_right": "RR",
    "short.left": "LEFT",
    "short.right": "RIGHT",
  },
  fr: {
    "editor.entity": "Capteur « Pneumatiques »",
    "msg.restored": "« {name} » remis en service.",
    "resync.tracking": "Le suivi",
    "resync.sensor": "Le capteur",
    "punct.and": " » et « ",
    "punct.open": "« ",
    "block.count_rotation": "dont {km} depuis la dernière permutation",
    "card.stored_at": "Rangé à {place}",
    "sheet.mount_at": "Monter à l'{position}. ",
    "act.move_to": "Passer à l'{position}",
    "act.mount_at": "Monter à l'{position}",
    "status.filed_on": "classé le {date}",
    "card.since_rotation": "{km} depuis la dernière permutation",
    "card.mounted_since": "Monté depuis le {date}",
    "card.stale_title": "Aucun relevé depuis {since} — la pression affichée est celle d'avant",
    "card.alarm_title": "Pression hors plage — ce pneu est à voir",
    "card.alarm_note": " — pression hors plage",
    "card.alarm_aside": "à vérifier",
    "card.alarm_short": ". Alarme de pression",
    "help.odo_added": "+{km} depuis le dernier relevé.",
    "help.odo_below": "Inférieur au compteur actuel ({km}) — le composant refuserait.",
    "card.entity_missing": "Entité introuvable : {entity}",
    "msg.separated": "« {name} » séparé en deux paires.",
    "msg.deleted": "« {name} » supprimé.",
    "resync.explain": "Reprendre le capteur solde d'abord le train monté à {tracked} km — ces kilomètres restent les siens — puis repart de {reading} km.",
    "resync.forever": " à {tracked} km pour de bon.",
    "card.no_reading_for": " — aucun relevé depuis {since}",
    "card.advice_short": ". Permutation conseillée",
    "status.mounted_at": "monté à l'{position}",
    "season.summer": "Été",
    "season.winter": "Hiver",
    "season.all_season": "4 saisons",
    "season.retired": "Historique",
    "axle.all": "4 roues",
    "axle.pair": "2 roues",
    "position.front": "Avant",
    "position.rear": "Arrière",
    "corner.front_left": "Avant gauche",
    "corner.front_right": "Avant droit",
    "corner.rear_left": "Arrière gauche",
    "corner.rear_right": "Arrière droit",
    "status.retired": "à l'historique",
    "status.mounted": "monté",
    "status.removed": "déposé",
    "status.both_axles": "Avant + arrière",
    "status.filed": "classé",
    "status.rotate_due": "À permuter",
    "card.badge_config": "floor-tyres-badge : `entity` doit etre le capteur « Pneumatiques ».",
    "card.config": "tyres-card : `entity` doit être le capteur « Pneumatiques ».",
    "card.none_fitted": "Aucun jeu monté",
    "card.badge_none": "Pneumatiques : aucun jeu monté",
    "card.no_set": "Aucun jeu",
    "card.no_reading": "aucune mesure",
    "card.none_fitted_dot": "Aucun jeu monté.",
    "card.advice": "La météo des prochains jours conseille de permuter.",
    "card.no_sets": "Aucun train déclaré. Ajoutez-en un pour compter ses kilomètres.",
    "card.nothing_here": "Rien de monté à cette position",
    "card.age_hint": "Un pneu vieillit à l'arrêt, quel que soit son kilométrage",
    "card.not_connected": "Home Assistant n'est pas connecté.",
    "card.no_entry": "Ce capteur ne dit pas encore à quel véhicule il appartient : redémarrez Home Assistant après la mise à jour du composant.",
    "block.record": "Fiche",
    "block.record_empty": "Rien d'autre que la référence.",
    "block.sensors": "Capteurs",
    "block.sensors_none": "Aucun capteur associé.",
    "block.count": "Compte",
    "act.add_set": "Ajouter un train",
    "act.add_vehicle": "Ajouter un autre véhicule",
    "act.cancel": "Annuler",
    "act.close": "Fermer",
    "act.save": "Enregistrer",
    "act.edit": "Modifier",
    "act.attach": "Associer",
    "act.correct": "Corriger",
    "act.delete": "Supprimer",
    "act.delete_set": "Supprimer le train",
    "act.mount": "Monter",
    "act.mount_all": "Monter les 4",
    "act.unmount": "Déposer",
    "act.rotate": "Permuter",
    "act.restore": "Remettre en service",
    "act.retire": "Passer à l'historique",
    "act.separate": "Séparer",
    "act.add_the_set": "Ajouter le train",
    "act.create_copy": "Créer la copie",
    "act.keep_tracking": "Garder le suivi",
    "act.take_sensor": "Reprendre le capteur",
    "act.update_odometer": "Mettre à jour le compteur…",
    "act.integration_page": "Page de l'intégration",
    "act.card_options": "Options de la carte",
    "act.settings": "Réglages",
    "sheet.new_set": "Nouveau train",
    "sheet.new_set_note": "Le kilométrage s'attache au train, pas à sa référence : la corriger plus tard ne perd rien.",
    "sheet.edit": "Modifier la fiche",
    "sheet.edit_note": "Les kilomètres parcourus ne dépendent pas de ce qui s'écrit ici : ils restent.",
    "sheet.duplicate": "Dupliquer la fiche",
    "sheet.duplicate_note": "Un nouveau train reprend cette fiche, avec un compteur à lui. Rien n'est pris à l'original.",
    "sheet.on_the_car": "Sur la voiture",
    "sheet.tpms": "Capteurs de pression",
    "sheet.tpms_note": "Un capteur est vissé sur sa roue : il appartient au train et le suit d'une voiture à l'autre. Vider un champ le détache.",
    "sheet.separate": "Séparer en deux paires",
    "sheet.separate_note": "Les deux moitiés partent du même total — ces kilomètres ont été faits sur les quatre pneus. À partir d'ici, chacune compte pour elle-même. Rien n'est démonté.",
    "sheet.resync": "Deux relevés se contredisent",
    "sheet.settings": "Réglages du véhicule",
    "sheet.odometer": "Compteur du véhicule",
    "sheet.odometer_note": "Le total lu au tableau de bord. Les kilomètres de chaque jeu s'en déduisent : il ne peut que monter.",
    "sheet.reading": "Relevé du compteur",
    "sheet.set_total": "Kilométrage total du train",
    "sheet.adjust_note": "Ce que vous écrivez ici devient son cumul, et le compte repart de là. Rien d'autre ne bouge.",
    "sheet.rotate_note": "Chaque roue passe à l'autre bout de son côté. Le kilométrage ne change pas : seul le rappel repart, et les capteurs suivent leur roue.",
    "sheet.unmount_note": "Le compte de ce train s'arrête ici. Les kilomètres parcourus lui restent acquis.",
    "sheet.mount_all": "Monter les quatre roues.",
    "group.vehicle": "Le véhicule",
    "group.odometer": "Le compteur",
    "group.rotation": "Le rappel de permutation",
    "group.odometer_src": "Source du compteur",
    "help.pair": "une paire",
    "help.pair_note": "Une paire se monte à l'avant ou à l'arrière, et passe de l'une à l'autre.",
    "help.dot": "Les quatre chiffres du flanc : la semaine, puis l'année. La ligne DOT entière peut être collée telle quelle.",
    "help.label": "Remplace la référence à l'écran",
    "help.price": "Pour le train entier. Divisé par ce qu'il parcourt, il dit quelle référence revenait le moins cher.",
    "help.storage": "Garage, étagère gauche",
    "help.initial_total": "Pour reprendre un suivi tenu ailleurs. Zéro pour des pneus qui n'ont pas tourné.",
    "help.vehicle": "Nomme l'appareil, et à travers lui chaque entité — « Alfa GT Odomètre ».",
    "help.rotation": "Le rappel de permutation, sur un train de 4 monté. Zéro n'en dit rien.",
    "help.odometer_entity": "Relier le compteur de la voiture évite de le saisir à chaque manœuvre. Laissé vide, un champ apparaît en bas de la carte.",
    "help.replace": "Ce qui arrive au train monté",
    "help.replaced": "Remplacé",
    "help.replaced_note": "il passe à l'historique",
    "help.kept": "Laissé en place",
    "help.kept_note": "la copie attend au garage",
    "help.pair_new": "Devient un nouveau train, avec ses capteurs.",
    "help.pair_kept": "Reste sur cette fiche, et garde son historique.",
    "help.tracked_so_far": "compté jusqu'ici",
    "help.odo_dashboard": "Entrez le total lu au tableau de bord.",
    "help.odo_nothing": "Aucun kilomètre ajouté.",
    "msg.saved_settings": "Réglages enregistrés.",
    "msg.vehicle_failed": "Le véhicule n'a pas pu être enregistré.",
    "msg.set_added": "Train ajouté.",
    "msg.odometer_saved": "Compteur enregistré.",
    "msg.rotated": "Permutation enregistrée.",
    "msg.adjusted": "Cumul corrigé.",
    "msg.retired": "Train passé à l'historique.",
    "msg.unmounted": "Train déposé.",
    "msg.mounted": "Train monté.",
    "msg.record_saved": "Fiche enregistrée.",
    "msg.sensors_saved": "Capteurs enregistrés.",
    "msg.duplicated": "Fiche dupliquée.",
    "resync.no_back": "Un compteur ne recule pas : ce relevé serait refusé, et le suivi",
    "resync.stuck": "resterait bloqué",
    "delete.head": "La fiche sera effacée, avec son capteur et son appareil. Ses",
    "delete.tail": "restent en mémoire : rajouter le train les retrouve.",
    "retire.tail": "seront figés. Le train restera consultable, rangé dans l'historique, et ne pourra plus être monté.",
    "mount.displaces_all": "» sera entièrement déposé — la moitié d'un train de 4 n'est pas un train de 4.",
    "mount.displaced_many": "» seront déposés, et leur compte arrêté au relevé.",
    "mount.displaced_one": "» sera déposé, et son compte arrêté au relevé.",
    "editor.advice": "Conseil de permutation (snowtire)",
    "editor.pressures": "Pressions TPMS sous la pastille",
    "editor.title": "Titre de la carte (par défaut : le véhicule)",
    "editor.card_desc": "Parc de pneumatiques d'un véhicule : état, montage, dépose, retrait",
    "editor.badge_desc": "Pastille de pneumatiques pour plan isométrique",
    "field.optional": "facultatif",
    "field.odometer": "Compteur",
    "field.total": "Cumul",
    "act.back": "Retour",
    "act.confirm": "Valider",
    "card.opening": "Ouverture…",
    "card.sets_label": "Jeux",
    "card.tyres": "Pneumatiques",
    "card.tyres_prefix": "Pneumatiques : ",
    "card.pressures_said": ". Pressions : ",
    "card.odometer_reads": "{km}",
    "card.odometer_menu": "Compteur",
    "card.automatic": "automatique",
    "card.sensor_silent": "Capteur silencieux",
    "card.mute": "muet",
    "card.mute_for": "muet {since}",
    "card.no_sensor": "aucun capteur",
    "card.set_fallback": "Train",
    "card.unknown_error": "Erreur inconnue.",
    "status.available": "Disponible",
    "block.one_sensor": "1 capteur",
    "block.n_sensors": "{n} capteurs",
    "block.total_of": "{km} au total",
    "sheet.more_fields": "Dimension, code DOT, prix, rangement…",
    "punct.colon": " : ",
    "unit.years_one": "{n} an",
    "unit.years_many": "{n} ans",
    "unit.days_short": "j",
    "short.front_left": "AVG",
    "short.front_right": "AVD",
    "short.rear_left": "ARG",
    "short.rear_right": "ARD",
    "short.left": "GAUCHE",
    "short.right": "DROITE",
  },
};

/** « fr-CA » n'a pas de dictionnaire : sa base en a un, et c'est la reponse. */
function pickLanguage(want) {
  const asked = String(want || "en");
  const base = asked.split("-")[0];
  return WORDS[asked] ? asked : WORDS[base] ? base : "en";
}

/**
 * La langue du lecteur.
 *
 * Devinee des le chargement sur l'attribut `lang` de la page, parce que
 * certaines choses se disent avant qu'aucun `hass` ne soit arrive : la
 * description que le selecteur de cartes affiche, les libelles de l'editeur.
 * Puis confirmee par `hass.locale`, qui porte le choix explicite de la
 * personne plutot que celui de son navigateur.
 */
let LANG = pickLanguage(
  (typeof document !== "undefined" && document.documentElement?.lang) ||
    (typeof navigator !== "undefined" && navigator.language)
);

/** Reglee a chaque poussee d'etat, avant tout dessin. */
function setLanguage(hass) {
  LANG = pickLanguage(hass?.locale?.language || hass?.language || LANG);
}

/** Un mot, et ce qu'on lui glisse entre accolades. */
function t(key, ph) {
  const said = WORDS[LANG]?.[key] ?? WORDS.en[key] ?? key;
  return ph ? said.replace(/\{(\w+)\}/g, (whole, name) => ph[name] ?? whole) : said;
}

/* ---------- carte ---------- */

const CARD_VERSION = "1.0.0";
banner("Tyres Card", CARD_VERSION);

/* ---------- configuration ----------

   La pastille, posee dans un picture-elements :

     type: custom:floor-tyres-badge
     entity: sensor.alfa_pneumatiques
     advice_entity: binary_sensor.snowtire   optionnel, conseil de permutation
     pressures: true                         optionnel, grille TPMS 2x2 dessous
     tap_action: { ... }                     optionnel, defaut : popup ci-dessous
     style: { top: 40%, left: 62%, transform: ... }

   La carte, dans une vue ou un popup :

     type: custom:tyres-card
     entity: sensor.alfa_pneumatiques
     title: Alfa GT                          optionnel, defaut : le vehicule  */

/** Le service du composant, cible sur le capteur qui porte l'etat. */
const DOMAIN = "tyre_tracker";

/**
 * Les trois marquages d'un flanc, et la teinte qui va avec.
 *
 * Le soleil est `white-balance-sunny` et non `weather-sunny` : celui-la dessine
 * un anneau, et un anneau reduit aux 15 px d'une pastille de plan ne pese pas
 * plus qu'un flocon. Un disque plein face a une etoile ajouree, c'est une
 * difference de masse — elle tient a toutes les tailles, et sur la pastille,
 * ou tout est blanc, la teinte ne vient au secours de rien.
 */
/* Les teintes sont celles du theme, pas les notres. Home Assistant publie une
   palette que chaque theme redefinit : s'en servir, c'est suivre l'interface
   au lieu de poser trois couleurs a cote d'elle. La valeur de repli garde
   l'apparence voulue sur un core qui ne connaitrait pas encore le jeton.

   Consequence, et c'est le point : `tint` n'est plus une chaine hexadecimale.
   Rien ne doit plus lui coller un suffixe d'opacite — ce qui en derive se
   calcule en CSS, ou une teinte reste une couleur. */
/* Les mots sont des accesseurs et non des valeurs. Une table construite au
   chargement du module fige la langue devinee a cet instant : `hass` arrive
   apres, et quelqu'un peut changer la sienne sans recharger la page. Une icone
   et une teinte, elles, ne parlent aucune langue et restent des valeurs. */
const SEASONS = {
  summer: {
    icon: "mdi:white-balance-sunny",
    get label() {
      return t("season.summer");
    },
    tint: "var(--amber-color, #ffc107)",
  },
  winter: {
    icon: "mdi:snowflake",
    get label() {
      return t("season.winter");
    },
    tint: "var(--blue-color, #2196f3)",
  },
  all_season: {
    icon: "mdi:sun-snowflake",
    get label() {
      return t("season.all_season");
    },
    tint: "var(--green-color, #4caf50)",
  },
};
const RETIRED = {
  icon: "mdi:archive-outline",
  get label() {
    return t("season.retired");
  },
  tint: "var(--grey-color, #9e9e9e)",
};

/* « 2 roues » et non « paire » : c'est le mot du flux de configuration, et un
   train doit se lire pareil partout — sur la pastille, dans la liste, dans la
   feuille et dans le formulaire ou on le modifie. */
const AXLES = {
  get all() {
    return t("axle.all");
  },
  get pair() {
    return t("axle.pair");
  },
};

/* La meme quantite, en icone. Elle etait deja choisie — le formulaire de
   configuration montre ces deux la — mais elle s'arretait au formulaire : le
   corps de carte ecrivait « 4 roues », la pastille de plan « ×4 ». Trois
   dialectes pour un fait, contre la regle que ce fichier se donne plus haut.

   Le mot ne disparait pas pour autant : il devient le nom accessible, donc ce
   que lit un lecteur d'ecran et ce que dit l'infobulle. */
const AXLE_ICONS = {
  all: "mdi:numeric-4-box-outline",
  pair: "mdi:numeric-2-box-outline",
};

/** L'icone de quantite d'un jeu, ou rien quand l'essieu est inconnu. */
function axleIcon(axle) {
  if (!AXLE_ICONS[axle]) return null;
  const el = makeIcon(AXLE_ICONS[axle]);
  el.className = "qty";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", AXLES[axle]);
  el.setAttribute("title", AXLES[axle]);
  return el;
}
const POSITIONS = {
  get front() {
    return t("position.front");
  },
  get rear() {
    return t("position.rear");
  },
};
const AXES = ["front", "rear"];

/* L'ordre de lecture d'une voiture vue de dessus : avant en haut, gauche a
   gauche. La grille des pressions suit cette liste et n'a rien a trier. */
const CORNERS = ["front_left", "front_right", "rear_left", "rear_right"];

/* Les memes coins en toutes lettres. Le formulaire les abrege — « AVG », un
   mot de trois lettres sous une case — mais une infobulle et un lecteur
   d'ecran ne lisent pas des sigles : ils disent ou est la roue. */
const CORNER_LABELS = {
  get front_left() {
    return t("corner.front_left");
  },
  get front_right() {
    return t("corner.front_right");
  },
  get rear_left() {
    return t("corner.rear_left");
  },
  get rear_right() {
    return t("corner.rear_right");
  },
};

/* Les memes coins en sigles, pour les cases ou trois lettres suffisent. Des
   accesseurs, comme partout : la langue du lecteur peut changer apres le
   chargement du module. */
const SHORT_SLOTS = {
  get front_left() {
    return t("short.front_left");
  },
  get front_right() {
    return t("short.front_right");
  },
  get rear_left() {
    return t("short.rear_left");
  },
  get rear_right() {
    return t("short.rear_right");
  },
  get left() {
    return t("short.left");
  },
  get right() {
    return t("short.right");
  },
};

const km = (n) =>
  Number.isFinite(Number(n)) ? `${Math.round(Number(n)).toLocaleString(LANG)} km` : "—";

/** Un nombre lisible : deux decimales au plus, et pas de zero pour rien. */
const trim = (n) =>
  Number.isFinite(Number(n))
    ? Number(Number(n).toFixed(2)).toLocaleString(LANG)
    : "—";

/** « 42 €/1000 km » — le chiffre qui compare deux references entre elles. */
const cost = (set) =>
  Number.isFinite(Number(set?.cost_per_1000km))
    ? `${trim(set.cost_per_1000km)} €/1000 km`
    : null;

/**
 * Depuis combien de temps un capteur se tait — « 12 min », « 5 h », « 3 j ».
 *
 * Le composant porte la date du dernier releve depuis toujours ; la carte ne
 * s'en servait pas, et grisait la roue sans dire de quand datait le chiffre
 * qu'elle laissait affiche. C'est pourtant la toute la difference entre une
 * pression basse et une pression d'avant-hier.
 */
function sinceLabel(iso) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  // « min » et « h » se lisent dans les deux langues ; le jour, non — « j »
  // en francais, « d » en anglais — alors lui seul passe par le dictionnaire.
  return hours < 48
    ? `${hours} h`
    : `${Math.round(hours / 24)} ${t("unit.days_short")}`;
}

/** La saison d'un jeu, ou la marque « historique » qui prime dessus. */
const look = (set) => (set?.retired ? RETIRED : SEASONS[set?.season] ?? SEASONS.summer);

/**
 * Le code de date, tel qu'il se lit, suivi de l'age qu'il donne.
 *
 * Quatre chiffres : la semaine, puis l'annee. Le code brut reste affiche parce
 * que c'est lui qu'on retrouve sur le flanc quand on verifie ; l'age l'y
 * accompagne parce qu'un pneu vieillit a l'arret et qu'aucun compteur ne le
 * voit passer. Rien de plus : le composant ne dit pas quand changer, il dit ce
 * qui est ecrit et depuis combien de temps.
 */
function dotLabel(set) {
  const parsed = /^(\d{2})(\d{2})$/.exec(String(set?.dot ?? ""));
  if (!parsed) return null;

  const week = Number(parsed[1]);
  const raw = `DOT ${set.dot}`;
  if (week < 1 || week > 53) return raw;

  // Le lundi de cette semaine-la, a une poignee de jours pres : suffisant pour
  // un age exprime en annees entieres.
  const made = new Date(2000 + Number(parsed[2]), 0, 1 + (week - 1) * 7);
  const years = Math.floor((Date.now() - made.getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years < 0) return raw;
  const age = years <= 1 ? t("unit.years_one", { n: years }) : t("unit.years_many", { n: years });
  return `${raw} (${age})`;
}

/** `ha-icon` construit par le DOM : le nom vient de nos tables, jamais d'un etat. */
function makeIcon(name) {
  const el = document.createElement("ha-icon");
  el.setAttribute("icon", name);
  return el;
}

/** Le jeu monte a une position, depuis l'attribut `fitted`. */
const fittedAt = (attrs, position) => attrs?.fitted?.[position] ?? null;

/**
 * Combien de pneus fait ce jeu : « all » ou « pair », et rien quand on ne sait pas.
 *
 * Les entrees de `fitted` portent l'essieu, mais elles ne l'ont pas toujours
 * porte, et une carte gardee en cache par le navigateur peut parler a une
 * integration plus ancienne — c'est meme la regle le temps qu'une mise a jour
 * finisse de passer. `sets` tient la meme information et voyage dans le meme
 * attribut : la relire coute un `find`, contre un compte faux affiche avec
 * aplomb. Et faute des deux, on se tait plutot que de supposer une paire.
 */
const axleOf = (set, attrs) =>
  set?.axle ?? attrs?.sets?.find((other) => other.id === set?.id)?.axle ?? null;

/** Les essieux qu'occupe un jeu, en cles — « front », « rear ». */
const axesOf = (set) =>
  (Array.isArray(set?.positions) ? set.positions : []).filter((p) => AXES.includes(p));

/**
 * L'etat d'un train en une ligne, celle qui ouvre chacun de ses ecrans.
 *
 * Meme phrase que celle construite en Python pour le flux — nombre de pneus,
 * kilometres, ou il se trouve. Un train doit se presenter de la meme facon
 * qu'on l'ouvre depuis la carte ou depuis Parametres, sans quoi on doute
 * d'avoir ouvert le bon.
 */
function stateLine(set, attrs) {
  const bits = [];
  const axle = axleOf(set, attrs);
  if (axle) bits.push(AXLES[axle] ?? axle);
  bits.push(km(set.km));

  const on = axesOf(set);
  if (set.retired) bits.push(t("status.retired"));
  else if (on.length >= AXES.length) bits.push(t("status.mounted"));
  else if (on.length)
    bits.push(t("status.mounted_at", { position: POSITIONS[on[0]].toLowerCase() }));
  else bits.push(t("status.removed"));

  return bits.join(" · ");
}

/** Le nom d'un train, tel qu'on le lui parle. */
const nameOf = (set) => set?.label || set?.reference || t("card.set_fallback");

/** Un fragment en gras, pour les phrases qui annoncent une consequence. */
function bold(text) {
  const el = document.createElement("b");
  el.textContent = text;
  return el;
}

/* ---------- la pastille de plan ---------- */

const BADGE_STYLE = `
  ${planBadgeStyle({ dashed: false })}

  /* Deux jeux differents montes : deux lignes, une par essieu. Elire l'un des
     deux serait un mensonge, et les concatener sur une ligne rendrait illisible
     ce qui doit se lire de loin, sur un plan charge. */
  .badge { flex-direction: column; align-items: stretch; gap: 2px; }
  .line { display: flex; align-items: center; gap: 4px; }

  /* La saison, en couleur — la meme teinte que dans la carte, prise aux jetons
     du theme. Le reste de la ligne reste blanc : sur un plan, c'est le nom du
     jeu qu'on lit, et deux couleurs cote a cote se disputeraient l'oeil. La
     forme continue de porter l'information seule, pour qui ne distingue pas
     le bleu de l'ambre — la couleur double la lecture, elle ne la remplace pas.

     \`filter\` plutot qu'une ombre portee : l'ombre du texte ne suit pas le
     trace d'un SVG, et un flocon ambre sur toit clair aurait perdu le contour
     que le reste de la pastille garde. */
  ha-icon.season {
    color: var(--tint, var(--badge-color));
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .85));
  }

  /* ---- les pressions, en option ----

     Deux colonnes, deux lignes : la voiture vue de dessus, dans le meme sens
     que le plan. Le filet du haut separe sans encadrer — un cadre ferait une
     seconde pastille sous la premiere, alors que c'est le meme objet.

     Pas d'unite dans les cases. Les quatre la partagent, l'ecrire quatre fois
     doublerait la largeur de la grille pour une information constante ; elle
     reste dans l'infobulle de chaque roue, avec le nom du coin. */
  .tpms {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px 8px;
    margin-top: 3px;
    padding-top: 3px;
    border-top: 1px solid rgba(255, 255, 255, .35);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  /* Chaque colonne serre vers l'axe de la voiture : les deux roues d'un meme
     essieu se lisent en paire, et deux nombres cales a gauche se seraient lus
     comme une liste. */
  .wheel { text-align: center; }

  /* Un capteur muet : la pression affichee est un souvenir. Grisee plutot
     qu'ecrite « muet » — la pastille n'a pas la place du mot, et le detail
     attend dans l'infobulle. */
  .wheel.stale { opacity: .45; }

  /* Un pneu appele faux — par le TPMS lui-meme ou par la consigne du train.
     Rouge et gras : sur un plan, c'est la case qu'on doit voir de loin. Un
     drapeau distinct du silence, qui grise : 1,4 bar demande de l'air, une
     pile morte demande un capteur. */
  .wheel.alarm { color: #ff6b6b; font-weight: 700; }

  /* L'essieu, quand il y a un choix a faire — donc jamais pour un jeu de 4. */
  .pos {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .4px;
    padding-top: 1px;
  }
  /* La quantite : deux ou quatre pneus. Discrete, mais toujours la — c'est
     elle qui dit si l'autre essieu porte encore autre chose. */
  .qty {
    font-size: 10px;
    opacity: .7;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }

  /* Le nom du jeu. Il porte la ligne : « 12 000 km » ne dit pas lequel des
     deux jeux d'ete les a faits, et c'est la question qu'on se pose devant un
     plan. Coupe plutot que laisse filer — la pastille est placee au pixel sur
     un dessin, et une reference a rallonge la ferait deborder du capot. Le
     nom entier reste dans l'infobulle. */
  .name {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Le kilometrage passe en retrait : c'est le nom qu'on cherche d'abord. */
  .km {
    font-size: 12px;
    opacity: .8;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }

  /* Le conseil de permutation. Un point, pas un mot : la pastille tient sur
     un plan charge, et l'information « il serait temps » n'a pas besoin de
     phrase pour se lire. Le detail est dans la carte. Pose au coin, il tient
     la meme place que la pastille ait une ligne ou deux. */
  .tip {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ffb300;
    box-shadow: 0 0 5px rgba(255, 179, 0, .8);
  }
  .tip[hidden] { display: none; }

  /* L'alarme de pression, au coin oppose du conseil : une voiture au pneu a
     plat doit se voir sur le plan sans ouvrir le popup, meme quand la grille
     des pressions n'est pas affichee. Rouge contre ambre — l'un dit « il
     serait temps », l'autre dit « maintenant ». */
  .flat {
    position: absolute;
    top: -3px;
    left: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ff5252;
    box-shadow: 0 0 5px rgba(255, 82, 82, .8);
  }
  .flat[hidden] { display: none; }
`;

class FloorTyresBadge extends HTMLElement {
  #config = null;
  #hass = null;
  #els = null;
  #seen = {};
  #painted = false;

  static getStubConfig() {
    return { entity: "sensor.pneumatiques" };
  }

  static getConfigElement() {
    return document.createElement("floor-tyres-badge-editor");
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("sensor.")) {
      throw new Error(t("card.badge_config"));
    }
    this.#config = config;
    this.#seen = {};
    this.#painted = false;
    this.#build();
    if (this.#hass) this.hass = this.#hass;
  }

  #build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BADGE_STYLE}</style>
      <div class="badge" role="button" tabindex="0">
        <i class="tip" hidden></i>
        <i class="flat" hidden></i>
      </div>`;

    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this.#els = { badge: $(".badge"), tip: $(".tip"), flat: $(".flat") };

    const fire = () => this.#fire();
    this.#els.badge.addEventListener("click", fire);
    this.#els.badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      fire();
    });
  }

  /** Le popup par defaut : la carte complete, sur la meme entite. */
  #fire() {
    const action = this.#config.tap_action ?? {
      action: "fire-dom-event",
      browser_mod: {
        service: "browser_mod.popup",
        data: {
          content: { type: "custom:tyres-card", entity: this.#config.entity },
        },
      },
    };
    performAction(this, this.#hass, action, this.#config.entity);
  }

  set hass(hass) {
    this.#hass = hass;
    // Avant tout dessin : la langue du lecteur decide de chaque mot pose
    // ensuite, et elle peut changer sans que la carte soit reconstruite.
    const spoke = LANG;
    setLanguage(hass);
    if (!this.#config) return;
    const ids = [this.#config.entity];
    if (this.#config.advice_entity) ids.push(this.#config.advice_entity);
    // Une langue qui change repeint meme sans nouvel etat : les mots poses
    // sont ceux de l'ancienne, et aucune poussee d'entite ne viendra les laver.
    const changed = watch(hass, ids, this.#seen) || LANG !== spoke;
    if (!changed && this.#painted) return;
    this.#painted = true;
    this.#update();
  }

  #update() {
    const attrs = this.#seen[this.#config.entity]?.attributes ?? {};
    const front = fittedAt(attrs, "front");
    const rear = fittedAt(attrs, "rear");
    const same = front && rear && front.id === rear.id;

    const advice = this.#config.advice_entity
      ? this.#seen[this.#config.advice_entity]?.state === "on"
      : false;

    // Une ligne par jeu reellement monte. Un jeu de 4 en fait une, deux jeux
    // distincts en font deux, une paire seule en fait une avec son essieu.
    const lines = [];
    if (same) {
      lines.push({ set: front, positions: ["front", "rear"] });
    } else {
      if (front) lines.push({ set: front, positions: ["front"] });
      if (rear) lines.push({ set: rear, positions: ["rear"] });
    }

    // La liste vient du composant, deja jugee : verdict du TPMS ou consigne
    // du train, la pastille n'a rien a recalculer.
    const alarmed = attrs.pressure_alarm ?? [];

    this.#els.badge.replaceChildren(this.#els.tip, this.#els.flat);
    this.#els.tip.hidden = !advice;
    this.#els.flat.hidden = !alarmed.length;
    if (alarmed.length) this.#els.flat.title = t("card.alarm_title");

    if (!lines.length) {
      // Rien de monte : la pastille le dit plutot que de disparaitre, sans
      // quoi on la croirait en panne.
      this.#els.badge.appendChild(this.#line(null, [], attrs));
      this.#els.badge.title = t("card.none_fitted");
      this.#els.badge.setAttribute("aria-label", t("card.badge_none"));
      return;
    }

    for (const line of lines) {
      this.#els.badge.appendChild(this.#line(line.set, line.positions, attrs));
    }

    const tpms = this.#config.pressures ? this.#tpms(attrs) : null;
    if (tpms) this.#els.badge.appendChild(tpms);

    const detail = lines
      .map((l) => `${this.#spoken(l.positions)}${nameOf(l.set)} ${km(l.set.km)}`)
      .join(", ");
    this.#els.badge.title = detail;
    this.#els.badge.setAttribute(
      "aria-label",
      `${t("card.tyres_prefix")}${detail}${this.#spokenPressures(attrs)}${
        alarmed.length ? t("card.alarm_short") : ""
      }${advice ? t("card.advice_short") : ""}`
    );
  }

  /**
   * Les quatre pressions, du point de vue du conducteur.
   *
   * Deux colonnes, deux lignes, dans l'ordre de `CORNERS` : avant en haut,
   * gauche a gauche — AVG en haut a gauche, ARD en bas a droite. Ce n'est pas
   * l'orientation du plan, qui montre la voiture depuis un autre bord, mais
   * celle qu'on a en tete quand on parle de ses roues, et c'est aussi celle de
   * la grille de la carte : une pastille et une carte qui se contrediraient
   * feraient lire la pression d'une roue en regardant l'autre.
   *
   * C'est cette constance qui permet de se passer d'etiquette de coin — sur
   * une pastille de plan, « AVG » a cote de « 2,3 » doublerait la largeur pour
   * ne rien apprendre que la position ne dise deja.
   *
   * Les quatre cases sont toujours la des qu'un capteur existe : n'afficher
   * que les coins equipes ferait glisser une roue arriere a la place d'une
   * avant, et la disposition ne voudrait plus rien dire. Un coin sans capteur
   * porte un tiret.
   *
   * Rien du tout quand aucun capteur n'est attache — la pastille ne grandit
   * pas d'un cadre vide pour un vehicule qui n'a pas de TPMS.
   */
  #tpms(attrs) {
    const byCorner = attrs.pressures ?? {};
    if (!CORNERS.some((corner) => byCorner[corner])) return null;

    const grid = document.createElement("div");
    grid.className = "tpms";

    for (const corner of CORNERS) {
      const read = byCorner[corner];
      const cell = document.createElement("span");
      cell.className = "wheel";

      if (!read) {
        cell.textContent = "—";
        cell.title = `${CORNER_LABELS[corner]}${t("punct.colon")}${t("card.no_sensor")}`;
        grid.appendChild(cell);
        continue;
      }

      // Le silence se voit plutot qu'il ne s'ecrit : la pastille n'a pas la
      // place du mot « muet », et une pression grisee dit assez qu'elle date.
      if (read.stale) cell.classList.add("stale");
      // L'alarme aussi : rouge, pas un mot. Les deux peuvent se cumuler — un
      // capteur muet dont le dock crie encore reste un pneu a voir.
      if (read.alarm) cell.classList.add("alarm");

      cell.textContent =
        read.pressure == null ? "—" : trim(read.pressure);

      const since = read.stale ? sinceLabel(read.last_seen) : null;
      cell.title =
        `${read.label ?? CORNER_LABELS[corner]}${t("punct.colon")}` +
        (read.pressure == null
          ? t("card.no_reading")
          : `${trim(read.pressure)} ${read.unit ?? ""}`.trim()) +
        (read.alarm ? t("card.alarm_note") : "") +
        (since ? t("card.no_reading_for", { since }) : "");

      grid.appendChild(cell);
    }
    return grid;
  }

  /** Les pressions dites a voix haute, pour l'etiquette accessible. */
  #spokenPressures(attrs) {
    if (!this.#config.pressures) return "";
    const byCorner = attrs.pressures ?? {};
    const said = CORNERS.filter((corner) => byCorner[corner]?.pressure != null).map(
      (corner) =>
        `${CORNER_LABELS[corner].toLowerCase()} ${trim(byCorner[corner].pressure)} ${
          byCorner[corner].unit ?? ""
        }`.trim()
    );
    return said.length ? `${t("card.pressures_said")}${said.join(", ")}` : "";
  }

  /** « avant », « arrière », rien quand le jeu couvre les quatre roues. */
  #spoken(positions) {
    if (positions.length !== 1) return "";
    return `${POSITIONS[positions[0]].toLowerCase()} `;
  }

  /**
   * Une ligne : l'icone de saison, l'essieu s'il y a un choix a faire, le nom
   * du jeu, sa quantite de pneus, et son kilometrage.
   *
   * L'essieu n'apparait pas pour un jeu de quatre : il n'y a rien a distinguer,
   * et l'ecrire ferait croire que l'autre essieu porte autre chose. C'est la
   * meme regle qu'au montage, ou on ne demande pas ou poser un jeu de quatre.
   */
  #line(set, positions, attrs) {
    const el = document.createElement("div");
    el.className = "line";

    // La teinte voyage par `--tint`, comme dans la carte : c'est une variable
    // de theme, pas une couleur en dur, et elle suit donc le theme actif.
    const mark = makeIcon(set ? look(set).icon : "mdi:car-tire-alert");
    mark.className = "season";
    if (set) mark.style.setProperty("--tint", look(set).tint);
    el.appendChild(mark);

    if (!set) {
      const none = document.createElement("span");
      none.className = "label";
      none.textContent = t("card.no_set");
      el.appendChild(none);
      return el;
    }

    if (positions.length === 1) {
      const pos = document.createElement("span");
      pos.className = "pos";
      pos.textContent = POSITIONS[positions[0]].slice(0, 2).toUpperCase();
      el.appendChild(pos);
    }

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = nameOf(set);
    el.appendChild(name);

    // Meme icone que dans la carte et que dans le formulaire. Elle disait
    // « ×4 » ici, « 4 roues » la-bas : un train doit se lire pareil partout.
    const qty = axleIcon(axleOf(set, attrs));
    if (qty) el.appendChild(qty);

    const dist = document.createElement("span");
    dist.className = "km";
    dist.textContent = km(set.km);
    el.appendChild(dist);
    return el;
  }

  getCardSize() {
    return 1;
  }
}

/* ---------- la carte ---------- */

/**
 * Le voile du portail, rendu transparent.
 *
 * Un `dialog` modal pose un `::backdrop` que le navigateur assombrit. Nos
 * feuilles ont deja le leur, et le menu n'en veut aucun — deux voiles
 * superposes feraient de la carte en dessous une ombre.
 *
 * C'est la seule regle que ce fichier ecrit hors de ses racines d'ombre :
 * `::backdrop` appartient au document qui porte l'element, et ne s'atteint ni
 * en style en ligne ni depuis une racine d'ombre. Elle est posee une fois et
 * porte notre classe, donc ne touche rien d'autre.
 */
function portalBackdrop() {
  const id = "tyres-card-portal-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = ".tyres-card-sheets::backdrop { background: transparent; }";
  document.head.appendChild(style);
}

const CARD_STYLE = `
  ha-card { display: block; overflow: hidden; }
  .body { padding: 0 0 14px; }

  /* ---- ce qui derive de la teinte d'un jeu ----

     Un seul reglage vient du JavaScript : \`--tint\`. Tout le reste se calcule
     ici, sur les memes elements — une teinte prise dans un jeton de theme
     n'est pas une chaine a laquelle on ajoute « 22 ».

     La regle porte sur les elements qui posent \`--tint\` eux-memes, et non
     sur l'hote : une propriete personnalisee se calcule la ou elle est
     declaree, puis s'herite en valeur. Declaree une fois en haut, elle
     donnerait la meme teinte douce a tous les jeux.

     \`--tint-ink\` melange la teinte vers l'encre du theme : elle fonce sur
     fond clair, s'eclaircit sur fond sombre. Une seule formule pour les deux,
     parce que c'est le theme qui dit ou est son encre — et l'icone d'un jeu
     d'ete cesse de faire 1,97:1 sur une carte blanche. */
  .hero, .row, .tid, .sheet {
    --tint-soft: color-mix(in srgb, var(--tint) 16%, transparent);
    --tint-ink: color-mix(in srgb, var(--tint) 50%, var(--primary-text-color));
  }

  /* ---- l'en-tete de la carte ----

     Le nom de la voiture, son compteur, et le seul point d'entree de ce qui
     ne vise aucun train. 16 px et graisse moyenne, et non les 24 px d'un
     titre de carte de Home Assistant : le protagoniste ici est le kilometrage
     juste dessous, et un titre plus lourd que lui inverserait la lecture. */
  .chead {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 14px 8px 12px 16px;
  }
  .chead .ct { flex: 1; min-width: 0; }
  .chead .h {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -.01em;
  }
  .chead .s {
    margin-top: 2px;
    font-size: 13px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }
  /* La cible fait 40 px, l'encre beaucoup moins : discret sans etre petit. */
  .iconbtn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    margin-top: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    --mdc-icon-size: 20px;
  }
  .iconbtn:hover {
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    color: var(--primary-text-color);
  }

  /* ---- l'en-tete repond avant qu'on demande ---- */
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 16px 14px;
  }
  /* Deux blocs des que l'avant et l'arriere different : annoncer un seul jeu
     serait faux, et rien plus bas ne rattraperait l'erreur. */
  .heroes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--divider-color);
  }
  .heroes .hero { background: var(--card-background-color); padding: 14px; }
  .heroes .km { font-size: 21px; }
  .hero .mark {
    flex: 0 0 auto;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 24px;
  }
  .hero .txt { flex: 1; min-width: 0; }
  /* La quantite de pneus, contre la reference qu'elle qualifie. En \`em\` : elle
     suit le corps du texte qui la porte, donc l'echelle du theme, et tient
     aussi bien dans un en-tete que dans une ligne de liste. */
  .qty {
    --mdc-icon-size: 1.15em;
    width: 1.15em;
    height: 1.15em;
    margin-left: .35em;
    vertical-align: -.16em;
    color: var(--secondary-text-color);
  }
  .pos {
    display: block;
    margin-bottom: 3px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .5px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .km {
    font-size: 27px;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -.02em;
    font-variant-numeric: tabular-nums;
  }
  .ref { margin-top: 2px; font-size: 14px; font-weight: 500; }
  .sub { margin-top: 3px; font-size: 13px; color: var(--secondary-text-color); }

  /* ---- conseil de permutation ----
     Un \`ha-alert\` : c'est le composant de Home Assistant pour ce cas, il
     porte deja son icone, sa couleur et son contraste, et il suivra le theme
     sans que nous ayons a le savoir. Il ne reste qu'a le placer. */
  .advice { display: block; margin: 0 16px 14px; }
  .advice[hidden] { display: none; }

  /* ---- les pressions, dessinees comme la voiture ---- */
  /* Deux colonnes, deux rangees : gauche a gauche, avant en haut. Une liste
     alignee aurait demande de relire l'etiquette a chaque coin, la ou la
     disposition la dit toute seule. */
  .tpms {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin: 0 16px 14px;
  }
  .tpms .wheel {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--secondary-background-color);
  }
  .tpms .corner {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .5px;
    color: var(--secondary-text-color);
  }
  /* La pression est la donnee : elle porte le corps et la graisse. */
  .tpms .p { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }
  /* Le second membre, un seul par roue : temperature d'ordinaire, pile faible
     ou silence quand il y en a un — voir \`#wheelAside\`. */
  .tpms .t {
    display: inline-flex;
    align-items: center;
    gap: .3em;
    margin-left: auto;
    font-size: 12px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
    --mdc-icon-size: 14px;
  }
  .tpms .t.alarm { color: var(--warning-color, #ffa726); }
  /* Le rouge est reserve au pneu appele faux — par le dock ou par la
     consigne. L'ambre dit « le capteur a un souci », le rouge « le pneu en a
     un » : deux drapeaux, jamais un seul. */
  .tpms .t.danger { color: var(--error-color, #db4437); }
  .tpms .wheel.alarm { box-shadow: inset 0 0 0 1px var(--error-color, #db4437); }
  .tpms .wheel.alarm .p { color: var(--error-color, #db4437); }
  /* Une pile morte laisse la derniere valeur en place et ne dit rien. Le coin
     est donc grise plutot que d'afficher une pression qui date de trois mois
     comme si elle etait d'aujourd'hui. */
  .tpms .wheel.stale { opacity: .45; }
  .tpms .wheel.stale .p { font-weight: 500; }

  /* ---- le parc ---- */
  .label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: 4px 16px 6px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  /* Le nombre, aligne a droite comme les kilometrages des lignes qu'il
     annonce. Il ne se dit qu'ici : l'en-tete porte le compteur, qui est ce
     que la liste ne peut pas dire d'elle-meme. */
  .label .count { font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .row {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-top: 1px solid var(--divider-color);
    transition: background 140ms ease;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .row[role="button"] { cursor: pointer; }
  .row[role="button"]:hover { background: var(--secondary-background-color); }
  .row:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
  .row .ic {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 17px;
  }
  .row .name { font-size: 14px; font-weight: 500; line-height: 1.25; }
  .row .meta { font-size: 12px; color: var(--secondary-text-color); }
  .row .val {
    text-align: right;
    font-size: 14px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .row .state {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--secondary-text-color);
  }
  /* Ce qui appelle une decision. La bordure et le fond portent la couleur, le
     texte reste a l'encre du theme : une pastille se remarque par sa forme,
     pas en peignant douze pixels de haut en orange. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: .3em;
    margin-top: 3px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    color: var(--primary-text-color);
    border: 1px solid color-mix(in srgb, var(--warning-color, #ffa726) 55%, transparent);
    background: color-mix(in srgb, var(--warning-color, #ffa726) 15%, transparent);
    --mdc-icon-size: 13px;
  }
  .pill.quiet {
    border-color: var(--divider-color);
    background: none;
    color: var(--secondary-text-color);
  }
  .pill[title] { cursor: help; }
  /* Comparaison, non jauge : la barre est relative au jeu le plus roule.
     Le composant ne connait pas la duree de vie d'un pneu, la carte ne fait
     donc pas semblant de la connaitre. */
  .bar {
    grid-column: 2 / 4;
    height: 3px;
    border-radius: 2px;
    margin-top: 5px;
    background: var(--divider-color);
    overflow: hidden;
  }
  .bar i { display: block; height: 100%; border-radius: 2px; background: var(--tint); }

  .row.is-mounted { background: color-mix(in srgb, var(--tint) 9%, transparent); }
  .row.is-mounted .state { color: var(--primary-text-color); }

  /* A l'historique. L'opacite seule ne suffisait pas a le distinguer d'un jeu
     simplement disponible : on ajoute une hachure de fond, un liseré a gauche
     et un etat encadre. Trois signaux qui ne dependent pas de la couleur, donc
     lisibles aussi pour qui ne la percoit pas. */
  .row.is-retired {
    border-left: 3px solid var(--secondary-text-color);
    padding-left: 13px;
    background: repeating-linear-gradient(
      -45deg,
      transparent 0 6px,
      color-mix(in srgb, var(--secondary-text-color) 7%, transparent) 6px 12px
    );
  }
  .row.is-retired .ic { opacity: .5; }
  .row.is-retired .name {
    opacity: .6;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .row.is-retired .val { opacity: .6; }
  .row.is-retired .state {
    display: inline-block;
    margin-top: 2px;
    padding: 1px 6px;
    border: 1px solid var(--secondary-text-color);
    border-radius: 8px;
    opacity: .85;
  }
  .row.is-retired .bar { display: none; }

  /* ---- les boutons, partout ou il y en a ----

     Aux metriques de Home Assistant : 40 px de haut, libelle de 14, icone de
     18, forme de pilule. Ils faisaient 30 px et 12,5 px — plus petits que tout
     bouton voisin sur le meme tableau de bord, et sous la cible tactile
     minimale. */
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    padding: 0 20px;
    border: 1px solid var(--divider-color);
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    --mdc-icon-size: 18px;
  }
  .act:hover { border-color: var(--primary-color); }
  .act.primary {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .act.danger {
    color: var(--error-color);
    border-color: color-mix(in srgb, var(--error-color) 40%, transparent);
  }
  /* Un geste que la saisie ne permet pas encore. Il reste lisible : c'est le
     bouton qu'on cherche, et l'effacer ferait croire qu'il n'existe pas. */
  .act[disabled] { opacity: .45; cursor: default; }
  .act[disabled]:hover { border-color: var(--divider-color); }
  /* ---- le geste d'une carte encore vide ----
     Le seul endroit ou un bouton reste sur la carte : une carte vide est faite
     pour etre remplie, et le menu seul se chercherait. */
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 16px 4px;
  }

  /* ---- le menu de la carte ----

     Peint dans le portail, en position fixe, place au pixel sous son bouton.
     La couche transparente en dessous capte le clic qui referme : sans elle,
     il faudrait ecouter le document entier et deviner ce qui appartient au
     menu a travers deux frontieres de shadow DOM. */
  .menu-layer { position: fixed; inset: 0; z-index: 8; }
  .cardmenu {
    position: fixed;
    min-width: 216px;
    max-width: calc(100vw - 16px);
    padding: 8px 0;
    border-radius: 12px;
    background: var(--ha-card-background, var(--card-background-color));
    border: 1px solid var(--divider-color);
    box-shadow: 0 4px 6px rgba(0, 0, 0, .12), 0 12px 28px rgba(0, 0, 0, .18);
  }
  .cardmenu .mi {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    background: none;
    font: inherit;
    font-size: 14px;
    text-align: left;
    color: var(--primary-text-color);
    cursor: pointer;
    --mdc-icon-size: 18px;
  }
  .cardmenu .mi ha-icon { flex: 0 0 auto; color: var(--secondary-text-color); }
  .cardmenu .mi .mt { flex: 1; min-width: 0; }
  .cardmenu .mi .mv { font-size: 13px; color: var(--secondary-text-color); }
  .cardmenu .mi:hover:not([disabled]) {
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
  }
  /* Une ligne qui ne s'ouvre sur rien : le compteur nourri par un capteur. Elle
     informe, donc elle reste lisible — un demi-ton la ferait passer pour une
     option qu'on aurait le droit d'activer. */
  .cardmenu .mi[disabled] { cursor: default; }
  .cardmenu .msep { height: 1px; margin: 7px 0; background: var(--divider-color); }

  /* ---- la feuille d'un train ----

     Les actions vivaient dans la ligne, ou la place manquait : tout tenait sur
     un rang, et ce qui n'y tenait pas partait sous « … ». Ici elles ont la
     largeur d'une feuille, ce qui permet de les nommer et de les grouper par
     ce qu'elles touchent — la fiche, les capteurs, le compte — au lieu de les
     aligner par ordre d'arrivee. */
  .tid { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .tid .mark {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 22px;
  }
  .tid .txt { min-width: 0; }
  .tid .nm { font-size: 16px; font-weight: 500; line-height: 1.2; }
  .tid .st {
    margin-top: 2px;
    font-size: 13px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .verbs { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }

  /* Un bloc par chose qu'on peut vouloir changer, et un seul verbe par bloc.
     Le corps dit ce que le bloc contient aujourd'hui : sans cela le verbe
     ouvrirait un formulaire pour repondre a une question qu'on ne s'est pas
     encore posee. */
  .tblock {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--divider-color);
  }
  .tblock .hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .tblock .ttl {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .6px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .tblock .bd {
    margin-top: 5px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--secondary-text-color);
  }
  .tblock .bd b { color: var(--primary-text-color); font-weight: 500; }
  .tblock .bd.none { font-style: italic; opacity: .8; }

  /* Le lien d'un bloc : un verbe, sans cadre. Un bouton par bloc ferait quatre
     boutons de meme poids que « Monter », qui est le geste du jour. */
  .lnk {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-color);
    white-space: nowrap;
  }
  .lnk:hover { text-decoration: underline; }
  .lnk:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  /* Le rare et le conséquent, en fin de feuille : lisible, mais sans le relief
     d'un bouton — on ne s'y appuie pas par megarde. */
  .tmore {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 14px;
    padding-top: 11px;
    border-top: 1px solid var(--divider-color);
  }
  .tmore .lnk { font-weight: 500; color: var(--secondary-text-color); }
  .tmore .lnk.danger { color: var(--error-color); }

  /* L'encart de confirmation. Il prend la place des verbes plutot que de
     s'ouvrir par-dessus : le geste se confirme la ou il a ete demande. */
  .confirm {
    margin: 14px 0 4px;
    padding: 12px;
    border-radius: 12px;
    background: var(--secondary-background-color);
    border: 1px solid var(--divider-color);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .confirm.danger { border-color: color-mix(in srgb, var(--error-color) 35%, transparent); }
  .confirm .say { font-size: 13px; line-height: 1.5; }
  .confirm .say b { font-weight: 500; }
  .confirm .fld { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .confirm input {
    width: 110px;
    padding: 6px 9px;
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
  }
  .confirm .acts { display: flex; flex-wrap: wrap; gap: 8px; }

  /* ---- les feuilles ----

     Une seule pile, un seul voile. La fiche d'un train, l'ecran qui la
     modifie et le formulaire qui la remplit s'empilent au lieu de se
     remplacer : on revient d'ou l'on vient, et « Annuler » ne renvoie plus a
     la carte deux niveaux plus bas, en ayant perdu le train qu'on regardait.

     Le voile est peint dans un hote pose en fin de \`body\`, hors de la carte
     — voir \`#openPortal\`. C'est ce qui rend le \`position: fixed\` ci-dessous
     fiable : dans la carte, le moindre \`transform\` sur un ancetre en faisait
     un positionnement relatif a la carte elle-meme. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 7;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, .45);
  }
  .sheet {
    width: min(480px, 100%);
    max-height: min(86vh, 720px);
    overflow: auto;
    padding: 20px;
    border-radius: var(--ha-card-border-radius, 16px);
    background: var(--ha-card-background, var(--card-background-color));
    color: var(--primary-text-color);
    box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
    /* Une feuille qui ne parle d'aucun train prend la teinte de l'interface :
       les pastilles de choix s'y accordent sans avoir a s'en soucier. */
    --tint: var(--primary-color);
  }
  .sheet:focus-visible { outline: none; }
  .sheet h2 { margin: 0; font-size: 17px; font-weight: 500; }

  /* L'en-tete. Le chevron n'apparait qu'a partir du deuxieme etage : au
     premier il n'y a rien derriere, et un retour qui referme se lirait comme
     une annulation deguisee. */
  .shead { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
  .shead .tid { flex: 1; min-width: 0; margin-bottom: 0; }
  .shead h2 { flex: 1; min-width: 0; }
  .back {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    margin-left: -5px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    --mdc-icon-size: 22px;
  }
  .back:hover { background: var(--secondary-background-color); color: var(--primary-text-color); }

  .sheet .desc {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--secondary-text-color);
  }
  /* Les paragraphes du flux, rendus un a un : \`pre-wrap\` sur le bloc entier
     rendait les sauts de ligne du markdown en blancs verticaux doubles. */
  .sheet .desc p { margin: 0 0 8px; }
  .sheet .desc p:last-child { margin-bottom: 0; }
  .sheet .desc ul { margin: 0 0 8px; padding-left: 18px; }
  .sheet .desc li { margin: 2px 0; }
  .sheet .desc strong { color: var(--primary-text-color); font-weight: 500; }
  .sheet .err {
    margin: 0 0 13px;
    padding: 9px 11px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--error-color);
    background: color-mix(in srgb, var(--error-color) 12%, transparent);
  }
  .sheet ha-form { display: block; }
  .sheet .menu { display: flex; flex-direction: column; gap: 8px; }
  .sheet .menu .act { justify-content: flex-start; height: 40px; border-radius: 12px; }
  .sheet-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  /* Un pied de formulaire porte le geste : plus haut que les pilules d'une
     ligne de liste, qui, elles, doivent s'effacer. */
  .sheet-foot .act { height: 36px; padding: 0 16px; }
  .act[disabled] { opacity: .5; cursor: default; }

  /* ---- les champs ----

     Le nom au-dessus, l'aide en dessous, et l'aide seulement quand elle
     apprend quelque chose. Le flux en ecrit une sous chacun de ses neuf
     champs — c'est juste dans une page de reglages qu'on lit une fois, mais
     ici cela noie les trois qui en avaient besoin. Les autres passent en
     exemple dans la boite, la ou l'oeil est deja. */
  .fset { display: flex; flex-direction: column; gap: 15px; }
  .fld2 .lb {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .55px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .fld2 .lb .opt {
    margin-left: 7px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    opacity: .75;
  }
  .fld2 .hp { margin-top: 6px; font-size: 12px; line-height: 1.45; color: var(--secondary-text-color); }
  .fld2 .no { margin-top: 6px; font-size: 12px; line-height: 1.45; color: var(--error-color); }
  .fld2.wrong .lb { color: var(--error-color); }
  .fld2.wrong .tx { border-color: var(--error-color); }

  .tx {
    width: 100%;
    box-sizing: border-box;
    height: 40px;
    padding: 0 11px;
    border-radius: 12px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 14px;
  }
  .tx::placeholder { color: var(--secondary-text-color); opacity: .5; }
  .tx:focus { border-color: var(--primary-color); }
  input.tx[type="number"] { font-variant-numeric: tabular-nums; }
  /* Un nombre porte son unite a droite, hors de la boite : dedans, elle se
     ferait effacer par la premiere frappe. */
  .unit { display: flex; align-items: center; gap: 9px; }
  .unit .tx { flex: 1; min-width: 0; text-align: right; }
  .unit .u { flex: 0 0 auto; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); }

  /* ---- les bonds d'un compteur ----

     Un compteur ne se corrige pas d'un kilometre, il se releve de plusieurs
     centaines. Les fleches du champ avancent d'un pas a la fois, ce qui est
     juste pour un ajustement et absurde pour un releve : ces boutons donnent
     les bonds qu'on fait vraiment, et le champ reste libre pour la valeur
     exacte lue au tableau de bord. */
  .quick { display: flex; gap: 7px; margin-top: 9px; }
  .quick .qk {
    flex: 1 1 0;
    min-width: 0;
    height: 34px;
    border: 1px solid var(--divider-color);
    border-radius: 999px;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .quick .qk:hover { border-color: var(--primary-color); }

  /* ---- le choix, en pastilles ----

     Trois saisons, deux quantites, deux essieux : des listes de deux ou trois
     entrees, toutes visibles. La pastille porte l'icone et la teinte que ce
     meme choix aura partout ailleurs sur la carte — sur la pastille de plan,
     dans la liste, dans l'en-tete. C'est la que le formulaire cesse d'etre un
     formulaire : on ne lit pas « hiver », on reconnait le flocon bleu. */
  .seg { display: flex; gap: 7px; }
  .seg .opt {
    flex: 1 1 0;
    min-width: 0;
    min-height: 54px;
    padding: 8px 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 1px solid var(--divider-color);
    border-radius: 12px;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.2;
    text-align: center;
    cursor: pointer;
    --mdc-icon-size: 19px;
  }
  .seg .opt .sub { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); }
  .seg .opt:hover { border-color: var(--pick, var(--tint)); }
  /* Le choix retenu ne tient pas qu'a la couleur : le double liseré le donne
     aussi a qui ne distingue pas le bleu du vert. */
  .seg .opt[aria-pressed="true"] {
    border-color: var(--pick, var(--tint));
    box-shadow: inset 0 0 0 1px var(--pick, var(--tint));
    background: color-mix(in srgb, var(--pick, var(--tint)) 13%, transparent);
    /* Le liseré porte la teinte pleine, le texte non : sur un fond a 13 % de
       la meme couleur, l'ambre du jeu d'ete ne se lirait pas. */
    color: color-mix(in srgb, var(--pick, var(--tint)) 50%, var(--primary-text-color));
  }
  .seg .opt[aria-pressed="true"] .sub { color: inherit; opacity: .8; }

  /* ---- les groupes ---- */
  .grp + .grp { margin-top: 16px; padding-top: 15px; border-top: 1px solid var(--divider-color); }
  .grp .gt {
    margin-bottom: 12px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .6px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .grp .gd { margin: -7px 0 12px; font-size: 12px; line-height: 1.45; color: var(--secondary-text-color); }
  /* Un groupe qui defait quelque chose ailleurs. Il ne se cache pas dans un
     pli et ne se confond pas avec le reste du formulaire : ce qu'on y repond
     depose un train. */
  .grp.warn {
    margin-top: 16px;
    padding: 13px;
    border: 1px solid rgba(255, 167, 38, .35);
    border-radius: 12px;
    background: rgba(255, 167, 38, .10);
  }

  /* ---- ce qu'on ne remplit pas toujours ----
     Cinq champs facultatifs sur neuf. Les montrer d'entree fait un mur ou
     rien ne se detache ; les cacher les rendrait introuvables. Un pli, donc,
     qui dit ce qu'il contient plutot que « Options ». */
  .fold { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--divider-color); }
  .fold > summary {
    display: flex;
    align-items: center;
    gap: 5px;
    list-style: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-color);
  }
  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary ha-icon { --mdc-icon-size: 18px; transition: transform 140ms ease; }
  .fold[open] > summary ha-icon { transform: rotate(90deg); }
  .fold .fset { margin-top: 15px; }

  /* ---- le plan de la voiture ----

     Les capteurs s'attachent la ou les pressions se lisent : meme grille,
     meme ordre, avant en haut. La liste « Avant gauche / Avant droit / … »
     demandait de relire l'etiquette a chaque ligne pour savoir de quelle roue
     on parlait, alors que la disposition le dit toute seule. */
  .car {
    position: relative;
    margin-top: 8px;
    padding: 16px 13px 13px;
    border: 1px solid var(--divider-color);
    border-radius: 16px;
  }
  .car::before {
    /* Le mot vient de l'element : un contenu CSS fige ne parle qu'une langue. */
    content: attr(data-front);
    position: absolute;
    top: -7px;
    left: 15px;
    padding: 0 6px;
    background: var(--ha-card-background, var(--card-background-color));
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .7px;
    color: var(--secondary-text-color);
  }
  .car .axles { display: grid; grid-template-columns: 1fr 1fr; gap: 13px 10px; }
  .car .slot { min-width: 0; }
  .car .slot .cn {
    margin-bottom: 5px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .5px;
    color: var(--secondary-text-color);
  }
  .car ha-selector { display: block; }
  /* Un essieu entier, quand c'est lui qu'on designe et non une roue. */
  .car .half {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px;
    border: 1px solid var(--divider-color);
    border-radius: 12px;
    background: var(--card-background-color);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    --mdc-icon-size: 20px;
  }
  .car .half ha-icon { flex: 0 0 auto; color: var(--secondary-text-color); }
  .car .half .hw { flex: 1; min-width: 0; }
  .car .half .hn { font-size: 13px; font-weight: 500; }
  .car .half .hs { margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--secondary-text-color); }
  .car .half[aria-pressed="true"] {
    border-color: var(--tint);
    box-shadow: inset 0 0 0 1px var(--tint);
    background: color-mix(in srgb, var(--tint) 12%, transparent);
  }
  .car .half[aria-pressed="true"] ha-icon { color: var(--tint-ink); }

  /* ---- deux relevés qui se contredisent ----
     Les deux chiffres cote a cote : c'est leur ecart qui fait la decision, et
     une case a cocher ne le montre pas. */
  .versus { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 2px 0 14px; }
  .versus .fig { padding: 12px; border-radius: 12px; background: var(--secondary-background-color); }
  .versus .fig .k {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .5px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .versus .fig .v { margin-top: 5px; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .versus .fig .w {
    margin-top: 3px;
    font-size: 11px;
    color: var(--secondary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wait { font-size: 13px; color: var(--secondary-text-color); }

  .empty { padding: 4px 16px 12px; font-size: 13px; color: var(--secondary-text-color); }

  /* ---- quand la colonne se resserre ----

     Une carte se pose sur 1 a 12 colonnes dans une vue « sections ». Sa
     largeur n'a donc aucun rapport avec celle de la fenetre, et une requete
     de media mesurerait la mauvaise chose : c'est la carte qui se mesure.

     En dessous de 340 px, les grilles a deux colonnes n'ont plus la place de
     l'etre — deux en-tetes de 27 px cote a cote se partageaient une centaine
     de pixels chacun. Elles se deplient, et le kilometrage d'une ligne passe
     sous son nom au lieu de lutter pour la meme rangee. */
  /* \`container-type\` pose aussi \`contain: layout\`, ce qui fait de la carte un
     bloc conteneur pour tout descendant en position fixe. La feuille aurait
     donc ete rognee ici meme — elle ne l'est pas, parce qu'elle a d'abord
     demenage dans le portail. C'est ce demenagement qui rend cette ligne
     possible, et non l'inverse. */
  ha-card { container-type: inline-size; }
  @container (max-width: 340px) {
    /* Le filet entre les deux en-tetes vient du \`gap\` sur fond de \`.heroes\` :
       il suit le pli tout seul, en horizontal comme en vertical. */
    .heroes { grid-template-columns: 1fr; }
    .tpms { grid-template-columns: 1fr; }
    .km { font-size: 22px; }
    .hero .mark { width: 36px; height: 36px; --mdc-icon-size: 20px; }
    .row { grid-template-columns: 30px 1fr; }
    .row .val {
      grid-column: 2;
      margin-top: 2px;
      text-align: left;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px 8px;
    }
    .row .state { display: inline; }
    .row .pill { margin-top: 0; }
    .row .bar { grid-column: 2 / 3; }
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) { .row { transition: none; } }
`;

/* ---------- le flux, conduit sans etre montre ---------- */

/** Le chemin REST du flux d'options : celui du bouton « Configurer ». */
const FLOW_PATH = "config/config_entries/options/flow";

/** Un mot dans le bandeau de HA : c'est la que l'interface met deja ses accuses. */
function notify(el, message) {
  el.dispatchEvent(
    new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true })
  );
}

/**
 * Rend `ha-form` et `ha-selector` disponibles hors editeur.
 *
 * Les composants existent dans le frontend, mais leur morceau de code n'est
 * charge que lorsqu'une carte ouvre son editeur. On demande donc a HA de
 * fabriquer l'editeur d'une carte du coeur, ce qui les tire avec lui. Sans
 * cela, `document.createElement("ha-selector")` rendrait une boite vide.
 *
 * `ha-selector` est le seul controle de HA que la carte garde : choisir une
 * entite parmi deux mille demande une recherche, un filtre par domaine et un
 * apercu de l'etat. Le reconstruire serait le refaire moins bien, et l'usager
 * le connait deja — c'est le meme selecteur que partout ailleurs chez lui.
 */
let formLoading = null;
function loadHaForm() {
  if (customElements.get("ha-form")) return Promise.resolve();
  if (!formLoading) {
    formLoading = (async () => {
      const helpers = await window.loadCardHelpers?.();
      const card = await helpers?.createCardElement?.({ type: "entities", entities: [] });
      await card?.constructor?.getConfigElement?.();
    })().catch(() => {});
  }
  return formLoading;
}

/**
 * Les valeurs de depart d'un formulaire de flux.
 *
 * Le schema les porte deja : `default` pour ce que le flux impose,
 * `description.suggested_value` pour ce qu'il propose. `ha-form` n'invente
 * rien de lui-meme, c'est a l'appelant de lui remettre cet etat initial.
 */
function initialFlowData(schema) {
  const data = {};
  for (const field of schema ?? []) {
    const suggested = field.description?.suggested_value;
    if (suggested !== undefined && suggested !== null) data[field.name] = suggested;
    else if (field.default !== undefined) data[field.name] = field.default;
  }
  return data;
}

/**
 * Le markdown des descriptions du flux, rendu dans un element donne.
 *
 * Le dialogue natif de Home Assistant passe ces textes a `ha-markdown` : ce
 * qu'ils contiennent est donc du markdown, et l'afficher en `textContent`
 * montrerait les etoiles et les tirets. On n'en rend que ce que le flux
 * emploie — paragraphes, listes a puces, gras — parce qu'un moteur complet
 * pour trois marques serait une dependance de plus a suivre.
 *
 * Tout passe par des noeuds de texte : rien de ce qui vient du flux n'est
 * jamais interprete comme du balisage, meme si une reference de pneu se met
 * un jour a contenir des chevrons.
 */
function renderMarkdown(source, into) {
  const bold = (text, parent) => {
    // Les segments impairs sont ceux entre deux paires d'etoiles.
    text.split(/\*\*/).forEach((part, i) => {
      if (!part) return;
      if (i % 2) {
        const strong = document.createElement("strong");
        strong.textContent = part;
        parent.appendChild(strong);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  };

  for (const block of String(source).split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim());
    if (!lines.length) continue;

    if (lines.every((line) => /^\s*-\s+/.test(line))) {
      const ul = document.createElement("ul");
      for (const line of lines) {
        const li = document.createElement("li");
        bold(line.replace(/^\s*-\s+/, ""), li);
        ul.appendChild(li);
      }
      into.appendChild(ul);
      continue;
    }

    const p = document.createElement("p");
    bold(lines.join(" "), p);
    into.appendChild(p);
  }
}

/** Ce qu'un appel REST rate a dire de lui-meme. */
function flowError(err) {
  if (!err) return t("card.unknown_error");
  if (typeof err === "string") return err;
  return err.body?.message || err.message || err.error || t("card.unknown_error");
}

/**
 * Le flux d'options du vehicule, conduit par la carte — et jamais montre.
 *
 * Home Assistant expose en REST le meme flux que la page de l'integration
 * ouvre en dialogue : `POST config/config_entries/options/flow` avec
 * l'`entry_id` du vehicule. La carte le conduit donc elle-meme, mais elle
 * n'en affiche pas les ecrans : elle lit le schema d'un pas pour savoir quoi
 * demander et avec quelles valeurs de depart, dessine ses propres champs, et
 * reposte ce qui a ete saisi sous les memes noms.
 *
 * Ce qu'on y gagne est la coherence — un formulaire de la carte ressemble a
 * la carte. Ce qu'on ne perd pas est la regle : ce qu'un code DOT peut valoir,
 * ce qu'un essieu deja occupe interdit, ce qu'un compteur qui recule impose,
 * tout cela reste ecrit une seule fois, en Python, et sert aussi bien
 * Parametres que la carte. Une erreur revient par `errors`, a un nom de champ,
 * et se pose sous le bon champ sans que la carte sache ce qu'elle raconte.
 *
 * `path` enchaine sans les afficher les pas qui menent la ou l'on voulait
 * aller : le menu du flux, puis le choix du train. Trois ecrans traverses pour
 * arriver a « modifier la fiche », ce qui a du sens depuis Parametres — on y
 * arrive sans savoir ce qu'on cherche — et aucun depuis une ligne de la carte,
 * ou le train a deja ete designe du doigt.
 */
class Flow {
  #hass;
  #entryId;
  #id = null;
  #step = null;

  constructor(hass, entryId) {
    this.#hass = hass;
    this.#entryId = entryId;
  }

  set hass(hass) {
    this.#hass = hass;
  }

  get hass() {
    return this.#hass;
  }

  get step() {
    return this.#step;
  }

  /** Une cle de traduction du flux, la ou le dialogue natif la lit. */
  t(key, placeholders) {
    return this.#hass?.localize?.(`component.${DOMAIN}.options.${key}`, placeholders);
  }

  /** Une option de liste : elles vivent sous `selector`, hors de l'arbre du flux. */
  option(key) {
    return this.#hass?.localize?.(`component.${DOMAIN}.selector.${key}`);
  }

  /** Ouvre le flux et descend jusqu'au pas vise. */
  async open(path = []) {
    await loadHaForm();
    // Les libelles du flux vivent du cote serveur : sans ce chargement, les
    // cles s'afficheraient telles quelles.
    await Promise.all([
      this.#hass.loadBackendTranslation?.("options", DOMAIN),
      this.#hass.loadBackendTranslation?.("selector", DOMAIN),
    ]).catch(() => {});

    this.#step = await this.#hass.callApi("POST", FLOW_PATH, { handler: this.#entryId });
    this.#id = this.#step?.flow_id ?? null;

    for (const payload of path) {
      if (!this.#id || this.ended) break;
      await this.send(payload);
    }
    return this.#step;
  }

  async send(payload) {
    if (!this.#id) return this.#step;
    this.#step = await this.#hass.callApi("POST", `${FLOW_PATH}/${this.#id}`, payload);
    if (this.ended) this.#id = null;
    return this.#step;
  }

  get ended() {
    return this.#step?.type === "create_entry" || this.#step?.type === "abort";
  }

  /**
   * Le mot de la fin. Un abandon en porte un — « Train monté », « Ce train
   * n'existe plus » — et c'est celui du flux qu'on repete, pas un nouveau :
   * deux facons de dire la meme chose finissent par ne plus dire la meme.
   */
  get outcome() {
    if (this.#step?.type === "abort") {
      return (
        this.t(`abort.${this.#step.reason}`, this.#step.description_placeholders) ||
        this.#step.reason
      );
    }
    return null;
  }

  /**
   * Abandonne. Un flux laisse ouvert le reste pour tout le monde et
   * ressortirait au rechargement de la page.
   */
  cancel() {
    const id = this.#id;
    this.#id = null;
    if (id) this.#hass.callApi("DELETE", `${FLOW_PATH}/${id}`).catch(() => {});
  }
}

/* ---------- les controles de saisie ---------- */

/** Le cadre d'un champ : son nom au-dessus, son aide ou son refus en dessous. */
function frame({ label, optional, helper, error }, control) {
  const el = document.createElement("div");
  el.className = "fld2" + (error ? " wrong" : "");

  if (label) {
    const lb = document.createElement("label");
    lb.className = "lb";
    lb.textContent = label;
    if (optional) {
      const tag = document.createElement("span");
      tag.className = "opt";
      tag.textContent = t("field.optional");
      lb.appendChild(tag);
    }
    el.appendChild(lb);
    // Le nom pointe le controle plutot que de l'envelopper : `ha-selector` est
    // un composant a lui, et un clic sur son etiquette doit ouvrir sa liste.
    // `aria-labelledby` double le lien pour ce qui n'est pas un champ au sens
    // du HTML — un groupe de pastilles, que `for` ne sait pas designer.
    const id = `f-${Math.random().toString(36).slice(2, 9)}`;
    control.id = id;
    lb.htmlFor = id;
    lb.id = `${id}-lb`;
    control.setAttribute("aria-labelledby", lb.id);
  }

  el.appendChild(control);

  if (error) {
    const no = document.createElement("div");
    no.className = "no";
    no.textContent = error;
    el.appendChild(no);
  } else if (helper) {
    const hp = document.createElement("div");
    hp.className = "hp";
    hp.textContent = helper;
    el.appendChild(hp);
  }
  return el;
}

/** Une boite de texte. */
function textControl(value, { placeholder, onInput }) {
  const el = document.createElement("input");
  el.type = "text";
  el.className = "tx";
  el.value = value ?? "";
  if (placeholder) el.placeholder = placeholder;
  el.addEventListener("input", () => onInput(el.value));
  return el;
}

/**
 * Un nombre et son unite.
 *
 * Le pas des fleches vient du champ decrit, et non du navigateur : un
 * kilometrage se releve par centaines quand une pression se regle par
 * dixiemes, et le pas de un que suppose le navigateur ne convient qu'a la
 * seconde. Sans `step`, ce pas de un reste — c'est le bon defaut pour tout ce
 * qui se compte petit.
 */
function numberControl(value, { unit, step, onInput }) {
  const el = document.createElement("div");
  el.className = "unit";
  const input = document.createElement("input");
  input.type = "number";
  input.className = "tx";
  input.inputMode = "decimal";
  if (step) input.step = String(step);
  input.value = value === undefined || value === null ? "" : String(value);
  input.addEventListener("input", () => onInput(input.value === "" ? null : Number(input.value)));
  el.appendChild(input);
  if (unit) {
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = unit;
    el.appendChild(u);
  }
  // Le cadre pointe le champ, pas la boite qui le contient.
  Object.defineProperty(el, "id", {
    set: (id) => input.setAttribute("id", id),
    get: () => input.getAttribute("id"),
  });
  return el;
}

/**
 * Un choix en pastilles.
 *
 * Deux ou trois options, toutes visibles, chacune portant l'icone et la
 * teinte qu'elle aura partout ailleurs sur la carte. Un `radiogroup` et non
 * une suite de boutons : les fleches y naviguent, ce qu'une liste de boutons
 * ne fait pas, et un lecteur d'ecran annonce « 2 sur 3 ».
 */
function choiceControl(value, { options, onPick }) {
  const el = document.createElement("div");
  el.className = "seg";
  el.setAttribute("role", "radiogroup");

  // Les pastilles se marquent elles-memes avant de prevenir l'appelant : la
  // plupart des choix ne repeignent pas la feuille, et sans cela un clic sur
  // « Hiver » changeait la valeur sans que rien a l'ecran ne le dise.
  const buttons = [];
  const select = (picked, focus) => {
    buttons.forEach((button, i) => {
      const on = options[i].value === picked;
      button.setAttribute("aria-checked", String(on));
      button.setAttribute("aria-pressed", String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    });
    onPick(picked);
  };

  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "opt";
    button.setAttribute("role", "radio");
    const picked = option.value === value;
    button.setAttribute("aria-checked", String(picked));
    button.setAttribute("aria-pressed", String(picked));
    button.dataset.value = String(option.value);
    button.tabIndex = picked || (value === undefined && index === 0) ? 0 : -1;
    if (option.tint) button.style.setProperty("--pick", option.tint);

    if (option.icon) button.appendChild(makeIcon(option.icon));
    const label = document.createElement("span");
    label.textContent = option.label;
    button.appendChild(label);
    if (option.sub) {
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = option.sub;
      button.appendChild(sub);
    }

    button.addEventListener("click", () => select(option.value, false));
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = options[(index + step + options.length) % options.length];
      // Le focus suit la valeur : les fleches d'un radiogroup deplacent les
      // deux ensemble, et un focus reste sur l'ancienne pastille se perdrait
      // a la frappe suivante.
      select(next.value, true);
    });
    buttons.push(button);
    el.appendChild(button);
  });
  return el;
}

/** Le selecteur d'entite de Home Assistant, dans le cadre de la carte. */
function entityControl(value, { hass, selector, onPick, keep }) {
  const el = document.createElement("ha-selector");
  el.hass = hass;
  el.selector = selector ?? { entity: {} };
  el.value = value ?? undefined;
  el.addEventListener("value-changed", (event) => {
    event.stopPropagation();
    onPick(event.detail.value || null);
  });
  keep?.(el);
  return el;
}

/**
 * Ce que chaque champ du flux devient a l'ecran.
 *
 * Le flux dit *quoi* demander ; cette table dit *comment*. Le nom du champ
 * suffit a faire le lien — il est stable, il est le meme dans « add »,
 * « edit » et « duplicate », et c'est la seule chose que la carte ait besoin
 * de connaitre pour dessiner autre chose qu'une boite de texte.
 *
 * Les libelles n'y sont pas : ils viennent du flux, comme dans Parametres,
 * pour qu'un mot corrige le soit aux deux endroits. Les aides, si — mais
 * choisies. Le flux en ecrit une sous chacun de ses neuf champs, ce qui
 * convient a une page qu'on lit une fois ; sur une feuille, cela noie les
 * trois qui en avaient besoin. Le reste se dit mieux en exemple dans la boite,
 * la ou l'oeil est deja.
 *
 * Ce qui ne figure pas ici est rendu par `ha-form`, tel quel : un champ ajoute
 * un jour en Python apparaitra sans qu'on ait touche a la carte — moins beau,
 * mais present, ce qui vaut mieux qu'absent.
 *
 * Une fabrique, pas un objet : construite au chargement du module, la table
 * figeait chaque `t(...)` dans la langue devinee avant l'arrivee de `hass` —
 * exactement le piege que les accesseurs de `SEASONS` evitent plus haut. Elle
 * ne se lit qu'a la peinture, donc la reconstruire a ce moment-la ne coute
 * rien et parle toujours la langue du jour.
 */
const CONTROLS = () => ({
  reference: { kind: "text", placeholder: "Michelin CrossClimate 2" },
  season: {
    kind: "choice",
    options: Object.entries(SEASONS).map(([value, tone]) => ({
      value,
      label: tone.label,
      icon: tone.icon,
      tint: tone.tint,
    })),
  },
  axle: {
    kind: "choice",
    options: [
      { value: "all", label: t("axle.all"), icon: "mdi:numeric-4-box-outline" },
      { value: "pair", label: t("axle.pair"), sub: t("help.pair"), icon: "mdi:numeric-2-box-outline" },
    ],
    helper: t("help.pair_note"),
  },
  size: { kind: "text", placeholder: "225/45 R17" },
  dot: {
    kind: "text",
    placeholder: "3223",
    helper:
      t("help.dot"),
  },
  label: { kind: "text", placeholder: t("help.label") },
  price: {
    kind: "number",
    unit: "€",
    helper:
      t("help.price"),
  },
  storage: { kind: "text", placeholder: t("help.storage") },
  initial_total: {
    kind: "number",
    unit: "km",
    step: 10,
    helper: t("help.initial_total"),
  },
  odometer: { kind: "number", unit: "km", step: 10 },
  total: { kind: "number", unit: "km", step: 10 },
  vehicle: {
    kind: "text",
    placeholder: "Alfa GT",
    helper: t("help.vehicle"),
  },
  rotation_interval: {
    kind: "number",
    unit: "km",
    helper: t("help.rotation"),
  },
  odometer_entity: {
    kind: "entity",
    helper:
      t("help.odometer_entity"),
  },
  position: {
    kind: "choice",
    options: [
      { value: "front", label: POSITIONS.front },
      { value: "rear", label: POSITIONS.rear },
    ],
  },
  pair: {
    kind: "choice",
    options: [
      {
        value: "front",
        label: POSITIONS.front,
        sub: `${SHORT_SLOTS.front_left} + ${SHORT_SLOTS.front_right}`,
      },
      {
        value: "rear",
        label: POSITIONS.rear,
        sub: `${SHORT_SLOTS.rear_left} + ${SHORT_SLOTS.rear_right}`,
      },
    ],
  },
  /* Un booleen qu'on ne dessine pas en interrupteur : les deux reponses ne
     sont pas « faire » et « ne rien faire », ce sont deux suites differentes,
     et chacune merite d'etre lue avant d'etre choisie. */
  replace: {
    kind: "choice",
    label: t("help.replace"),
    boolean: true,
    rerender: true,
    options: [
      {
        value: true,
        label: t("help.replaced"),
        sub: t("help.replaced_note"),
        icon: "mdi:swap-horizontal",
      },
      {
        value: false,
        label: t("help.kept"),
        sub: t("help.kept_note"),
        icon: "mdi:garage-variant",
      },
    ],
  },
});

/* ---------- les ecrans ---------- */

/** L'identite d'un train, la ligne a laquelle l'oeil revient. */
function trainIdent(set, attrs) {
  const tone = look(set);
  const el = document.createElement("div");
  el.className = "tid";
  el.style.setProperty("--tint", tone.tint);

  const mark = document.createElement("div");
  mark.className = "mark";
  mark.appendChild(makeIcon(tone.icon));

  const txt = document.createElement("div");
  txt.className = "txt";
  const nm = document.createElement("div");
  nm.className = "nm";
  nm.textContent = nameOf(set);
  const st = document.createElement("div");
  st.className = "st";
  st.textContent = stateLine(set, attrs);
  txt.append(nm, st);

  el.append(mark, txt);
  return el;
}

/**
 * L'en-tete d'une feuille.
 *
 * Quand la feuille agit sur un train, c'est le train qui titre : « Modifier la
 * fiche » ne dit pas de quel train, et c'est la seule question qu'on se pose
 * en levant les yeux d'un formulaire a moitie rempli. Le titre passe alors en
 * sous-titre du groupe qu'il ouvre.
 */
function sheetHead({ title, set, attrs, onBack }) {
  const el = document.createElement("div");
  el.className = "shead";

  if (onBack) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "back";
    back.setAttribute("aria-label", t("act.back"));
    back.appendChild(makeIcon("mdi:chevron-left"));
    back.addEventListener("click", onBack);
    el.appendChild(back);
  }

  if (set) {
    el.appendChild(trainIdent(set, attrs));
  } else {
    const h = document.createElement("h2");
    h.textContent = title;
    el.appendChild(h);
  }
  return el;
}

/** Le pied : le geste a droite, l'abandon a sa gauche. */
function sheetFoot(buttons) {
  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  foot.append(...buttons);
  return foot;
}

function actButton(label, iconName, variant, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "act" + (variant ? ` ${variant}` : "");
  if (iconName) el.appendChild(makeIcon(iconName));
  el.appendChild(document.createTextNode(label));
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

/** Un verbe sans cadre, pour ce qui ne merite pas le relief d'un bouton. */
function linkButton(label, variant, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "lnk" + (variant ? ` ${variant}` : "");
  el.textContent = label;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

/**
 * Le plan de la voiture, une roue par emplacement.
 *
 * Sert a designer les capteurs. Un train de quatre a ses quatre coins ; une
 * paire n'a qu'une gauche et une droite, car l'essieu ou elle se trouve n'est
 * pas de sa fiche — il se decide au montage.
 */
function carSlots(ctx) {
  const el = document.createElement("div");
  el.className = "car";
  el.dataset.front = t("position.front").toUpperCase();
  const axles = document.createElement("div");
  axles.className = "axles";

  for (const entry of ctx.step.data_schema ?? []) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const cn = document.createElement("div");
    cn.className = "cn";
    cn.textContent = SHORT_SLOTS[entry.name] ?? entry.name;
    slot.appendChild(cn);
    slot.appendChild(
      entityControl(ctx.data[entry.name], {
        hass: ctx.flow.hass,
        selector: entry.selector,
        onPick: (value) => ctx.set(entry.name, value),
        keep: ctx.keep,
      })
    );
    axles.appendChild(slot);
  }

  el.appendChild(axles);
  return el;
}

/**
 * Le plan de la voiture, un essieu a designer.
 *
 * Separer un train de quatre, c'est dire quelle moitie part vivre sa vie. Deux
 * bandes plutot qu'une liste deroulante : la moitie choisie et celle qui reste
 * disent chacune ce qu'elle devient, et on les lit d'un coup.
 */
function carHalves(ctx) {
  const el = document.createElement("div");
  el.className = "car";
  el.dataset.field = "pair";
  el.dataset.front = t("position.front").toUpperCase();
  const axles = document.createElement("div");
  axles.className = "axles";

  const corners = {
    front: `${SHORT_SLOTS.front_left} + ${SHORT_SLOTS.front_right}`,
    rear: `${SHORT_SLOTS.rear_left} + ${SHORT_SLOTS.rear_right}`,
  };
  for (const axis of AXES) {
    const picked = ctx.data.pair === axis;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "half";
    button.setAttribute("aria-pressed", String(picked));
    button.appendChild(
      makeIcon(picked ? "mdi:call-split" : "mdi:checkbox-blank-circle-outline")
    );

    const hw = document.createElement("div");
    hw.className = "hw";
    const hn = document.createElement("div");
    hn.className = "hn";
    hn.textContent = `${POSITIONS[axis]} — ${corners[axis]}`;
    const hs = document.createElement("div");
    hs.className = "hs";
    hs.textContent = picked
      ? t("help.pair_new")
      : t("help.pair_kept");
    hw.append(hn, hs);

    button.appendChild(hw);
    button.addEventListener("click", () => ctx.set("pair", axis, true));
    axles.appendChild(button);
  }

  el.appendChild(axles);
  return el;
}

/**
 * Deux relevés qui se contredisent.
 *
 * Le flux pose la question en case a cocher, ce qui laisse a lire trois
 * paragraphes pour comprendre ce qui se decide. Les deux chiffres cote a cote
 * la posent d'eux-memes : c'est leur ecart qui fait la decision.
 */
function versus(ctx) {
  const el = document.createElement("div");
  const ph = ctx.step.description_placeholders ?? {};

  const grid = document.createElement("div");
  grid.className = "versus";
  const fig = (key, value, who) => {
    const box = document.createElement("div");
    box.className = "fig";
    const k = document.createElement("div");
    k.className = "k";
    k.textContent = key;
    const v = document.createElement("div");
    v.className = "v";
    v.textContent = `${value} km`;
    const w = document.createElement("div");
    w.className = "w";
    w.textContent = who;
    w.title = who;
    box.append(k, v, w);
    return box;
  };
  grid.append(
    fig(t("resync.sensor"), ph.reading ?? "—", ph.entity ?? ""),
    fig(t("resync.tracking"), ph.tracked ?? "—", t("help.tracked_so_far"))
  );
  el.appendChild(grid);

  const say = document.createElement("div");
  say.className = "desc";
  const p = document.createElement("p");
  p.append(
    document.createTextNode(t("resync.no_back") + " "),
    bold(t("resync.stuck")),
    document.createTextNode(t("resync.forever", { tracked: ph.tracked ?? "—" }))
  );
  const q = document.createElement("p");
  q.textContent =
    t("resync.explain", {
      tracked: ph.tracked ?? "—",
      reading: ph.reading ?? "—",
    });
  say.append(p, q);
  el.appendChild(say);
  return el;
}

/**
 * Ce que chaque pas du flux devient comme ecran.
 *
 * Un pas absent de cette table garde le rendu `ha-form` : c'est le filet, et
 * il tient tout seul.
 *
 * Une fabrique, pour la meme raison que `CONTROLS` : un titre fige au
 * chargement resterait dans la langue devinee avant `hass`.
 */
const LAYOUTS = () => ({
  add: {
    title: t("sheet.new_set"),
    lede: t("sheet.new_set_note"),
    verb: t("act.add_the_set"),
    groups: [
      { fields: ["reference", "season", "axle"] },
      {
        fold: t("sheet.more_fields"),
        fields: ["size", "dot", "label", "price", "storage", "initial_total"],
      },
    ],
  },
  edit: {
    title: t("sheet.edit"),
    lede: t("sheet.edit_note"),
    verb: t("act.save"),
    groups: [
      { fields: ["reference", "season", "axle"] },
      {
        fold: t("sheet.more_fields"),
        fields: ["size", "dot", "label", "price", "storage"],
      },
    ],
  },
  duplicate: {
    title: t("sheet.duplicate"),
    lede: t("sheet.duplicate_note"),
    verb: t("act.create_copy"),
    groups: [
      { fields: ["reference", "season", "axle", "label"] },
      {
        fold: t("sheet.more_fields"),
        fields: ["size", "dot", "price", "storage", "initial_total"],
      },
      {
        title: t("sheet.on_the_car"),
        warn: true,
        // Le groupe n'existe que si le flux propose « replace » — donc
        // seulement quand l'original est monte. Ailleurs, il n'y a rien a
        // remplacer et la question ne se pose pas.
        fields: ["replace", { name: "odometer", when: (data) => data.replace !== false }],
      },
    ],
  },
  tpms: {
    title: t("sheet.tpms"),
    lede: t("sheet.tpms_note"),
    verb: t("act.save"),
    body: carSlots,
    // Le plan porte tous les champs du pas, quels qu'ils soient : quatre coins
    // pour un train de 4, deux cotes pour une paire.
    consumes: "all",
  },
  separate: {
    title: t("sheet.separate"),
    lede: t("sheet.separate_note"),
    verb: t("act.separate"),
    body: carHalves,
    consumes: ["pair"],
    groups: [{ fields: ["label", "odometer"] }],
  },
  resync: {
    title: t("sheet.resync"),
    body: versus,
    consumes: ["resync"],
    /* Deux issues nommees, pas un « Valider » sur une case cochee : ce qu'on
       choisit ici solde un train, et un bouton doit dire ce qu'il fait. */
    foot: (ctx) => [
      actButton(t("act.keep_tracking"), null, "", () => ctx.submit({ resync: false })),
      actButton(t("act.take_sensor"), null, "primary", () => ctx.submit({ resync: true })),
    ],
  },
  vehicle: {
    title: t("group.vehicle"),
    verb: t("act.save"),
    groups: [{ fields: ["vehicle", "rotation_interval"] }],
  },
  odometer: {
    title: t("group.odometer_src"),
    verb: t("act.save"),
    groups: [{ fields: ["odometer_entity"] }],
  },
});

/**
 * Un champ, du schema du flux jusqu'au pixel.
 *
 * Le libelle vient du flux — le meme mot qu'a Parametres, corrige au meme
 * endroit ; le controle vient de `CONTROLS` ; le refus vient des erreurs que
 * le pas renvoie, traduit a la cle que Python a nommee. La carte n'invente
 * rien de tout cela : elle le met en forme.
 */
function renderField(entry, { data, errors, stepId, flow, onSet, keep }) {
  const name = entry.name;
  const spec = CONTROLS()[name] ?? { kind: "text" };
  const value = data[name];
  const errorKey = errors?.[name];

  const meta = {
    label: spec.label || flow.t(`step.${stepId}.data.${name}`) || name,
    // « facultatif » se dit sur les boites a remplir, jamais sur un choix : une
    // pastille porte deja une reponse, et rien ne s'y laisse vide.
    optional: entry.required === false && spec.kind !== "choice",
    helper: spec.helper,
    error: errorKey ? flow.t(`error.${errorKey}`) || errorKey : null,
  };

  let control;
  if (spec.kind === "choice") {
    control = choiceControl(value, {
      options: spec.options,
      onPick: (picked) => onSet(name, picked, Boolean(spec.rerender)),
    });
  } else if (spec.kind === "number") {
    control = numberControl(value, {
      unit: spec.unit,
      step: spec.step,
      onInput: (v) => onSet(name, v),
    });
  } else if (spec.kind === "entity") {
    control = entityControl(value, {
      hass: flow.hass,
      selector: entry.selector,
      onPick: (v) => onSet(name, v),
      keep,
    });
  } else {
    control = textControl(value, {
      placeholder: spec.placeholder,
      onInput: (v) => onSet(name, v),
    });
  }

  const el = frame(meta, control);
  el.dataset.field = name;
  return el;
}

/**
 * Un ecran de saisie de la carte, adosse a un pas du flux.
 *
 * Il suit le flux plutot que de le conduire : ce que le pas courant demande
 * decide de ce qui se dessine. Choisir une source de compteur qui recule
 * renvoie le pas « resync », et l'ecran devient l'ecran de « resync » sans que
 * personne ait eu a l'orchestrer.
 */
class FormScreen {
  live = false;

  #card;
  #flow;
  #path;
  #done;
  #ident;
  #title;
  #data = {};
  #error = null;
  #busy = false;
  #stepId = null;
  #selectors = [];
  /** Le champ qui vient d'etre touche, pour lui rendre le clavier apres coup. */
  #focus = null;
  /** Derniere poussee de `hass` transmise aux controles — voir `onHass`. */
  #pushed = 0;

  constructor(card, { flow, path = [], done = null, ident = null, onDone = null, title = null }) {
    this.#card = card;
    this.#flow = flow;
    this.#path = path;
    this.#done = done;
    this.#ident = ident;
    this.#title = title;
    this.onDone = onDone;
    this.key = `form:${path.map((p) => JSON.stringify(p)).join(">")}`;
  }

  onHass(hass) {
    this.#flow.hass = hass;
    // Au plus une fois par seconde : `hass` est reaffecte a chaque changement
    // d'etat de toute la maison, et chaque affectation fait re-rendre les
    // `ha-form`/`ha-selector` ouverts. Un selecteur d'entite vieux d'une
    // seconde reste juste ; une feuille qui se re-rend en continu ne l'est pas.
    const now = Date.now();
    if (now - this.#pushed < 1000) return;
    this.#pushed = now;
    for (const selector of this.#selectors) selector.hass = hass;
  }

  /** Ouvre le flux, descend jusqu'au pas vise, et se peint. */
  async open() {
    try {
      // Un flux deja ouvert est repris ou il en est : c'est ainsi qu'un pas
      // inattendu — « resync », quand deux relevés se contredisent — devient
      // un ecran sans qu'on ait a rejouer le chemin depuis la racine.
      if (!this.#flow.step) await this.#flow.open(this.#path);
    } catch (err) {
      this.#card.dropScreen(this, flowError(err));
      return;
    }
    if (this.#flow.ended) {
      this.#card.dropScreen(this, this.#flow.outcome);
      return;
    }
    this.#adopt();
    this.#card.repaintSheet(true);
  }

  /** Repart des valeurs du pas courant, quand c'en est un nouveau. */
  #adopt() {
    const step = this.#flow.step;
    if (step?.step_id === this.#stepId) return;
    this.#stepId = step?.step_id ?? null;
    this.#data = initialFlowData(step?.data_schema);
  }

  get #layout() {
    return LAYOUTS()[this.#stepId] ?? null;
  }

  /** Le contexte que les corps sur mesure recoivent. */
  #ctx() {
    return {
      step: this.#flow.step,
      flow: this.#flow,
      data: this.#data,
      set: (name, value, repaint = false) => this.#set(name, value, repaint),
      keep: (el) => this.#selectors.push(el),
      submit: (payload) => this.#submit(payload),
    };
  }

  #set(name, value, repaint) {
    this.#data = { ...this.#data, [name]: value };
    if (!repaint) return;
    this.#focus = name;
    this.#card.repaintSheet(true);
  }

  paint(sheet) {
    const step = this.#flow.step;
    const layout = this.#layout;
    this.#selectors = [];

    // Le formulaire d'un train prend sa teinte : les pastilles de choix, la
    // moitie designee sur le plan et le bouton du geste s'y accordent, et l'on
    // reste dans le meme jeu de pneus d'un ecran a l'autre.
    if (this.#ident?.set) {
      const tone = look(this.#ident.set);
      sheet.style.setProperty("--tint", tone.tint);
    }

    sheet.appendChild(
      sheetHead({
        title:
          layout?.title ||
          this.#title ||
          this.#flow.t(`step.${this.#stepId}.title`) ||
          t("act.settings"),
        set: this.#ident?.set ?? null,
        attrs: this.#ident?.attrs ?? {},
        onBack: this.#card.stackDepth > 1 ? () => this.#card.dropScreen(this) : null,
      })
    );

    if (!step) {
      const wait = document.createElement("p");
      wait.className = "wait";
      wait.textContent = t("card.opening");
      sheet.appendChild(wait);
      return;
    }

    // Le titre passe en sous-titre quand l'en-tete est pris par le train.
    if (this.#ident?.set && (layout?.title || this.#title)) {
      const h = document.createElement("h2");
      h.textContent = layout?.title || this.#title;
      h.style.marginBottom = "6px";
      sheet.appendChild(h);
    }

    if (layout?.lede) {
      const lede = document.createElement("div");
      lede.className = "desc";
      const p = document.createElement("p");
      p.textContent = layout.lede;
      lede.appendChild(p);
      sheet.appendChild(lede);
    }

    if (this.#error) {
      const err = document.createElement("div");
      err.className = "err";
      err.textContent = this.#error;
      sheet.appendChild(err);
    }

    if (!layout) {
      this.#paintFallback(sheet, step);
      return;
    }

    const ctx = this.#ctx();
    if (layout.body) sheet.appendChild(layout.body(ctx));

    const drawn = new Set();
    for (const group of layout.groups ?? []) {
      const el = this.#paintGroup(group, step, drawn);
      if (el) sheet.appendChild(el);
    }

    // Ce que le flux demande et que la carte ne sait pas dessiner. Rien
    // aujourd'hui — et c'est bien pour cela qu'il faut que ce soit ecrit : le
    // jour ou Python gagne un champ, il apparait ici sans qu'on y touche.
    const eaten = (name) =>
      drawn.has(name) ||
      layout.consumes === "all" ||
      (Array.isArray(layout.consumes) && layout.consumes.includes(name));
    const rest = (step.data_schema ?? []).filter((entry) => !eaten(entry.name));
    if (rest.length) sheet.appendChild(this.#haForm(step, rest));

    const cancel = actButton(t("act.cancel"), null, "", () => this.#card.dropScreen(this));
    const foot = layout.foot
      ? sheetFoot([cancel, ...layout.foot(ctx)])
      : sheetFoot([
          cancel,
          this.#verb(layout.verb || t("act.confirm")),
        ]);
    sheet.appendChild(foot);

    this.#restoreFocus(sheet);
  }

  #verb(label) {
    const button = actButton(label, null, "primary", () => this.#submit(this.#payload()));
    if (this.#busy) button.disabled = true;
    return button;
  }

  #paintGroup(group, step, drawn) {
    const entries = [];
    for (const item of group.fields ?? []) {
      const name = typeof item === "string" ? item : item.name;
      const entry = (step.data_schema ?? []).find((field) => field.name === name);
      // Un champ que le flux n'offre pas a ce pas-la n'est pas dessine :
      // « replace » n'existe que pour un original monte, et l'inventer
      // proposerait de remplacer ce qui n'est pas sur la voiture.
      if (!entry) continue;
      drawn.add(name);
      if (typeof item !== "string" && item.when && !item.when(this.#data)) continue;
      entries.push(entry);
    }
    if (!entries.length) return null;

    const build = () => {
      const set = document.createElement("div");
      set.className = "fset";
      for (const entry of entries) set.appendChild(this.#paintField(entry, step));
      return set;
    };

    if (group.fold) {
      const details = document.createElement("details");
      details.className = "fold";
      const summary = document.createElement("summary");
      summary.appendChild(makeIcon("mdi:chevron-right"));
      summary.appendChild(document.createTextNode(group.fold));
      details.appendChild(summary);
      details.appendChild(build());
      // Un champ rempli ne se cache pas : on ouvre le pli s'il porte deja
      // quelque chose, sinon on modifierait une fiche a moitie sans le voir.
      // Zero ne compte pas — « distance déjà parcourue » vaut zero sur toute
      // fiche neuve, et le pli s'ouvrirait toujours pour ne rien montrer.
      if (entries.some((entry) => filled(this.#data[entry.name]) && this.#data[entry.name] !== 0)) {
        details.open = true;
      }
      return details;
    }

    const el = document.createElement("div");
    el.className = "grp" + (group.warn ? " warn" : "");
    if (group.title) {
      const gt = document.createElement("div");
      gt.className = "gt";
      gt.textContent = group.title;
      el.appendChild(gt);
    }
    if (group.note) {
      const gd = document.createElement("div");
      gd.className = "gd";
      gd.textContent = group.note(step);
      el.appendChild(gd);
    }
    el.appendChild(build());
    return el;
  }

  #paintField(entry, step) {
    return renderField(entry, {
      data: this.#data,
      errors: step.errors,
      stepId: step.step_id,
      flow: this.#flow,
      onSet: (name, value, repaint) => this.#set(name, value, repaint),
      keep: (el) => this.#selectors.push(el),
    });
  }

  /** Le filet : le schema tel quel, rendu par Home Assistant. */
  #haForm(step, schema) {
    const form = document.createElement("ha-form");
    form.hass = this.#flow.hass;
    form.schema = schema;
    form.data = this.#data;
    form.error = step.errors ?? undefined;
    form.computeLabel = (f) => this.#flow.t(`step.${step.step_id}.data.${f.name}`) || f.name;
    form.computeHelper = (f) =>
      this.#flow.t(`step.${step.step_id}.data_description.${f.name}`) || "";
    form.computeError = (error) => this.#flow.t(`error.${error}`) || error;
    form.localizeValue = (key) => this.#flow.option(key);
    form.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      this.#data = { ...this.#data, ...event.detail.value };
    });
    this.#selectors.push(form);
    return form;
  }

  #paintFallback(sheet, step) {
    const description = this.#flow.t(
      `step.${step.step_id}.description`,
      step.description_placeholders
    );
    if (description) {
      const box = document.createElement("div");
      box.className = "desc";
      renderMarkdown(description, box);
      sheet.appendChild(box);
    }

    if (step.type === "menu") {
      const list = Array.isArray(step.menu_options)
        ? step.menu_options
        : Object.keys(step.menu_options ?? {});
      const menu = document.createElement("div");
      menu.className = "menu";
      for (const option of list) {
        const label =
          this.#flow.t(`step.${step.step_id}.menu_options.${option}`) ||
          (Array.isArray(step.menu_options) ? option : step.menu_options[option]);
        menu.appendChild(
          actButton(label, null, "", () => this.#submit({ next_step_id: option }))
        );
      }
      sheet.appendChild(menu);
      sheet.appendChild(
        sheetFoot([actButton(t("act.cancel"), null, "", () => this.#card.dropScreen(this))])
      );
      return;
    }

    sheet.appendChild(this.#haForm(step, step.data_schema ?? []));
    sheet.appendChild(
      sheetFoot([
        actButton(t("act.cancel"), null, "", () => this.#card.dropScreen(this)),
        this.#verb(t("act.confirm")),
      ])
    );
  }

  /**
   * Ce qui part au flux.
   *
   * Un champ vide n'est pas envoye vide : `vol.Optional` sans valeur laisse le
   * flux decider, et c'est lui qui sait si l'absence efface ou conserve. Un
   * champ requis part toujours, meme vide — c'est ainsi que « Donnez un nom au
   * vehicule » revient plutot que rien.
   */
  #payload() {
    const schema = this.#flow.step?.data_schema ?? [];
    const out = {};
    for (const entry of schema) {
      const value = this.#data[entry.name];
      if (entry.required || filled(value)) out[entry.name] = value ?? "";
    }
    return out;
  }

  async #submit(payload) {
    if (this.#busy) return;
    this.#busy = true;
    this.#error = null;
    this.#card.repaintSheet(true);
    try {
      await this.#flow.send(payload);
    } catch (err) {
      this.#error = flowError(err);
      this.#busy = false;
      this.#card.repaintSheet(true);
      return;
    }
    this.#busy = false;

    if (this.#flow.ended) {
      this.#card.dropScreen(this, this.#flow.outcome ?? this.#done);
      this.onDone?.();
      return;
    }
    // Un pas qui revient avec des erreurs garde ce qui a ete tape : la
    // correction ne se fait pas sur un formulaire vide.
    this.#adopt();
    this.#card.repaintSheet(true);
  }

  /** Abandonne le flux si l'ecran se ferme avant sa fin. */
  leave() {
    this.#flow.cancel();
  }

  /**
   * Rend le clavier au champ qu'on venait de toucher.
   *
   * Une pastille cliquee repeint la feuille quand elle change ce qui s'affiche
   * — « remplacer le train monté » fait apparaitre le relevé. Sans cela, le
   * focus retomberait sur la feuille, et la touche Tab repartirait du haut.
   */
  #restoreFocus(sheet) {
    if (!this.#focus) return;
    // Le nom vient du schema du serveur : echappe, pour qu'un guillemet ne
    // casse pas le selecteur.
    const field = sheet.querySelector(`[data-field="${CSS.escape(this.#focus)}"]`);
    this.#focus = null;
    field?.querySelector('[aria-checked="true"], [aria-pressed="true"], input')?.focus();
  }
}

/** Vrai quand un champ porte quelque chose. Zero en est. */
const filled = (value) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

/**
 * Les reglages du vehicule, en un seul ecran.
 *
 * Le flux les separe en deux pas — le nom et le rappel de permutation d'un
 * cote, la source du compteur de l'autre — parce qu'un flux avance par pas et
 * qu'un pas est un enregistrement. Ce decoupage n'a pas de sens ici : ce sont
 * trois reponses sur la meme voiture, et le menu qui les separait demandait de
 * choisir laquelle avant meme de savoir ce qu'on voulait changer.
 *
 * L'ecran lit donc les deux schemas, les montre ensemble, et n'ecrit que ce
 * qui a bouge. Le compteur part le premier : c'est le seul des deux qui peut
 * poser une question de plus — deux relevés qui se contredisent — et le nom,
 * lui, recharge l'entree en s'enregistrant.
 */
class SettingsScreen {
  live = false;
  key = "settings";

  #card;
  #hass;
  #entryId;
  #schema = [];
  #data = {};
  #was = {};
  #ready = false;
  #busy = false;
  #error = null;
  #selectors = [];
  /** Derniere poussee de `hass` transmise aux controles — meme regle qu'en haut. */
  #pushed = 0;

  constructor(card, { hass, entryId }) {
    this.#card = card;
    this.#hass = hass;
    this.#entryId = entryId;
  }

  onHass(hass) {
    this.#hass = hass;
    const now = Date.now();
    if (now - this.#pushed < 1000) return;
    this.#pushed = now;
    for (const selector of this.#selectors) selector.hass = hass;
  }

  /**
   * Va chercher les deux schemas, l'un apres l'autre.
   *
   * L'un apres l'autre, et non ensemble : deux flux ouverts en meme temps sur
   * la meme entree n'ont aucune raison de bien se tenir, et rien ici ne presse.
   * Chacun est referme aussitot lu — on ne gardait ouvert que pour ecrire, et
   * l'ecriture viendra plus tard, avec ses propres flux.
   */
  async open() {
    try {
      for (const step of ["odometer", "vehicle"]) {
        const flow = new Flow(this.#hass, this.#entryId);
        await flow.open([{ next_step_id: step }]);
        for (const entry of flow.step?.data_schema ?? []) {
          this.#schema.push({ ...entry, step });
        }
        Object.assign(this.#data, initialFlowData(flow.step?.data_schema));
        flow.cancel();
      }
    } catch (err) {
      this.#card.dropScreen(this, flowError(err));
      return;
    }
    this.#was = { ...this.#data };
    this.#ready = true;
    this.#card.repaintSheet(true);
  }

  #t(key, placeholders) {
    return this.#hass?.localize?.(`component.${DOMAIN}.options.${key}`, placeholders);
  }

  /** Un `Flow` de facade, pour que `renderField` lise les memes traductions. */
  #voice() {
    return { t: (key, ph) => this.#t(key, ph), hass: this.#hass };
  }

  paint(sheet) {
    this.#selectors = [];
    sheet.appendChild(
      sheetHead({
        title: t("sheet.settings"),
        onBack: this.#card.stackDepth > 1 ? () => this.#card.dropScreen(this) : null,
      })
    );

    if (!this.#ready) {
      const wait = document.createElement("p");
      wait.className = "wait";
      wait.textContent = t("card.opening");
      sheet.appendChild(wait);
      return;
    }

    if (this.#error) {
      const err = document.createElement("div");
      err.className = "err";
      err.textContent = this.#error;
      sheet.appendChild(err);
    }

    // Trois blocs, un par chose qu'on peut vouloir changer : ce qui nomme, ce
    // qui compte, ce qui rappelle. Le meme decoupage que la fiche d'un train.
    const groups = [
      { title: t("group.vehicle"), fields: ["vehicle"] },
      { title: t("group.odometer"), fields: ["odometer_entity"] },
      { title: t("group.rotation"), fields: ["rotation_interval"] },
    ];
    for (const group of groups) {
      const entries = this.#schema.filter((entry) => group.fields.includes(entry.name));
      if (!entries.length) continue;

      const el = document.createElement("div");
      el.className = "grp";
      const gt = document.createElement("div");
      gt.className = "gt";
      gt.textContent = group.title;
      el.appendChild(gt);

      const set = document.createElement("div");
      set.className = "fset";
      for (const entry of entries) {
        set.appendChild(
          renderField(entry, {
            data: this.#data,
            stepId: entry.step,
            flow: this.#voice(),
            onSet: (name, value) => {
              this.#data = { ...this.#data, [name]: value };
            },
            keep: (selector) => this.#selectors.push(selector),
          })
        );
      }
      el.appendChild(set);
      sheet.appendChild(el);
    }

    const more = document.createElement("div");
    more.className = "tmore";
    more.appendChild(
      linkButton(t("act.add_vehicle"), "", () => {
        this.#card.closeSheets();
        this.#card.goToIntegration();
      })
    );
    sheet.appendChild(more);

    const save = actButton(t("act.save"), null, "primary", () => this.#save());
    if (this.#busy) save.disabled = true;
    sheet.appendChild(
      sheetFoot([actButton(t("act.cancel"), null, "", () => this.#card.dropScreen(this)), save])
    );
  }

  #changed(name) {
    return (this.#data[name] ?? null) !== (this.#was[name] ?? null);
  }

  /** N'ecrit que ce qui a bouge : un pas sans changement recharge l'entree pour rien. */
  async #save() {
    if (this.#busy) return;
    // Rien de touche : on referme sans annoncer un enregistrement qui n'a pas
    // eu lieu. « Enregistré » sur une feuille ouverte puis refermee telle
    // quelle laisse croire qu'on a change quelque chose sans le vouloir.
    const touched = ["odometer_entity", "vehicle", "rotation_interval"].some((name) =>
      this.#changed(name)
    );
    if (!touched) {
      this.#card.dropScreen(this);
      return;
    }
    this.#busy = true;
    this.#error = null;
    this.#card.repaintSheet(true);

    const send = async (step) => {
      const flow = new Flow(this.#hass, this.#entryId);
      await flow.open([{ next_step_id: step }]);
      const payload = {};
      for (const entry of flow.step?.data_schema ?? []) {
        const value = this.#data[entry.name];
        if (entry.required || filled(value)) payload[entry.name] = value ?? "";
      }
      await flow.send(payload);
      return flow;
    };

    try {
      if (this.#changed("odometer_entity")) {
        const flow = await send("odometer");
        // Le compteur peut repondre par une question : le nouveau capteur lit
        // moins que ce qui a ete compte. Elle se pose dans sa propre feuille,
        // et le nom s'enregistre une fois qu'on y a repondu.
        if (!flow.ended) {
          this.#busy = false;
          this.#card.dropScreen(this);
          this.#card.pushResync(flow, () =>
            this.#saveVehicle().catch((err) => notify(this.#card, flowError(err)))
          );
          return;
        }
      }
      await this.#saveVehicle();
    } catch (err) {
      this.#error = flowError(err);
      this.#busy = false;
      this.#card.repaintSheet(true);
      return;
    }
    this.#busy = false;
    this.#card.dropScreen(this, t("msg.saved_settings"));
  }

  async #saveVehicle() {
    if (!this.#changed("vehicle") && !this.#changed("rotation_interval")) return;
    const flow = new Flow(this.#hass, this.#entryId);
    await flow.open([{ next_step_id: "vehicle" }]);
    await flow.send({
      vehicle: this.#data.vehicle ?? "",
      rotation_interval: this.#data.rotation_interval ?? 0,
    });
    // Un nom vide revient en erreur plutot qu'en abandon : la feuille est
    // deja partie, alors le refus se dit dans le bandeau.
    if (!flow.ended) {
      const message = flow.step?.errors?.vehicle;
      flow.cancel();
      throw new Error(
        (message && this.#t(`error.${message}`)) || t("msg.vehicle_failed")
      );
    }
  }

  leave() {}
}

class TyresCard extends HTMLElement {
  #config = null;
  #hass = null;
  #body = null;
  #seen = {};
  #painted = false;

  /**
   * L'hote des feuilles, pose dans `document.body`.
   *
   * Le voile est en `position: fixed`, et un element fixe ne s'ancre au
   * viewport que si aucun de ses ancetres ne cree de contexte d'empilement.
   * Home Assistant en cree : il pose un `transform` sur les cartes pendant le
   * glisser-deposer en mode edition, et les vues « sections » les enveloppent
   * dans un conteneur triable. Depuis le shadow root de la carte, la feuille
   * se dessinait alors dans la carte, rognee par son `overflow: hidden`.
   *
   * D'ou cet hote a part, hors de la carte. Il porte son propre shadow root
   * avec la meme feuille de style : sortir du shadow root de la carte, c'est
   * sortir de ses styles, et tout ce que la feuille dessine y est decrit.
   */
  #portal = null;
  #portalRoot = null;

  /**
   * Les feuilles ouvertes, de la plus ancienne a celle qu'on regarde.
   *
   * Une pile, et non une feuille : ouvrir « Modifier la fiche » depuis un
   * train empilait autrefois un dialogue sur un dialogue, ou plutot effacait
   * le premier — on annulait, et l'on retombait sur la carte, le train perdu.
   * Ici on revient d'ou l'on vient.
   */
  #stack = [];

  /**
   * Le geste qui attend d'etre confirme sur la fiche ouverte : null | "mount"
   * | "unmount" | "rotate" | "retire" | "adjust" | "delete". `#arg` porte ce
   * que le geste a besoin de retenir — l'essieu vise, pour un montage.
   */
  #mode = null;
  #arg = null;

  static getStubConfig() {
    return { entity: "sensor.pneumatiques" };
  }

  static getConfigElement() {
    return document.createElement("tyres-card-editor");
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("sensor.")) {
      throw new Error(t("card.config"));
    }
    this.#config = {
      entity: config.entity,
      title: config.title ?? "",
      advice_entity: config.advice_entity ?? null,
    };
    this.#seen = {};
    this.#painted = false;
    this.#mode = null;
    this.#arg = null;
    // Le shadow root est reecrit juste apres : une feuille laissee ouverte
    // disparaitrait de l'ecran en laissant son flux en cours cote serveur.
    // Et depuis qu'elle vit dans `body`, la reecriture ne l'emporte plus :
    // c'est a nous de la retirer.
    while (this.#stack.length) this.#stack.pop().leave?.();
    this.#destroyPortal();
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${CARD_STYLE}</style><ha-card><div class="body"></div></ha-card>`;
    this.#body = this.shadowRoot.querySelector(".body");
    if (this.#hass) this.hass = this.#hass;
  }

  set hass(hass) {
    this.#hass = hass;
    const spoke = LANG;
    setLanguage(hass);
    for (const screen of this.#stack) screen.onHass?.(hass);
    if (!this.#config || !this.#body) return;
    const ids = [this.#config.entity];
    if (this.#config.advice_entity) ids.push(this.#config.advice_entity);
    // La langue compte comme un changement d'etat : sans cela les mots de
    // l'ancienne restaient a l'ecran jusqu'a la prochaine poussee d'entite.
    const changed = watch(hass, ids, this.#seen) || LANG !== spoke;
    if (!changed && this.#painted) return;
    this.#painted = true;
    this.#draw();
  }

  /* ----- la pile de feuilles -----

     Un ecran est un objet a trois cles : `key` pour le reconnaitre, `live`
     pour dire s'il se repeint quand l'etat de la maison bouge, `paint` pour
     se dessiner. La fiche d'un train est vivante — ses kilometres avancent
     pendant qu'on la regarde. Un formulaire ne l'est pas : le repeindre
     effacerait ce qu'on est en train d'y taper. */

  get stackDepth() {
    return this.#stack.length;
  }

  /** Empile un ecran et l'affiche. */
  pushScreen(screen) {
    this.#stack.push(screen);
    this.repaintSheet(true);
    return screen;
  }

  /**
   * Retire un ecran, et dit au passage ce qui s'est joue.
   *
   * L'ecran vise plutot que le dernier : une reponse du serveur peut arriver
   * apres qu'on a ouvert autre chose par-dessus, et depiler aveuglement
   * fermerait la mauvaise feuille.
   */
  dropScreen(screen, message = null) {
    const at = this.#stack.indexOf(screen);
    if (at >= 0) {
      this.#stack.splice(at, 1).forEach((gone) => gone.leave?.());
      this.repaintSheet(true);
    }
    if (message) notify(this, message);
  }

  /** Ferme tout. */
  closeSheets() {
    while (this.#stack.length) this.#stack.pop().leave?.();
    this.repaintSheet(true);
  }

  /**
   * Repeint la feuille du dessus.
   *
   * `force` distingue les deux appelants : un geste de l'utilisateur repeint
   * toujours, une nouvelle poussee d'etat ne touche qu'un ecran qui se declare
   * vivant.
   */
  repaintSheet(force = false) {
    const top = this.#stack[this.#stack.length - 1] ?? null;

    if (!top) {
      this.#closeSheetLayer();
      return;
    }

    const root = this.#openPortal();
    let scrim = root.querySelector(".scrim");
    if (scrim && !force && !top.live) return;

    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "scrim";
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.tabIndex = -1;
      scrim.appendChild(sheet);
      // Un clic sur le voile referme l'etage du dessus, un clic dans la
      // feuille ne traverse pas : la carte, dessous, ecoute encore les siens.
      scrim.addEventListener("click", (event) => {
        if (event.target === scrim) this.dropScreen(this.#stack[this.#stack.length - 1]);
        event.stopPropagation();
      });
      scrim.addEventListener("keydown", (event) => {
        event.stopPropagation();
        // `defaultPrevented` : un Echap deja consomme — la liste ouverte d'un
        // `ha-selector` qui se referme — ne doit pas emporter la feuille avec.
        if (event.key === "Escape" && !event.defaultPrevented) {
          this.dropScreen(this.#stack[this.#stack.length - 1]);
        }
      });
      root.appendChild(scrim);
    }

    const sheet = scrim.querySelector(".sheet");
    // Repeindre le meme ecran ne doit pas le renvoyer en haut : on repeint a
    // chaque relevé de pression, et la feuille remonterait sous les doigts.
    // Un ecran different, lui, s'ouvre a son debut.
    const scrolled = scrim.dataset.key === top.key ? sheet.scrollTop : 0;
    sheet.replaceChildren();
    // La teinte appartient a l'ecran, pas a la feuille : un formulaire qui ne
    // parle d'aucun train garderait sinon le bleu du jeu d'hiver qu'on
    // regardait juste avant.
    sheet.style.removeProperty("--tint");
    sheet.removeAttribute("aria-label");
    scrim.dataset.key = top.key;
    top.paint(sheet);
    sheet.scrollTop = scrolled;
    if (force) sheet.focus();
  }

  /**
   * L'hote des feuilles, cree au premier besoin.
   *
   * Pose en fin de `body` : a z-index egal, c'est l'ordre du document qui
   * tranche, et une feuille ouverte apres un dialogue de Home Assistant doit
   * passer devant lui.
   *
   * L'ordre du document ne suffit pourtant pas quand la carte est elle-meme
   * dans un dialogue — c'est le cas depuis la pastille du plan, qui l'ouvre en
   * popup browser_mod. Deux choses s'y opposent, et il faut les deux.
   *
   * La premiere est la couche superieure du navigateur : un dialogue y vit, et
   * elle se peint au-dessus de toute la page quel que soit le `z-index`. Une
   * feuille posee dans `body` passait donc dessous, et le menu avec elle.
   *
   * La seconde est l'inertie. Un dialogue modal rend inerte tout ce qui n'est
   * pas dans son sous-arbre : monter dans la couche superieure rendait le menu
   * visible, mais il restait mort au clic et au focus. Aucun attribut ne
   * permet de s'en exempter — la seule sortie est d'etre soi-meme le dialogue
   * modal du dessus, ce que fait `showModal()`. Le nouveau devient le plus
   * haut, son sous-arbre redevient vivant, et le dialogue qui porte la carte
   * passe a son tour derriere.
   *
   * L'hote est donc rouvert a chaque couche, et referme des qu'il n'en porte
   * plus aucune : un dialogue modal laisse ouvert bloquerait la page entiere.
   *
   * Il demeure sans surface : ce sont ses deux couches, en position fixe, qui
   * couvrent l'ecran — un hote qui s'etendrait capterait les clics. D'ou la
   * remise a zero de ce qu'un `dialog` recoit du navigateur : cadre, fond,
   * remplissage, largeurs maximales, et le voile qu'il pose derriere lui et
   * que le voile de nos feuilles doublerait.
   */
  #openPortal() {
    if (!this.#portal) {
      const host = document.createElement("dialog");
      host.className = "tyres-card-sheets";
      host.style.cssText =
        "position:fixed;top:0;left:0;width:0;height:0;max-width:none;max-height:none;" +
        "margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:1000;";
      // Echap appartient aux couches, pas a l'hote : la carte referme un etage
      // a la fois, la ou le navigateur fermerait tout d'un coup.
      host.addEventListener("cancel", (event) => event.preventDefault());

      // La racine d'ombre descend d'un cran : `dialog` ne figure pas parmi les
      // elements qui en acceptent une, et `attachShadow` y leve. C'est donc un
      // `div` interieur qui la porte, sans surface lui non plus.
      const inner = document.createElement("div");
      inner.style.cssText = "width:0;height:0;";
      const root = inner.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CARD_STYLE;
      root.appendChild(style);
      host.appendChild(inner);

      portalBackdrop();
      document.body.appendChild(host);
      this.#portal = host;
      this.#portalRoot = root;
    }
    if (!this.#portal.open) this.#portal.showModal();
    return this.#portalRoot;
  }

  /**
   * Referme l'hote quand il ne porte plus ni feuille ni menu.
   *
   * Il reste en place, vide : c'est un dialogue modal, et le laisser ouvert
   * rendrait inerte la page qu'on vient de rendre a l'utilisateur.
   */
  #idlePortal() {
    const root = this.#portalRoot;
    if (!root || root.querySelector(".scrim") || root.querySelector(".menu-layer")) return;
    if (this.#portal.open) this.#portal.close();
  }

  /**
   * Retire la couche des feuilles, en laissant l'hote en place.
   *
   * L'hote porte aussi le menu de la carte, qui n'a rien a voir avec la pile
   * d'ecrans : le vider entierement fermerait l'un en refermant l'autre. Vide,
   * il ne coute rien — ses deux couches sont en position fixe, donc hors flux.
   */
  #closeSheetLayer() {
    this.#portalRoot?.querySelector(".scrim")?.remove();
    this.#idlePortal();
  }

  /** Referme tout et retire l'hote du document : rien ne doit lui survivre. */
  #destroyPortal() {
    this.#portal?.remove();
    this.#portal = null;
    this.#portalRoot = null;
  }

  /**
   * La carte quitte la page : la feuille ne peut pas y rester.
   *
   * Elle vit dans `body` et non dans la carte — changer de vue ou de tableau
   * de bord la laisserait ouverte, devant une carte qui n'est plus la.
   */
  disconnectedCallback() {
    while (this.#stack.length) this.#stack.pop().leave?.();
    this.#destroyPortal();
  }

  /* ----- appels au composant ----- */

  #call(service, data) {
    // Services d'entite : c'est la cible qui designe le vehicule, donc deux
    // voitures suivies ne se marchent jamais dessus.
    return (
      this.#hass?.callService(DOMAIN, service, data, {
        entity_id: this.#config.entity,
      }) ?? Promise.reject(new Error(t("card.not_connected")))
    );
  }

  /**
   * Un service, et le mot qui suit — mais seulement s'il a abouti.
   *
   * Le composant refuse maintenant a voix haute : un train a l'historique
   * qu'on essaie de monter, une paire qu'on essaie de permuter, un compteur
   * qui recule. Annoncer « Train monte » sans attendre la reponse, c'est
   * afficher le contraire de ce qui vient de se passer — et Home Assistant
   * pose son propre bandeau d'erreur juste a cote.
   *
   * En cas de refus la feuille reste ouverte, la ou le geste a ete demande :
   * la refermer emporterait la question sans y avoir repondu.
   */
  #run(service, data, message) {
    this.#call(service, data).then(
      () => this.#did(message),
      // Le refus est deja dit : `callService` pose le bandeau lui-meme, avec
      // le message que le composant a ecrit. Le repeter ferait deux voix.
      () => {}
    );
  }

  /** L'entree de configuration du vehicule, que le capteur porte en attribut. */
  #entryId() {
    return this.#seen[this.#config.entity]?.attributes?.entry_id ?? null;
  }

  /** Les attributs du capteur, d'ou tout se lit. */
  #attrs() {
    return this.#seen[this.#config.entity]?.attributes ?? {};
  }

  /** Un train, tel que le capteur le porte. */
  #set(setId) {
    const sets = this.#attrs().sets;
    return (Array.isArray(sets) ? sets : []).find((other) => other.id === setId) ?? null;
  }

  /**
   * Ouvre un ecran de saisie, adosse a un pas du flux d'options.
   *
   * `step` est le pas vise, `setId` le train dont il parle — la carte descend
   * jusque-la sans montrer les pas traverses, puisqu'ils ne posent que des
   * questions auxquelles on a deja repondu en touchant une ligne.
   */
  #openStep(step, { setId = null, done = null, after = null } = {}) {
    const entryId = this.#entryId();
    if (!entryId) {
      notify(
        this,
        t("card.no_entry")
      );
      return null;
    }

    const path = setId
      ? [{ next_step_id: "manage" }, { id: setId }, { next_step_id: step }]
      : [{ next_step_id: step }];
    const set = setId ? this.#set(setId) : null;

    const screen = new FormScreen(this, {
      flow: new Flow(this.#hass, entryId),
      path,
      done,
      title: LAYOUTS()[step]?.title,
      ident: set ? { set, attrs: this.#attrs() } : null,
      onDone: after,
    });
    this.pushScreen(screen);
    screen.open();
    return screen;
  }

  /**
   * Supprime un train.
   *
   * La carte a deja confirme, et dit ce que la suppression efface : le pas de
   * confirmation du flux est repondu dans la foulee, sinon la meme question
   * serait posee deux fois.
   */
  #deleteSet(set) {
    const entryId = this.#entryId();
    if (!entryId) return;
    const flow = new Flow(this.#hass, entryId);
    this.closeSheets();
    (async () => {
      try {
        await flow.open([
          { next_step_id: "manage" },
          { id: set.id },
          { next_step_id: "delete" },
          {},
        ]);
        notify(this, flow.outcome ?? t("msg.deleted", { name: nameOf(set) }));
      } catch (err) {
        notify(this, flowError(err));
      } finally {
        flow.cancel();
      }
    })();
  }

  /* ----- rendu ----- */

  /**
   * La carte, puis la feuille ouverte si elle est vivante.
   *
   * Les deux se repeignent ensemble a chaque etat recu : la fiche d'un train
   * montre des kilometres et un essieu, qui bougent pendant qu'elle est
   * ouverte. Une feuille peinte une fois pour toutes afficherait l'etat
   * d'avant le geste qu'on vient d'y faire.
   */
  #draw() {
    this.#drawBody();
    this.repaintSheet();
  }

  #drawBody() {
    const state = this.#seen[this.#config.entity];
    this.#body.replaceChildren();

    if (!state) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("card.entity_missing", { entity: this.#config.entity });
      this.#body.appendChild(p);
      return;
    }

    const attrs = state.attributes ?? {};
    const sets = Array.isArray(attrs.sets) ? attrs.sets : [];
    const front = fittedAt(attrs, "front");
    const rear = fittedAt(attrs, "rear");
    const same = front && rear && front.id === rear.id;

    this.#header(attrs);

    // le jeu monte
    if (same) {
      this.#body.appendChild(this.#hero(null, front, attrs));
    } else if (front || rear) {
      const wrap = document.createElement("div");
      wrap.className = "heroes";
      wrap.append(
        this.#hero(POSITIONS.front, front, attrs),
        this.#hero(POSITIONS.rear, rear, attrs)
      );
      this.#body.appendChild(wrap);
    } else if (sets.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("card.none_fitted_dot");
      this.#body.appendChild(p);
    }

    this.#pressures(attrs);

    // conseil
    const advice = this.#config.advice_entity
      ? this.#seen[this.#config.advice_entity]?.state === "on"
      : false;
    if (advice) {
      // `ha-alert` plutot qu'une boite a nous : le fond etait un
      // `rgba(255,167,38,…)` en dur sous un texte en `var(--warning-color)`,
      // donc du rouge sur de l'orange chez qui redefinit l'avertissement.
      const a = document.createElement("ha-alert");
      a.className = "advice";
      a.setAttribute("alert-type", "warning");
      a.textContent = t("card.advice");
      this.#body.appendChild(a);
    }

    // Aucun train : ne rien dire de plus que « rien n'est monte » laisserait
    // la carte sur une impasse, alors que tout se declare depuis elle. C'est
    // le seul endroit ou le geste garde un bouton — une carte vide est faite
    // pour etre remplie, et le menu seul se chercherait.
    if (!sets.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("card.no_sets");
      this.#body.appendChild(p);
      const first = document.createElement("div");
      first.className = "links";
      first.appendChild(
        actButton(t("act.add_set"), "mdi:plus", "primary", () =>
          this.#openStep("add", { done: t("msg.set_added") })
        )
      );
      this.#body.appendChild(first);
      return;
    }

    // Le compte ne se dit qu'ici. L'en-tete porte le compteur, que la liste ne
    // peut pas dire ; la liste porte son nombre, aligne a droite comme les
    // kilometrages des lignes qu'il annonce.
    const lb = document.createElement("div");
    lb.className = "label";
    const l1 = document.createElement("span");
    l1.textContent = t("card.sets_label");
    const l2 = document.createElement("span");
    l2.className = "count";
    l2.textContent = String(sets.length);
    lb.append(l1, l2);
    this.#body.appendChild(lb);

    // Les jeux de l'historique en dernier : ils se consultent, ils ne se
    // manipulent pas, et ils n'ont donc rien a faire dans le flux du geste.
    const worst = Math.max(1, ...sets.map((s) => Number(s.km) || 0));
    for (const set of [...sets].sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0))) {
      this.#body.appendChild(this.#row(set, worst, attrs));
    }
  }

  /**
   * L'en-tete : de quelle voiture on parle, et ou en est son compteur.
   *
   * La carte s'ouvrait sur un grand nombre sans jamais nommer le vehicule.
   * Deux voitures sur le meme tableau de bord ne se distinguaient que par la
   * reference du pneu monte — et il n'y avait nulle part ou accrocher ce qui
   * ne vise aucun train en particulier.
   */
  #header(attrs) {
    const el = document.createElement("div");
    el.className = "chead";

    const txt = document.createElement("div");
    txt.className = "ct";
    const h = document.createElement("div");
    h.className = "h";
    h.textContent = this.#config.title || attrs.vehicle || t("card.tyres");
    txt.appendChild(h);

    // Le compteur se lit, il ne se saisit plus. C'est le pivot dont tous les
    // totaux se deduisent, et il vivait en champ libre au bas d'une carte
    // qu'on parcourt : un doigt qui derape les decalait tous.
    if (Number.isFinite(Number(attrs.odometer))) {
      const s = document.createElement("div");
      s.className = "s";
      s.textContent = t("card.odometer_reads", { km: km(attrs.odometer) });
      txt.appendChild(s);
    }

    const more = document.createElement("button");
    more.type = "button";
    more.className = "iconbtn";
    more.setAttribute("aria-label", t("act.card_options"));
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.appendChild(makeIcon("mdi:dots-vertical"));
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      this.#openMenu(more, attrs);
    });

    el.append(txt, more);
    this.#body.appendChild(el);
  }

  /**
   * Le menu de la carte : ce qui ne vise aucun train.
   *
   * Ajouter un train et regler le vehicule tenaient en bas de la carte, vus a
   * chaque coup d'oeil et servis deux fois par an. Ils passent derriere un
   * point d'entree unique, la ou Home Assistant met les siens.
   *
   * Peint dans le portail et non dans la carte, pour la meme raison que la
   * feuille : un menu en position fixe pose sous un ancetre transforme se
   * placerait de travers.
   */
  #openMenu(anchor, attrs) {
    const root = this.#openPortal();
    root.querySelector(".menu-layer")?.remove();

    const layer = document.createElement("div");
    layer.className = "menu-layer";
    const menu = document.createElement("div");
    menu.className = "cardmenu";
    menu.setAttribute("role", "menu");

    const close = () => {
      // Les ecouteurs partent toujours, meme si la couche a deja disparu — un
      // menu emporte par la deconnexion de la carte les laisserait derriere.
      removeEventListener("scroll", onScroll, true);
      removeEventListener("resize", close);
      // Une fermeture peut arriver deux fois : par le clic, puis par le
      // defilement que ce clic a declenche. La seconde ne doit pas voler le
      // focus a ce que la premiere vient d'ouvrir.
      if (!layer.isConnected) return;
      layer.remove();
      this.#idlePortal();
      anchor.setAttribute("aria-expanded", "false");
      anchor.focus();
    };
    layer.addEventListener("click", (event) => {
      if (event.target === layer) close();
      event.stopPropagation();
    });
    layer.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") close();
    });
    /* Le menu est place au pixel sous son bouton : ce qui deplace le bouton le
       laisserait pointer a cote, donc on referme.

       Deux precautions, et elles ne sont pas de confort. Le defilement est
       ecoute en capture, donc n'importe quel conteneur de la page le declenche
       — y compris celui d'un dialogue. Or la carte s'ouvre en dialogue depuis
       la pastille du plan : donner le focus a la premiere entree du menu, qui
       vit hors de la boite, fait rappeler ce focus par le dialogue et defiler
       son contenu. Le menu se refermait dans la seconde qui suivait son
       ouverture, ce qui se voit exactement comme un menu qui ne s'ouvre pas.

       Donc : on n'ecoute qu'a partir de l'image suivante, le temps que ce
       remue-menage retombe, et on ne referme que si le bouton a reellement
       bouge. C'est la condition qu'on voulait depuis le debut — le reste
       n'etait qu'une approximation par le defilement. */
    const anchored = anchor.getBoundingClientRect();
    const onScroll = () => {
      if (!layer.isConnected) return removeEventListener("scroll", onScroll, true);
      const now = anchor.getBoundingClientRect();
      if (Math.abs(now.top - anchored.top) < 1 && Math.abs(now.left - anchored.left) < 1) return;
      close();
    };
    requestAnimationFrame(() => {
      if (layer.isConnected) addEventListener("scroll", onScroll, true);
    });
    addEventListener("resize", close, { once: true });

    const item = (label, icon, onClick, trailing = null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mi";
      b.setAttribute("role", "menuitem");
      b.appendChild(makeIcon(icon));
      const t = document.createElement("span");
      t.className = "mt";
      t.textContent = label;
      b.append(t);
      if (trailing) {
        const v = document.createElement("span");
        v.className = "mv";
        v.textContent = trailing;
        b.appendChild(v);
      }
      if (onClick) {
        b.addEventListener("click", () => {
          close();
          onClick();
        });
      } else {
        b.disabled = true;
      }
      menu.appendChild(b);
    };
    const rule = () => {
      const hr = document.createElement("div");
      hr.className = "msep";
      menu.appendChild(hr);
    };

    item(t("act.add_set"), "mdi:plus", () =>
      this.#openStep("add", { done: t("msg.set_added") })
    );
    item(t("sheet.settings"), "mdi:car-cog", () => this.#settings());
    rule();
    // Un compteur nourri par un capteur ne se corrige pas a la main : la ligne
    // le dit, et ne s'ouvre sur rien.
    if (attrs.odometer_auto === true) {
      item(t("card.odometer_menu"), "mdi:counter", null, t("card.automatic"));
    } else {
      item(t("act.update_odometer"), "mdi:counter", () => this.#askOdometer(attrs));
    }
    rule();
    item(t("act.integration_page"), "mdi:open-in-new", () => this.goToIntegration());

    layer.appendChild(menu);
    root.appendChild(layer);
    anchor.setAttribute("aria-expanded", "true");

    // Place apres coup : la largeur du menu depend de ses libelles, et son
    // debordement en bas d'ecran ne se connait qu'une fois mesure.
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const gap = 4;
    menu.style.top =
      a.bottom + gap + m.height > innerHeight - 8
        ? `${Math.max(8, a.top - gap - m.height)}px`
        : `${a.bottom + gap}px`;
    menu.style.left = `${Math.max(8, Math.min(a.right - m.width, innerWidth - m.width - 8))}px`;
    menu.querySelector(".mi:not([disabled])")?.focus();
  }

  /**
   * Mettre le compteur a jour.
   *
   * En feuille, et non en champ ouvert sur la carte : le chiffre decale tous
   * les totaux, et le composant refuse d'ailleurs une valeur inferieure a la
   * derniere — autant que la saisie soit un geste, pas un frolement.
   *
   * Le geste courant n'est pas une correction de quelques kilometres, c'est un
   * releve : on lit le tableau de bord et on reporte. D'ou trois facons
   * d'arriver au nombre, dans l'ordre ou elles servent — le champ ouvert sur
   * sa valeur deja selectionnee, pour taper le releve par-dessus ; les bonds
   * de cent, cinq cents et mille, pour le rattrapage a vue ; et les fleches du
   * champ, passees a dix, pour l'ajustement fin. Un pas de un ne servait
   * qu'a ce dernier cas et faisait tout le reste a la main.
   */
  #askOdometer(attrs) {
    const card = this;
    const from = Number.isFinite(Number(attrs.odometer)) ? Math.round(Number(attrs.odometer)) : null;
    const start = from === null ? "" : String(from);
    let input = null;

    const screen = {
      key: "odometer",
      live: false,
      paint(sheet) {
        // Refaite a chaque peinture, mais nommee avant : les bonds l'appellent
        // et sont construits plus haut qu'elle.
        let sync;
        sheet.appendChild(
          sheetHead({
            title: t("sheet.odometer"),
            onBack: card.stackDepth > 1 ? () => card.dropScreen(screen) : null,
          })
        );

        const desc = document.createElement("p");
        desc.className = "desc";
        desc.textContent =
          t("sheet.odometer_note");
        sheet.appendChild(desc);

        const field = document.createElement("div");
        field.className = "fld2";
        const unit = document.createElement("div");
        unit.className = "unit";
        input = document.createElement("input");
        input.type = "number";
        input.className = "tx";
        input.inputMode = "numeric";
        // Dix, et non un : les fleches servent a l'ajustement, jamais au
        // releve — celui-ci se tape ou se prend aux bonds ci-dessous.
        input.step = "10";
        if (from !== null) input.min = String(from);
        input.value = start;
        input.setAttribute("aria-label", t("sheet.odometer"));
        const u = document.createElement("span");
        u.className = "u";
        u.textContent = "km";
        unit.append(input, u);
        field.appendChild(unit);

        const jumps = document.createElement("div");
        jumps.className = "quick";
        for (const step of [100, 500, 1000]) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "qk";
          b.textContent = `+${km(step)}`;
          b.addEventListener("click", (event) => {
            event.stopPropagation();
            const base = Number(input.value);
            input.value = String(Math.round(Number.isFinite(base) ? base : from ?? 0) + step);
            sync();
            input.focus();
          });
          jumps.appendChild(b);
        }
        field.appendChild(jumps);

        // L'ecart, plutot que le seul total. C'est lui qu'on verifie apres
        // avoir tape — un chiffre de six caracteres se relit mal, un « +1 200
        // km » se reconnait tout de suite comme la distance qu'on a faite.
        const gap = document.createElement("p");
        gap.className = "hp";
        field.appendChild(gap);
        sheet.appendChild(field);

        const save = actButton(t("act.save"), null, "primary", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || (from !== null && value < from)) return;
          // La feuille ne se referme qu'une fois le releve accepte. Elle refuse
          // deja un chiffre qui recule, mais c'est le composant qui tranche —
          // et s'il refuse, la valeur tapee doit rester sous les yeux.
          card.setOdometer(value).then(
            () => card.dropScreen(screen, t("msg.odometer_saved")),
            () => {}
          );
        });

        sync = () => {
          const value = Number(input.value);
          const known = Number.isFinite(value);
          const below = known && from !== null && value < from;
          field.classList.toggle("wrong", below);
          gap.className = below ? "no" : "hp";
          gap.textContent = !known
            ? t("help.odo_dashboard")
            : below
              ? t("help.odo_below", { km: km(from) })
              : from === null || value === from
                ? t("help.odo_nothing")
                : t("help.odo_added", { km: km(value - from) });
          save.disabled = !known || below;
        };
        input.addEventListener("input", sync);
        sync();

        sheet.appendChild(
          sheetFoot([actButton(t("act.cancel"), null, "", () => card.dropScreen(screen)), save])
        );
        // La feuille s'ouvre sur le champ, valeur selectionnee : c'est la seule
        // chose qu'elle demande, et le releve se tape par-dessus sans avoir a
        // effacer six chiffres.
        queueMicrotask(() => {
          input?.focus();
          input?.select();
        });
      },
    };
    this.pushScreen(screen);
  }

  /** Le service, depuis la feuille du compteur. */
  setOdometer(value) {
    return this.#call("set_odometer", { odometer: value });
  }

  /** Les reglages du vehicule : son nom, son compteur, son rappel. */
  #settings() {
    const entryId = this.#entryId();
    if (!entryId) {
      notify(
        this,
        t("card.no_entry")
      );
      return;
    }
    const screen = new SettingsScreen(this, { hass: this.#hass, entryId });
    this.pushScreen(screen);
    screen.open();
  }

  /**
   * La feuille de « deux relevés se contredisent », sur un flux deja ouvert.
   *
   * La question ne vient pas d'un geste : elle nait d'un capteur qui lit moins
   * que ce qui a ete compte, et le flux la pose au moment ou l'on croyait en
   * avoir fini. Elle a donc sa feuille a elle, et ce qui restait a enregistrer
   * attend qu'on y ait repondu.
   */
  pushResync(flow, after) {
    const screen = new FormScreen(this, {
      flow,
      done: t("msg.saved_settings"),
      onDone: after,
    });
    this.pushScreen(screen);
    screen.open();
  }

  /**
   * La page de l'integration.
   *
   * Ajouter un second vehicule s'y passe, et pas ici : une carte est liee a
   * une voiture, elle ne peut pas en creer une autre sans mentir sur ce
   * qu'elle montre. Mais elle dit ou cela se fait, ce qui manquait pour le
   * trouver.
   */
  goToIntegration() {
    performAction(
      this,
      this.#hass,
      { action: "navigate", navigation_path: `/config/integrations/integration/${DOMAIN}` },
      this.#config.entity
    );
  }

  /**
   * Les quatre coins, quand des capteurs y sont attaches.
   *
   * Le composant les rend deja resolus par coin : un capteur appartient au
   * train, mais une paire montee a l'arriere lit a l'arriere, et c'est le
   * vehicule qui sait ou elle est. La carte n'a donc rien a recalculer.
   */
  #pressures(attrs) {
    const byCorner = attrs.pressures ?? {};
    const corners = CORNERS.filter((corner) => byCorner[corner]);
    if (!corners.length) return;

    const grid = document.createElement("div");
    grid.className = "tpms";
    for (const corner of corners) {
      const read = byCorner[corner];
      const cell = document.createElement("div");
      cell.className =
        "wheel" + (read.stale ? " stale" : "") + (read.alarm ? " alarm" : "");

      const label = document.createElement("span");
      label.className = "corner";
      // Le repli passe par la table des coins : la cle brute « front_left »
      // n'est pas un mot, et la pastille de plan fait deja ce choix.
      label.textContent = read.label ?? CORNER_LABELS[corner] ?? corner;

      const value = document.createElement("span");
      value.className = "p";
      value.textContent =
        read.pressure == null ? "—" : `${trim(read.pressure)} ${read.unit ?? ""}`.trim();

      cell.append(label, value);

      // La pression est la donnee ; le reste est du contexte. Un seul
      // emplacement a droite, et c'est le plus urgent qui l'occupe.
      const aside = this.#wheelAside(read);
      if (aside) cell.appendChild(aside);

      if (read.stale) {
        const since = sinceLabel(read.last_seen);
        cell.title =
          (since ? t("card.stale_title", { since }) : t("card.sensor_silent")) +
          (read.alarm ? t("card.alarm_note") : "");
      } else if (read.alarm) {
        cell.title = t("card.alarm_title");
      }
      grid.appendChild(cell);
    }
    this.#body.appendChild(grid);
  }

  /**
   * Le second membre d'une cellule de roue.
   *
   * La roue arrive avec quatre valeurs — pression, temperature, pile, date du
   * dernier releve — et la carte n'en montrait qu'une seule en plus de la
   * pression, la temperature, avec un « °C » suppose alors que la pression,
   * elle, lit son unite.
   *
   * L'ordre ci-dessous est celui de l'urgence. Un capteur muet passe devant
   * tout : sa pression est un souvenir. Une pile faible vient ensuite — c'est
   * l'avertissement qui permet d'agir avant le silence, et il etait jete. La
   * temperature ne vient qu'apres : elle ne se lit pas pour elle-meme, elle
   * explique une pression basse un matin froid.
   */
  #wheelAside(read) {
    const say = (text, icon, tone) => {
      const el = document.createElement("span");
      el.className = "t" + (tone ? ` ${tone}` : "");
      if (icon) el.appendChild(makeIcon(icon));
      el.appendChild(document.createTextNode(text));
      return el;
    };

    // Le pneu appele faux passe devant tout, tant que la lecture est
    // d'aujourd'hui : c'est l'information qui empeche de prendre la route.
    // Muet, le silence reprend la main — l'alarme, comme la pression, date
    // d'avant, et la cellule rouge dit deja ce qu'il reste a dire.
    if (read.alarm && !read.stale) {
      return say(t("card.alarm_aside"), "mdi:car-tire-alert", "danger");
    }
    if (read.stale) {
      const since = sinceLabel(read.last_seen);
      // « 3 j » seul ne dirait pas de quoi il s'agit a cote d'une pression.
      return say(
        since ? t("card.mute_for", { since }) : t("card.mute"),
        "mdi:alert-outline",
        "alarm"
      );
    }
    if (Number.isFinite(Number(read.battery)) && Number(read.battery) <= 15) {
      return say(`${Math.round(Number(read.battery))} %`, "mdi:battery-alert-variant-outline", "alarm");
    }
    if (read.temperature != null) {
      // L'unite vient du capteur. « °C » etait ecrit quoi qu'il arrive, ce qui
      // affichait « 64 °C » pour une sonde en Fahrenheit.
      return say(`${trim(read.temperature)} ${read.temperature_unit ?? "°C"}`.trim(), null, "");
    }
    return null;
  }

  #hero(position, set, attrs) {
    const tone = look(set);
    const el = document.createElement("div");
    el.className = "hero";
    el.style.setProperty("--tint", tone.tint);

    const mark = document.createElement("div");
    mark.className = "mark";
    mark.appendChild(makeIcon(set ? tone.icon : "mdi:car-tire-alert"));

    const txt = document.createElement("div");
    txt.className = "txt";
    if (position) {
      const p = document.createElement("span");
      p.className = "pos";
      p.textContent = position;
      txt.appendChild(p);
    }
    const k = document.createElement("div");
    k.className = "km";
    k.textContent = set ? km(set.km) : "—";
    const r = document.createElement("div");
    r.className = "ref";
    // Le label d'abord, comme partout : l'aide du champ promet qu'il
    // « remplace la référence à l'écran », et le capteur le sert deja
    // desambiguise quand deux jeux partagent une reference.
    r.appendChild(
      document.createTextNode(set ? nameOf(set) : t("card.no_set"))
    );
    const qty = set ? axleIcon(axleOf(set, attrs)) : null;
    if (qty) r.appendChild(qty);

    txt.append(k, r);

    // Un jeu monte sans date de montage — le cas d'un suivi repris ailleurs —
    // n'a rien a dire ici : mieux vaut une ligne en moins qu'une ligne vide.
    const said = set ? this.#since(set) : t("card.nothing_here");
    if (said) {
      const s = document.createElement("div");
      s.className = "sub";
      s.textContent = said;
      txt.appendChild(s);
    }

    el.append(mark, txt);
    return el;
  }

  /**
   * « Monté depuis le 12 avril », sans jamais afficher une date brute.
   *
   * La quantite de pneus s'y ajoutait autrefois ; elle est passee en icone sur
   * la ligne du dessus, contre la reference qu'elle qualifie.
   */
  #since(set) {
    if (!set.mounted_since) return "";
    const d = new Date(set.mounted_since);
    if (Number.isNaN(d.getTime())) return "";
    return t("card.mounted_since", {
      date: d.toLocaleDateString(LANG, { day: "numeric", month: "long" }),
    });
  }

  #row(set, worst, attrs) {
    const tone = look(set);
    const on = Array.isArray(set.positions) ? set.positions : [];
    const row = document.createElement("div");
    row.className =
      "row" + (on.length ? " is-mounted" : "") + (set.retired ? " is-retired" : "");
    row.style.setProperty("--tint", tone.tint);

    const ic = document.createElement("div");
    ic.className = "ic";
    ic.appendChild(makeIcon(tone.icon));

    const mid = document.createElement("div");
    mid.className = "mid";
    const name = document.createElement("div");
    name.className = "name";
    name.appendChild(document.createTextNode(nameOf(set)));
    // La quantite se colle a la reference, qu'elle qualifie, plutot que de se
    // noyer dans la ligne de metadonnees ou elle valait deux mots.
    const qty = axleIcon(axleOf(set, attrs));
    if (qty) name.appendChild(qty);
    const meta = document.createElement("div");
    meta.className = "meta";
    // Le code de date suit un jeu jusque dans l'archive : c'est au moment de
    // remonter un jeu range depuis des annees qu'il pese le plus.
    const dot = dotLabel(set);
    // Le cout au kilometre n'apparait qu'une fois le jeu assez roule pour que
    // la division veuille dire quelque chose — le composant le tait avant.
    // « 4 roues » quitte cette ligne : l'icone accolee au nom le dit deja.
    meta.textContent = set.retired
      ? [SEASONS[set.season]?.label, dot, cost(set), this.#retiredOn(set)]
          .filter(Boolean)
          .join(" · ")
      : [SEASONS[set.season]?.label, set.size, dot, cost(set)]
          .filter(Boolean)
          .join(" · ");
    mid.append(name, meta);

    const val = document.createElement("div");
    val.className = "val";
    val.appendChild(document.createTextNode(km(set.km)));
    const st = document.createElement("span");
    st.className = "state";
    st.textContent = set.retired
      ? t("season.retired")
      : on.length === 2
        ? t("status.both_axles")
        : on.length
          ? on.map((p) => POSITIONS[p] ?? p).join(", ")
          : t("status.available");
    val.appendChild(st);

    // Ce qui appelle une decision, la ou on regarde. Le composant calcule les
    // deux depuis toujours : la permutation ne colorait qu'un bouton au fond
    // d'une feuille, et l'age ne se lisait nulle part.
    for (const pill of this.#pills(set)) val.appendChild(pill);

    row.append(ic, mid, val);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round(((Number(set.km) || 0) / worst) * 100)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    // Toute la ligne ouvre la feuille du train, y compris pour un jeu retire :
    // sans cela il serait une impasse, et le remettre en service demanderait de
    // passer par le flux de configuration. La ligne ne porte aucun bouton — un
    // seul geste a apprendre, et quatre trains qui tiennent dans un ecran.
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const open = () => this.#openTrain(set.id);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });

    return row;
  }

  /**
   * Les pastilles d'une ligne : ce qui demande un geste, et rien d'autre.
   *
   * « À permuter » et non « permutation due » : `rotation_due` ne devient vrai
   * qu'une fois l'intervalle depasse, donc le moment est venu — mais la carte
   * conseille, elle n'ordonne pas, et c'est deja le ton du bandeau meteo.
   *
   * Le chiffre qui justifie l'avis passe en infobulle. Le nom accessible, lui,
   * reprend d'abord le libelle affiche : un `aria-label` qui ne contient pas
   * le texte visible casse la commande vocale.
   */
  #pills(set) {
    const out = [];
    const pill = (text, icon, { quiet = false, title = null } = {}) => {
      const el = document.createElement("span");
      el.className = "pill" + (quiet ? " quiet" : "");
      if (icon) el.appendChild(makeIcon(icon));
      el.appendChild(document.createTextNode(text));
      if (title) {
        el.title = title;
        el.setAttribute("aria-label", `${text} — ${title}`);
      }
      out.push(el);
    };

    if (set.rotation_due && !set.retired) {
      const since = Number.isFinite(Number(set.km_since_rotation))
        ? t("card.since_rotation", { km: km(set.km_since_rotation) })
        : null;
      pill(t("status.rotate_due"), "mdi:rotate-3d-variant", { title: since });
    }
    // L'age d'un pneu ne se lit sur aucun compteur : il vieillit a l'arret, et
    // c'est justement un jeu range qui vieillit sans qu'on y pense.
    if (set.aged && Number.isFinite(Number(set.age_years))) {
      const years = Math.round(Number(set.age_years));
      const said =
        years <= 1 ? t("unit.years_one", { n: years }) : t("unit.years_many", { n: years });
      pill(said, "mdi:clock-outline", {
        quiet: true,
        title: t("card.age_hint"),
      });
    }
    return out;
  }

  /* « classé le … » et non « depuis le … » : la ligne voisine porte deja
     « monté depuis », et deux « depuis » sur la meme rangee se liraient comme
     la meme date. L'etat, lui, est dit par la pastille. */
  #retiredOn(set) {
    if (!set.retired_at) return t("status.filed");
    const d = new Date(set.retired_at);
    if (Number.isNaN(d.getTime())) return t("status.filed");
    return t("status.filed_on", {
      date: d.toLocaleDateString(LANG, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });
  }

  #button(label, iconName, variant, onClick) {
    return actButton(label, iconName, variant, onClick);
  }

  /* ----- la fiche d'un train -----

     Trois niveaux, et pas un de plus : la carte montre, la fiche agit, le
     geste se confirme sur place. Ce qui suit est le deuxieme — il a remplace
     la bande d'actions qui s'ouvrait dans la ligne, ou la place manquait au
     point qu'il fallait cacher la moitie des verbes sous « … ».

     Un quatrieme s'empile par-dessus quand il faut ecrire quelque chose : le
     formulaire s'ouvre au-dessus de la fiche et la lui rend en se refermant.
     C'est tout ce que la pile sert a faire. */

  /** Ouvre la fiche d'un train, sans geste en attente. */
  #openTrain(setId) {
    this.#mode = null;
    this.#arg = null;
    this.pushScreen(this.#trainScreen(setId));
  }

  /**
   * L'ecran d'un train.
   *
   * Vivant tant qu'aucun geste n'attend d'etre confirme : ses kilometres
   * avancent pendant qu'on le regarde, et c'est bien ce qu'on veut voir. Des
   * qu'un encart de confirmation porte une saisie, il se fige — le repeindre
   * effacerait le relevé qu'on est en train d'y taper.
   */
  #trainScreen(setId) {
    const card = this;
    const screen = {
      key: `train:${setId}`,
      get live() {
        return !card.pendingMode;
      },
      paint(sheet) {
        const attrs = card.trainAttrs;
        const set = card.trainSet(setId);
        // Un train supprime pendant que sa fiche etait ouverte : elle se
        // referme plutot que de decrire une fiche qui n'existe plus.
        if (!set) {
          queueMicrotask(() => card.dropScreen(screen));
          return;
        }
        const tone = look(set);
        sheet.style.setProperty("--tint", tone.tint);
        sheet.setAttribute("aria-label", `${nameOf(set)} — ${stateLine(set, attrs)}`);

        sheet.appendChild(
          sheetHead({
            set,
            attrs,
            onBack: card.stackDepth > 1 ? () => card.dropScreen(screen) : null,
          })
        );
        card.paintTrainBody(sheet, set, attrs);
        sheet.appendChild(
          sheetFoot([actButton(t("act.close"), null, "", () => card.closeSheets())])
        );
      },
    };
    return screen;
  }

  /** Ce que la fiche montre sous son en-tete. */
  paintTrainBody(sheet, set, attrs) {
    sheet.appendChild(this.#mode ? this.#confirm(set, attrs) : this.#verbs(set, attrs));
    for (const block of this.#blocks(set, attrs)) sheet.appendChild(block);
    sheet.appendChild(this.#more(set, attrs));
  }

  get pendingMode() {
    return this.#mode;
  }

  get trainAttrs() {
    return this.#attrs();
  }

  trainSet(setId) {
    return this.#set(setId);
  }

  /** Met un geste en attente de confirmation, sans quitter la fiche. */
  #ask(mode, arg = null) {
    this.#mode = mode;
    this.#arg = arg;
    this.repaintSheet(true);
  }

  /** Le geste est parti : on referme, et ce qu'il change se lit sur la carte. */
  #did(message) {
    this.#mode = null;
    this.#arg = null;
    // Les fiches de train seulement, pas la pile entiere : la reponse du
    // serveur peut arriver apres qu'une autre feuille s'est ouverte par-dessus,
    // et elle n'a pas a l'emporter — c'est la regle que `dropScreen` s'est
    // deja donnee.
    for (const screen of [...this.#stack]) {
      if (String(screen.key).startsWith("train:")) this.dropScreen(screen);
    }
    if (message) notify(this, message);
  }

  /**
   * Les verbes de l'etat ou se trouve le train.
   *
   * Un etat, un verbe mis en avant : au garage on monte, sur la voiture on
   * depose, a l'historique on remet en service. Le reste de la feuille ne
   * porte que des liens, pour que ce bouton-la reste le geste du jour.
   */
  #verbs(set, attrs) {
    const el = document.createElement("div");
    el.className = "verbs";
    const on = axesOf(set);
    // Strictement « pair », et non « pas all » : un essieu inconnu — vieux
    // capteur — se traite comme un train de quatre, la regle prudente que
    // `axleOf` s'est donnee. Le coordinateur tranche de toute facon d'apres
    // la fiche reelle.
    const pair = axleOf(set, attrs) === "pair";

    if (set.retired) {
      el.appendChild(
        this.#button(
          t("act.restore"),
          "mdi:archive-arrow-up-outline",
          "primary",
          () => {
            // `id` et non le libelle : le libelle est facultatif et deux
            // fiches dupliquees peuvent le partager — l'id, lui, ne designe
            // qu'un train, et `find()` cote Python le lit en premier.
            this.#run(
              "restore",
              { tyre_set: set.id },
              t("msg.restored", { name: nameOf(set) })
            );
          }
        )
      );
      return el;
    }

    if (!on.length) {
      if (!pair) {
        el.appendChild(
          this.#button(t("act.mount_all"), "mdi:swap-horizontal", "primary", () =>
            this.#ask("mount")
          )
        );
        return el;
      }
      // L'essieu libre passe devant : c'est le montage qui ne depose rien.
      const free = AXES.find((axis) => !fittedAt(attrs, axis)) ?? "front";
      for (const axis of AXES) {
        el.appendChild(
          this.#button(
            t("act.mount_at", { position: POSITIONS[axis].toLowerCase() }),
            "mdi:swap-horizontal",
            axis === free ? "primary" : "",
            () => this.#ask("mount", axis)
          )
        );
      }
      return el;
    }

    if (!pair) {
      // Une permutation ne change aucun kilometrage : elle repart le rappel et
      // fait suivre les capteurs de pression a leur roue.
      el.appendChild(
        this.#button(
          t("act.rotate"),
          "mdi:rotate-3d-variant",
          set.rotation_due ? "primary" : "",
          () => {
            if (attrs.odometer_auto === true) {
              this.#run("rotate", { tyre_set: set.id }, t("msg.rotated"));
            } else {
              this.#ask("rotate");
            }
          }
        )
      );
    } else {
      const other = AXES.find((axis) => !on.includes(axis));
      if (other) {
        el.appendChild(
          this.#button(
            t("act.move_to", { position: POSITIONS[other].toLowerCase() }),
            "mdi:swap-horizontal",
            "",
            () => this.#ask("mount", other)
          )
        );
      }
    }

    el.appendChild(
      this.#button(t("act.unmount"), "mdi:arrow-down-circle-outline", "", () =>
        this.#ask("unmount")
      )
    );
    return el;
  }

  /**
   * L'encart de confirmation, a la place des verbes.
   *
   * Il n'apparait que pour les gestes qui demandent une saisie ou qui defont
   * autre chose — c'est le seul endroit ou la carte se permet une phrase, et
   * c'est parce qu'elle y annonce une consequence.
   */
  #confirm(set, attrs) {
    const el = document.createElement("div");
    el.className = "confirm" + (["retire", "delete"].includes(this.#mode) ? " danger" : "");

    const say = document.createElement("div");
    say.className = "say";
    el.appendChild(say);

    const acts = document.createElement("div");
    acts.className = "acts";

    const cancel = this.#button(t("act.cancel"), null, "", () => this.#ask(null));

    // Le compteur ne se demande que lorsqu'aucun capteur ne le donne. C'est la
    // regle du flux, et c'est le dernier moment ou l'on peut dire a qui
    // reviennent les derniers kilometres.
    const auto = attrs.odometer_auto === true;
    let odo = null;
    const askOdo = () => {
      if (auto) return;
      const row = document.createElement("div");
      row.className = "fld";
      const label = document.createElement("span");
      label.textContent = t("field.odometer");
      odo = document.createElement("input");
      odo.type = "number";
      odo.value = Math.round(Number(attrs.odometer) || 0);
      odo.setAttribute("aria-label", t("sheet.reading"));
      const unit = document.createElement("span");
      unit.textContent = "km";
      row.append(label, odo, unit);
      el.appendChild(row);
    };
    const reading = () => {
      // Pas de `|| undefined` : un releve a 0 km est une valeur, pas un vide.
      if (!odo || odo.value.trim() === "") return undefined;
      const n = Number(odo.value);
      return Number.isFinite(n) ? n : undefined;
    };

    if (this.#mode === "adjust") {
      say.textContent =
        t("sheet.adjust_note");
      const row = document.createElement("div");
      row.className = "fld";
      const label = document.createElement("span");
      label.textContent = t("field.total");
      const input = document.createElement("input");
      input.type = "number";
      input.value = Math.round(Number(set.km) || 0);
      input.setAttribute("aria-label", t("sheet.set_total"));
      const unit = document.createElement("span");
      unit.textContent = "km";
      row.append(label, input, unit);
      el.appendChild(row);

      acts.append(
        this.#button(t("act.confirm"), null, "primary", () => {
          this.#run(
            "adjust",
            { tyre_set: set.id, total: Number(input.value) || 0 },
            t("msg.adjusted")
          );
        }),
        cancel
      );
      el.appendChild(acts);
      return el;
    }

    if (this.#mode === "delete") {
      say.append(
        document.createTextNode(t("delete.head") + " "),
        bold(km(set.km)),
        document.createTextNode(" " + t("delete.tail"))
      );
      acts.append(
        this.#button(t("act.delete"), "mdi:trash-can-outline", "danger", () =>
          this.#deleteSet(set)
        ),
        cancel
      );
      el.appendChild(acts);
      return el;
    }

    if (this.#mode === "retire") {
      say.append(
        bold(km(set.km)),
        document.createTextNode(
          " " + t("retire.tail")
        )
      );
      askOdo();
      acts.append(
        this.#button(t("act.retire"), "mdi:archive-outline", "danger", () => {
          this.#run(
            "retire",
            { tyre_set: set.id, odometer: reading() },
            t("msg.retired")
          );
        }),
        cancel
      );
      el.appendChild(acts);
      return el;
    }

    if (this.#mode === "rotate") {
      say.textContent =
        t("sheet.rotate_note");
      askOdo();
      acts.append(
        this.#button(t("act.rotate"), "mdi:rotate-3d-variant", "primary", () => {
          this.#run(
            "rotate",
            { tyre_set: set.id, odometer: reading() },
            t("msg.rotated")
          );
        }),
        cancel
      );
      el.appendChild(acts);
      return el;
    }

    if (this.#mode === "unmount") {
      const on = axesOf(set);
      say.textContent =
        t("sheet.unmount_note");
      askOdo();
      acts.append(
        this.#button(t("act.unmount"), "mdi:arrow-down-circle-outline", "primary", () => {
          this.#run(
            "unmount",
            {
              // Un train de 4 libere les deux essieux : nommer le sien serait
              // demander d'en deposer la moitie, ce qui n'existe pas.
              position: axleOf(set, attrs) === "all" ? undefined : on[0],
              odometer: reading(),
            },
            t("msg.unmounted")
          );
        }),
        cancel
      );
      el.appendChild(acts);
      return el;
    }

    // Reste le montage. L'essieu vise est dans `#arg` — absent pour un train de
    // quatre, qui prend les deux quoi qu'on demande.
    const axis = this.#arg;
    say.append(
      document.createTextNode(
        axis
          ? t("sheet.mount_at", { position: POSITIONS[axis].toLowerCase() })
          : t("sheet.mount_all") + " "
      )
    );

    // Ce que ce montage defait. Un train de quatre prend les deux essieux, et
    // peut donc en deposer deux d'un coup ; une paire ne vise que le sien.
    // Les deux cas se disent avant, plutot que de se faire en silence.
    const touched = axis ? [axis] : AXES;
    const leaving = [
      ...new Map(
        touched
          .map((slot) => fittedAt(attrs, slot))
          .filter((other) => other && other.id !== set.id)
          .map((other) => [other.id, other])
      ).values(),
    ];

    // Une voiture porte soit un train de quatre, soit deux paires — jamais un
    // melange : poser une paire sur un train de quatre l'emporte tout entier,
    // l'autre essieu compris.
    const whole = axis && leaving.find((other) => axleOf(other, attrs) === "all");
    if (whole) {
      say.append(
        document.createTextNode(t("punct.open")),
        bold(nameOf(whole)),
        document.createTextNode(
          " " + t("mount.displaces_all")
        )
      );
    } else if (leaving.length) {
      say.append(document.createTextNode(t("punct.open")));
      leaving.forEach((other, i) => {
        if (i) say.append(document.createTextNode(t("punct.and")));
        say.append(bold(nameOf(other)));
      });
      say.append(
        document.createTextNode(
          leaving.length > 1
            ? " " + t("mount.displaced_many")
            : " " + t("mount.displaced_one")
        )
      );
    }

    askOdo();
    acts.append(
      this.#button(t("act.mount"), "mdi:swap-horizontal", "primary", () => {
        this.#run(
          "mount",
          {
            tyre_set: set.id,
            position: axis ?? undefined,
            odometer: reading(),
          },
          t("msg.mounted")
        );
      }),
      cancel
    );
    el.appendChild(acts);
    return el;
  }

  /**
   * Les trois blocs, groupes par ce qu'ils touchent.
   *
   * Ce qui est ecrit sur le pneu, ce qui le mesure, ce qui le compte. Chacun
   * dit son etat et n'offre qu'un verbe : c'est ce decoupage qui loge les
   * capteurs de pression sans rallonger aucune liste de boutons.
   */
  #blocks(set, attrs) {
    const out = [];

    const fiche = [
      set.size,
      dotLabel(set),
      cost(set),
      set.storage ? t("card.stored_at", { place: set.storage }) : null,
    ].filter(Boolean);
    out.push(
      this.#block(t("block.record"), fiche.join(" · ") || t("block.record_empty"), t("act.edit"), () =>
        this.#openStep("edit", { setId: set.id, done: t("msg.record_saved") })
      )
    );

    const tpms = set.tpms && typeof set.tpms === "object" ? set.tpms : {};
    const wheels = Object.values(tpms);
    const reads = wheels
      .map((wheel) => (wheel.pressure == null ? null : `${trim(wheel.pressure)}`))
      .filter(Boolean);
    out.push(
      this.#block(
        t("block.sensors"),
        wheels.length
          ? (wheels.length > 1
              ? t("block.n_sensors", { n: wheels.length })
              : t("block.one_sensor")) +
              (reads.length ? ` — ${reads.join(" · ")} ${wheels[0].unit ?? "bar"}` : "")
          : t("block.sensors_none"),
        wheels.length ? t("act.edit") : t("act.attach"),
        () => this.#openStep("tpms", { setId: set.id, done: t("msg.sensors_saved") }),
        !wheels.length
      )
    );

    const count = [t("block.total_of", { km: km(set.km) })];
    if (set.km_since_rotation != null && axleOf(set, attrs) === "all" && !set.retired) {
      count.push(t("block.count_rotation", { km: km(set.km_since_rotation) }));
    }
    out.push(
      this.#block(t("block.count"), count.join(", "), t("act.correct"), () => this.#ask("adjust"))
    );

    return out;
  }

  #block(title, body, verb, onClick, muted = false) {
    const el = document.createElement("div");
    el.className = "tblock";

    const head = document.createElement("div");
    head.className = "hd";
    const ttl = document.createElement("span");
    ttl.className = "ttl";
    ttl.textContent = title;
    head.append(ttl, this.#link(verb, "", onClick));

    const bd = document.createElement("div");
    bd.className = "bd" + (muted ? " none" : "");
    bd.textContent = body;

    el.append(head, bd);
    return el;
  }

  #link(label, variant, onClick) {
    return linkButton(label, variant, onClick);
  }

  /**
   * Le rare et le consequent, en fin de feuille.
   *
   * Dupliquer, separer, classer, supprimer : quatre gestes qu'on fait une fois
   * dans la vie d'un train. En liens et non en boutons — ils se lisent encore,
   * mais on ne s'appuie pas dessus par megarde.
   */
  #more(set, attrs) {
    const el = document.createElement("div");
    el.className = "tmore";

    // Dupliquer part d'une fiche existante : c'est ce a quoi ressemble le
    // rachat de la meme reference, ou l'ajout d'une seconde paire identique.
    el.appendChild(
      this.#link(t("sheet.duplicate"), "", () =>
        this.#openStep("duplicate", { setId: set.id, done: t("msg.duplicated") })
      )
    );

    if (axleOf(set, attrs) === "all" && !set.retired) {
      el.appendChild(
        this.#link(t("sheet.separate"), "", () =>
          this.#openStep("separate", {
            setId: set.id,
            done: t("msg.separated", { name: nameOf(set) }),
          })
        )
      );
    }

    if (!set.retired) {
      el.appendChild(
        this.#link(t("act.retire"), "", () => this.#ask("retire"))
      );
    }

    el.appendChild(this.#link(t("act.delete_set"), "danger", () => this.#ask("delete")));
    return el;
  }

  /**
   * La hauteur annoncee, en rangees de 50 px.
   *
   * Elle etait constante : une carte d'un jeu et une carte de six pesaient
   * pareil, et la mise en page en colonnes les equilibrait de travers.
   */
  getCardSize() {
    const attrs = this.#seen?.[this.#config?.entity]?.attributes ?? {};
    const sets = Array.isArray(attrs.sets) ? attrs.sets.length : 0;
    const corners = Object.keys(attrs.pressures ?? {}).length;
    return 2 + (corners ? 2 : 0) + Math.ceil(sets * 1.1);
  }

  /**
   * La place dans une vue « sections », ou l'on pose une carte sur 1 a 12
   * colonnes. Sans cela elle recevait un bloc par defaut et se redimensionnait
   * mal — et c'est la disposition proposee par defaut depuis 2024.11.
   */
  getGridOptions() {
    return {
      columns: 12,
      min_columns: 3,
      rows: this.getCardSize(),
      min_rows: 3,
    };
  }
}

/* ---------- editeurs ---------- */

const ENTITY_SCHEMA = [
  { name: "entity", selector: { entity: { integration: "tyre_tracker", domain: "sensor" } } },
  { name: "advice_entity", selector: { entity: { domain: "binary_sensor" } } },
];

/* Des fonctions et non des objets : un libelle fige au chargement du module
   resterait dans la langue devinee alors, quand bien meme `hass` en annoncerait
   une autre juste apres. */
const BADGE_LABELS = () => ({
  entity: t("editor.entity"),
  advice_entity: t("editor.advice"),
  pressures: t("editor.pressures"),
});

const CARD_LABELS = () => ({ ...BADGE_LABELS(), title: t("editor.title") });

/* La grille des pressions n'appartient qu'a la pastille : la carte les montre
   toujours, et avec le detail que la pastille n'a pas la place de porter. */
defineEditor(
  "floor-tyres-badge-editor",
  [...ENTITY_SCHEMA, { name: "pressures", selector: { boolean: {} } }],
  BADGE_LABELS
);
defineEditor(
  "tyres-card-editor",
  [...ENTITY_SCHEMA, { name: "title", selector: { text: {} } }],
  CARD_LABELS
);

/* ---------- enregistrement ---------- */

// Gardes contre le double chargement : une ressource Lovelace ajoutee a la
// main en plus de celle de l'integration chargerait le module deux fois, et
// un second `define` du meme nom tue le script entier.
if (!customElements.get("floor-tyres-badge")) {
  customElements.define("floor-tyres-badge", FloorTyresBadge);
}
if (!customElements.get("tyres-card")) {
  customElements.define("tyres-card", TyresCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "tyres-card")) {
  window.customCards.push(
    {
      type: "tyres-card",
      name: "Tyres Card",
      description: t("editor.card_desc"),
      preview: false,
    },
    {
      type: "floor-tyres-badge",
      name: "Floor Tyres Badge",
      description: t("editor.badge_desc"),
      preview: false,
    }
  );
}
