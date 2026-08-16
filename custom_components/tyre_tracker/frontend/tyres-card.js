/*!
 * tyres-card        — a vehicle's tyre stock, and the manoeuvres done to it.
 * floor-tyres-badge — the same state, shrunk to a floor-plan badge.
 *
 * Both elements live in this file because they read the same entity — the
 * "Tyres" sensor of the tyre_tracker component — and the badge is only the
 * card seen from a distance.
 *
 * They replace the streamline template `floor_pneus_planxy_v2`, a
 * mushroom-chips-card stripped bare by a dozen `!important` rules, whose six
 * Jinja expressions tested `binary_sensor.snowtire` — an entity that was never
 * created, so the condition was always false and the badge read "Summer" for
 * ever. The popup, for its part, stacked two mushroom-title-card, two grid and
 * four numberbox-card to edit four of the six counters that existed.
 *
 * Everything shown comes from a single attribute: `sets` carries a complete
 * record per set, `fitted` says what is on the front and on the rear. One
 * read, no arithmetic on the card side — the live mileage is already resolved
 * by the coordinator, the only thing that knows the mount odometer.
 *
 * What is written goes through the component's services, and only when it is a
 * manoeuvre: fit, remove, rotate, file away, correct the count. Those are done
 * with the car in front of one, from the row that shows the set they concern.
 *
 * A record is not written here. The card used to draw those forms too, driving
 * the integration's options flow over REST without ever showing its screens —
 * reading a step's schema to know what to ask, posting back under the same
 * names. The flow is gone: what it described is written once in
 * `websocket_api.py` and given shape once in the editor panel served at
 * /tyre-tracker, which shows the whole car at a time where a flow could only
 * ever show one step. The card links to it, naming the vehicle and the set in
 * the address so the page opens where the gesture pointed.
 *
 * The file is delivered by the component itself (custom_components/
 * tyre_tracker/frontend/), which serves it at /tyre_tracker_frontend/tyres-card.js
 * and registers it in the Lovelace resources: installing the integration is the
 * whole setup, nothing to copy into www/. It is therefore self-contained — the
 * five utilities the cards under www/floorplan/ share through `common.js` are
 * copied below rather than imported, because a card distributed by HACS cannot
 * depend on a file belonging to the user's configuration.
 *
 * Written in plain JS (no build, no dependency).
 */

/* ---------- utilities (taken from www/floorplan/common.js) ---------- */

/** The console banner. */
function banner(name, version) {
  console.info(
    `%c 🙂 ${name} %c v${version} %c`,
    "background:#2196F3;color:white;padding:2px 8px;border-radius:3px 0 0 3px;font-weight:bold",
    "background:#4CAF50;color:white;padding:2px 8px;border-radius:0 3px 3px 0",
    "background:none"
  );
}

/**
 * Perform an element's action, whatever it is.
 *
 * Every shape Lovelace knows is here, including those neither card uses yet:
 * it is the only way a configured action does what it says rather than falling
 * back silently on `more-info`.
 *
 * `fire-dom-event` leaves as `ll-custom`, the channel browser_mod listens on:
 * the card therefore does not have to know about browser_mod, and the popup's
 * configuration stays in the YAML. `toggle` on a button becomes a `press`:
 * `homeassistant.toggle` can do nothing with a `button`.
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
      // A configuration URL is still a URL: `javascript:` would run in the
      // page. Only what navigates is opened.
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
      // The target is a fourth argument, not service data: an entity_id
      // passed as data still works by inheritance, an area_id or a
      // device_id would be dropped without a word.
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
 * The style sheet of a floor-plan badge.
 *
 * Floor-plan badges are not cards: they have neither ha-card nor theme
 * background, and have to stay the size of their text — it is the
 * picture-elements `style` key that places them, and its `translate: -50%
 * -100%` only lands right if the box does not lie about its size.
 *
 * `dashed` is left to the shutters: it is their signature on the plan, and
 * sharing it would make it ordinary. The other badges carry a solid stroke.
 */
function planBadgeStyle({ dashed = false } = {}) {
  return `
  :host {
    display: inline-block;
    --badge-color: #fff;
    /* The \`icon\` elements of the neighbouring streamline templates set
       \`rgba(102, 102, 102, 0.7)\`. The badge goes darker: they hold nothing but
       an icon, it carries text, and a mid grey under 13 px of white gives
       nothing to lift it off a pale wall.

       To adjust: the first triplet is the shade (0 = black), the last number
       the opacity. Raising the opacity hides the plan, lowering the shade
       darkens without covering it. */
    --badge-background: rgba(51, 51, 51, 0.75);
  }

  .badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: 1px ${dashed ? "dashed" : "solid"} var(--badge-color);
    /* The background is unconditional rather than tied to how pale what lies
       under it is: the badge floats over a plan where a light roof and a dark
       wall touch, and one badge may straddle both.

       \`padding-box\` stops it at the inner edge of the stroke: by default a
       background runs under the border and shows through the gaps of a dashed
       one. */
    background: var(--badge-background);
    background-clip: padding-box;
    /* Without a radius the background makes a hard rectangular plate in the
       middle of a projected drawing. Four pixels are enough to soften it. */
    border-radius: 4px;
    white-space: nowrap;
    color: var(--badge-color);
    font-family: var(--paper-font-body1_-_font-family, inherit);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    /* The background being translucent, the contrast stays low on a very pale
       roof: the drop shadow keeps its part, as a support. */
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

  /* An overflowing hit area. The label is some twenty pixels tall, well under
     the 24 px minimum of WCAG 2.2, and it is aimed at with a finger on a plan
     where nothing is enlarged. The overflow goes through a pseudo-element
     rather than through padding: the badge keeps its size, so its isometric
     placement stays right. */
  .badge::after {
    content: "";
    position: absolute;
    inset: -7px -6px;
  }

  /* ha-icon carries no sizing rule on its host: everything lives on the
     ha-svg-icon it contains, which is inline-level. Without \`flex\` it makes a
     line box sized by the inherited line-height and the glyph overflows
     upwards. */
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

  /* The label renders the descender "Fermé" does not use, failing which its
     ink looks higher than the centre of the icons. */
  .label {
    display: block;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }
`;
}

/**
 * An `ha-form` editor for a card, built from its schema.
 *
 * The configuration handed back starts from the one received: the form knows
 * nothing of `type` and `view_layout`, which have to survive an edit.
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
 * Home Assistant reassigns `hass` at every state change in the house, but
 * reuses the state object of entities that have not moved: a reference
 * comparison per entity therefore discards, in a handful of instructions,
 * every push that does not concern us — very nearly all of them.
 *
 * `seen` is a table held by the caller, updated in passing.
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

/* ---------- the words ----------

   A Lovelace card cannot read `strings.json`: the categories Home Assistant
   serves to the browser are fixed, and none of them houses a card's prose. It
   therefore carries its own dictionary, as every distributed card does.

   The language comes from `hass.locale.language`, the one the user chose for
   themselves — and not the server's, which names the devices and composes the
   states on the Python side. Two people looking at the same dashboard each
   read it in their own.

   English is the fallback, key by key: an incomplete translation lets an
   English word through in the middle of a French sentence, which is seen and
   corrected, where a bare key cannot be read at all. */

const WORDS = {
  en: {
    "editor.entity": "“Tyres” sensor",
    "msg.restored": "“{name}” put back into service.",
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
    "act.cancel": "Cancel",
    "act.close": "Close",
    "act.save": "Save",
    "act.edit": "Edit",
    "act.attach": "Attach",
    "act.correct": "Correct",
    "act.mount": "Fit",
    "act.mount_all": "Fit all 4",
    "act.unmount": "Remove",
    "act.rotate": "Rotate",
    "act.restore": "Put back into service",
    "act.retire": "Move to history",
    "act.editor": "Open the editor",
    "act.update_odometer": "Update the odometer…",
    "act.card_options": "Card options",
    "sheet.odometer": "Vehicle odometer",
    "sheet.odometer_note": "The total read on the dashboard. Every set's mileage follows from it, so it can only go up.",
    "sheet.reading": "Odometer reading",
    "sheet.set_total": "Set's total mileage",
    "sheet.adjust_note": "What you write here becomes its total, and the count starts again from there. Nothing else moves.",
    "sheet.rotate_note": "Each wheel moves to the other end of its side. The mileage does not change: only the reminder starts again, and the sensors follow their wheel.",
    "sheet.unmount_note": "This set's count stops here. The kilometres it covered stay its own.",
    "sheet.mount_all": "Fit all four wheels.",
    "help.odo_dashboard": "Enter the total read on the dashboard.",
    "help.odo_nothing": "No kilometre added.",
    "msg.odometer_saved": "Odometer saved.",
    "msg.rotated": "Rotation recorded.",
    "msg.adjusted": "Total corrected.",
    "msg.retired": "Set moved to the history.",
    "msg.unmounted": "Set removed.",
    "msg.mounted": "Set fitted.",
    "retire.tail": "will be frozen. The set stays readable, filed in the history, and can no longer be fitted.",
    "mount.displaces_all": "” comes off entirely — half a set of four is not a set of four.",
    "mount.displaced_many": "” will come off, and their count closed at that reading.",
    "mount.displaced_one": "” will come off, and its count closed at that reading.",
    "editor.advice": "Rotation advice (snowtire)",
    "editor.pressures": "TPMS pressures under the badge",
    "editor.image": "Car photo or brand logo (URL, optional)",
    "editor.title": "Card title (default: the vehicle)",
    "editor.card_desc": "A vehicle's tyre fleet: state, fitting, removal, retirement",
    "editor.badge_desc": "Tyre badge for an isometric floor plan",
    "field.odometer": "Odometer",
    "field.total": "Total",
    "act.back": "Back",
    "act.confirm": "Confirm",
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
    "status.available": "Available",
    "block.one_sensor": "1 sensor",
    "block.n_sensors": "{n} sensors",
    "block.total_of": "{km} in total",
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
    "act.cancel": "Annuler",
    "act.close": "Fermer",
    "act.save": "Enregistrer",
    "act.edit": "Modifier",
    "act.attach": "Associer",
    "act.correct": "Corriger",
    "act.mount": "Monter",
    "act.mount_all": "Monter les 4",
    "act.unmount": "Déposer",
    "act.rotate": "Permuter",
    "act.restore": "Remettre en service",
    "act.retire": "Passer à l'historique",
    "act.editor": "Ouvrir l'éditeur",
    "act.update_odometer": "Mettre à jour le compteur…",
    "act.card_options": "Options de la carte",
    "sheet.odometer": "Compteur du véhicule",
    "sheet.odometer_note": "Le total lu au tableau de bord. Les kilomètres de chaque jeu s'en déduisent : il ne peut que monter.",
    "sheet.reading": "Relevé du compteur",
    "sheet.set_total": "Kilométrage total du train",
    "sheet.adjust_note": "Ce que vous écrivez ici devient son cumul, et le compte repart de là. Rien d'autre ne bouge.",
    "sheet.rotate_note": "Chaque roue passe à l'autre bout de son côté. Le kilométrage ne change pas : seul le rappel repart, et les capteurs suivent leur roue.",
    "sheet.unmount_note": "Le compte de ce train s'arrête ici. Les kilomètres parcourus lui restent acquis.",
    "sheet.mount_all": "Monter les quatre roues.",
    "help.odo_dashboard": "Entrez le total lu au tableau de bord.",
    "help.odo_nothing": "Aucun kilomètre ajouté.",
    "msg.odometer_saved": "Compteur enregistré.",
    "msg.rotated": "Permutation enregistrée.",
    "msg.adjusted": "Cumul corrigé.",
    "msg.retired": "Train passé à l'historique.",
    "msg.unmounted": "Train déposé.",
    "msg.mounted": "Train monté.",
    "retire.tail": "seront figés. Le train restera consultable, rangé dans l'historique, et ne pourra plus être monté.",
    "mount.displaces_all": "» sera entièrement déposé — la moitié d'un train de 4 n'est pas un train de 4.",
    "mount.displaced_many": "» seront déposés, et leur compte arrêté au relevé.",
    "mount.displaced_one": "» sera déposé, et son compte arrêté au relevé.",
    "editor.advice": "Conseil de permutation (snowtire)",
    "editor.pressures": "Pressions TPMS sous la pastille",
    "editor.image": "Photo de la voiture ou logo de marque (URL, facultatif)",
    "editor.title": "Titre de la carte (par défaut : le véhicule)",
    "editor.card_desc": "Parc de pneumatiques d'un véhicule : état, montage, dépose, retrait",
    "editor.badge_desc": "Pastille de pneumatiques pour plan isométrique",
    "field.odometer": "Compteur",
    "field.total": "Cumul",
    "act.back": "Retour",
    "act.confirm": "Valider",
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
    "status.available": "Disponible",
    "block.one_sensor": "1 capteur",
    "block.n_sensors": "{n} capteurs",
    "block.total_of": "{km} au total",
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

/** "fr-CA" has no dictionary: its base language has one, and that is the answer. */
function pickLanguage(want) {
  const asked = String(want || "en");
  const base = asked.split("-")[0];
  return WORDS[asked] ? asked : WORDS[base] ? base : "en";
}

/**
 * The reader's language.
 *
 * Guessed at load time from the page's `lang` attribute, because some things
 * are said before any `hass` has arrived: the description the card picker
 * shows, the editor's labels. Then confirmed by `hass.locale`, which carries
 * the person's explicit choice rather than their browser's.
 */
let LANG = pickLanguage(
  (typeof document !== "undefined" && document.documentElement?.lang) ||
    (typeof navigator !== "undefined" && navigator.language)
);

/** Set at every state push, before anything is drawn. */
function setLanguage(hass) {
  LANG = pickLanguage(hass?.locale?.language || hass?.language || LANG);
}

/** A word, and what is slipped between its braces. */
function t(key, ph) {
  const said = WORDS[LANG]?.[key] ?? WORDS.en[key] ?? key;
  return ph ? said.replace(/\{(\w+)\}/g, (whole, name) => ph[name] ?? whole) : said;
}

/* ---------- card ---------- */

/**
 * The version, read off the address this module arrived by.
 *
 * The integration registers the resource as `?v=<manifest version>` — that
 * suffix is what invalidates the browser cache at every upgrade — and
 * `import.meta.url` carries the address verbatim. Written out here, the
 * version had to be bumped in two places, and the console banner ended up
 * announcing a version the file no longer was.
 *
 * "dev" when there is none: a resource added by hand in YAML mode, or the file
 * opened directly. Not an error, only an address without a number.
 */
const CARD_VERSION = (() => {
  try {
    return new URL(import.meta.url).searchParams.get("v") || "dev";
  } catch {
    return "dev";
  }
})();
banner("Tyres Card", CARD_VERSION);

/* ---------- configuration ----------

   The badge, placed in a picture-elements:

     type: custom:floor-tyres-badge
     entity: sensor.alfa_pneumatiques
     advice_entity: binary_sensor.snowtire   optional, rotation advice
     pressures: true                         optional, 2x2 TPMS grid underneath
     image: /local/alfa.png                  optional, car photo or brand logo
     tap_action: { ... }                     optional, default: the popup below
     style: { top: 40%, left: 62%, transform: ... }

   The card, in a view or a popup:

     type: custom:tyres-card
     entity: sensor.alfa_pneumatiques
     title: Alfa GT                          optional, default: the vehicle  */

/** The component's service, aimed at the sensor that carries the state. */
const DOMAIN = "tyre_tracker";

/**
 * The editor's address, served by the component itself.
 *
 * Everything that is written down rather than done — the records, the sensors,
 * the vehicle's own settings — is edited there. The card points at it and adds
 * what it knows to the address, so the page opens on the right car and, when a
 * set was touched, on that set.
 */
const PANEL_PATH = "tyre-tracker";

/**
 * The three markings of a sidewall, and the shade that goes with each.
 *
 * The sun is `white-balance-sunny` and not `weather-sunny`: the latter draws a
 * ring, and a ring shrunk to the 15 px of a floor-plan badge weighs no more
 * than a snowflake. A filled disc against an open star is a difference of
 * mass — it survives any size, and on the badge, where everything is white,
 * the shade comes to nobody's rescue.
 */
/* The shades are the theme's, not ours. Home Assistant publishes a palette
   every theme redefines: using it is following the interface instead of
   setting three colours down beside it. The fallback value keeps the intended
   look on a core that would not know the token yet.

   The consequence, and it is the point: `tint` is no longer a hex string.
   Nothing may append an opacity suffix to it any more — what derives from it
   is computed in CSS, where a shade stays a colour. */
/* The words are accessors and not values. A table built when the module loads
   freezes the language guessed at that instant: `hass` arrives afterwards, and
   somebody may change theirs without reloading the page. An icon and a shade,
   for their part, speak no language and stay values. */
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

/* "2 wheels" and not "pair": it is the configuration flow's word, and a set
   has to read the same way everywhere — on the badge, in the list, in the
   sheet and in the form where it is edited. */
const AXLES = {
  get all() {
    return t("axle.all");
  },
  get pair() {
    return t("axle.pair");
  },
};

/* The same quantity, as an icon. It was chosen already — the configuration
   form shows these two — but it stopped at the form: the card body wrote
   "4 wheels", the floor-plan badge "×4". Three dialects for one fact, against
   the rule this file gives itself further up.

   The word does not disappear for all that: it becomes the accessible name,
   therefore what a screen reader reads and what the tooltip says. */
const AXLE_ICONS = {
  all: "mdi:numeric-4-box-outline",
  pair: "mdi:numeric-2-box-outline",
};

/** A set's quantity icon, or nothing when the axle is unknown. */
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

/* The reading order of a car seen from above: front at the top, left on the
   left. The pressure grid follows this list and has nothing to sort. */
const CORNERS = ["front_left", "front_right", "rear_left", "rear_right"];

/* The same corners spelt out. The form abbreviates them — "FL", a three-letter
   word under a box — but a tooltip and a screen reader do not read initials:
   they say where the wheel is. */
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

/* The same corners as initials, for the boxes where three letters are enough.
   Accessors, as everywhere: the reader's language may change after the module
   has loaded. */
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

/** A readable number: two decimals at most, and no zero for nothing. */
const trim = (n) =>
  Number.isFinite(Number(n))
    ? Number(Number(n).toFixed(2)).toLocaleString(LANG)
    : "—";

/** "42 €/1000 km" — the figure that compares two references against each other. */
const cost = (set) =>
  Number.isFinite(Number(set?.cost_per_1000km))
    ? `${trim(set.cost_per_1000km)} €/1000 km`
    : null;

/**
 * How long a sensor has been silent — "12 min", "5 h", "3 d".
 *
 * The component has carried the date of the last reading all along; the card
 * made no use of it, and greyed the wheel out without saying how old the
 * figure it left on screen was. That is the whole difference between a low
 * pressure and the day before yesterday's pressure.
 */
function sinceLabel(iso) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  // "min" and "h" read the same in both languages; the day does not — "j" in
  // French, "d" in English — so that one alone goes through the dictionary.
  return hours < 48
    ? `${hours} h`
    : `${Math.round(hours / 24)} ${t("unit.days_short")}`;
}

/** A set's season, or the "history" mark that overrides it. */
const look = (set) => (set?.retired ? RETIRED : SEASONS[set?.season] ?? SEASONS.summer);

/**
 * The date code, as it reads, followed by the age it gives.
 *
 * Four digits: the week, then the year. The raw code stays on screen because
 * it is what one finds on the sidewall when checking; the age keeps it company
 * because a tyre ages standing still and no counter sees it go by. Nothing
 * more: the component does not say when to change, it says what is written and
 * how long ago.
 */
function dotLabel(set) {
  const parsed = /^(\d{2})(\d{2})$/.exec(String(set?.dot ?? ""));
  if (!parsed) return null;

  const week = Number(parsed[1]);
  const raw = `DOT ${set.dot}`;
  if (week < 1 || week > 53) return raw;

  // The Monday of that week, give or take a handful of days: enough for
  // an age expressed in whole years.
  const made = new Date(2000 + Number(parsed[2]), 0, 1 + (week - 1) * 7);
  const years = Math.floor((Date.now() - made.getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years < 0) return raw;
  const age = years <= 1 ? t("unit.years_one", { n: years }) : t("unit.years_many", { n: years });
  return `${raw} (${age})`;
}

/** An `ha-icon` built by the DOM: the name comes from our tables, never from a state. */
function makeIcon(name) {
  const el = document.createElement("ha-icon");
  el.setAttribute("icon", name);
  return el;
}

/** The set fitted at a position, from the `fitted` attribute. */
const fittedAt = (attrs, position) => attrs?.fitted?.[position] ?? null;

/**
 * How many tyres this set is: "all" or "pair", and nothing when it is unknown.
 *
 * The entries of `fitted` carry the axle, but they have not always carried it,
 * and a card held in the browser cache may be talking to an older integration
 * — that is even the rule while an upgrade finishes going through. `sets`
 * holds the same information and travels in the same attribute: reading it
 * back costs a `find`, against a wrong count displayed with confidence. And
 * failing both, we say nothing rather than assume a pair.
 */
const axleOf = (set, attrs) =>
  set?.axle ?? attrs?.sets?.find((other) => other.id === set?.id)?.axle ?? null;

/** The axles a set occupies, as keys — "front", "rear". */
const axesOf = (set) =>
  (Array.isArray(set?.positions) ? set.positions : []).filter((p) => AXES.includes(p));

/**
 * A set's state in one line, the one that opens each of its screens.
 *
 * The same sentence as the one built in Python for the flow — number of tyres,
 * kilometres, where it stands. A set has to present itself the same way whether
 * it is opened from the card or from Settings, failing which one doubts having
 * opened the right one.
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

/** A set's name, as one speaks to it. */
const nameOf = (set) => set?.label || set?.reference || t("card.set_fallback");

/** A fragment in bold, for the sentences that announce a consequence. */
function bold(text) {
  const el = document.createElement("b");
  el.textContent = text;
  return el;
}

/* ---------- the floor-plan badge ---------- */

const BADGE_STYLE = `
  ${planBadgeStyle({ dashed: false })}

  /* Two different sets fitted: two lines, one per axle. Electing one of the two
     would be a lie, and joining them on one line would make unreadable what has
     to be read from a distance, on a busy plan. */
  .badge { flex-direction: column; align-items: stretch; gap: 0.15em; }
  .line { display: flex; align-items: center; gap: 0.31em; }

  /* The car itself — a brand logo or a photo, whatever URL the config gives.
     Taken out of the flow entirely: the chip is sized by its text alone, and
     the image fits into whatever height that produced, centred, never adding
     a pixel of its own. In the flow, a tall image would centre the text in
     leftover space — a floating line in a chip twice its size. The reserve on
     the left is fixed so the text column never shifts with the image ratio. */
  .badge.with-car { position: relative; padding-left: 3.7em; }

  /* The set lines, in a zone of their own so it can hold a size. With a car
     in the corner the badge keeps a steady footprint: the zone is always two
     lines tall and a lone set rides centred in it — one set or two, the chip
     is the same, because a badge pinned on a plan should not breathe with
     its content. The pressure grid still adds below, identically either way. */
  .sets {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    gap: 0.15em;
  }
  .badge.with-car .sets { min-height: 2.6em; }
  .car {
    position: absolute;
    left: 0.38em;
    top: 50%;
    transform: translateY(-50%);
    width: 2.9em;
    max-height: calc(100% - 0.6em);
    object-fit: contain;
    /* The light plate is for logos, which are routinely dark line-work and
       would sink into the chip. A photo is opaque and simply keeps a thin
       print border. */
    background: rgba(255, 255, 255, .88);
    border-radius: 0.31em;
    padding: 0.15em;
    box-sizing: border-box;
  }
  .car[hidden] { display: none; }

  /* The season, in colour — the same shade as in the card, taken from the
     theme's tokens. The rest of the line stays white: on a plan, it is the
     set's name one reads, and two colours side by side would fight over the
     eye. The shape goes on carrying the information on its own, for whoever
     cannot tell blue from amber — the colour doubles the reading, it does not
     replace it.

     \`filter\` rather than a drop shadow: a text shadow does not follow the
     outline of an SVG, and an amber snowflake on a pale roof would have lost
     the contour the rest of the badge keeps. */
  ha-icon.season {
    color: var(--tint, var(--badge-color));
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .85));
  }

  /* ---- the pressures, optional ----

     Two columns, two rows: the car seen from above, the same way round as the
     plan. The rule at the top separates without framing — a frame would make a
     second badge under the first, when it is the same object.

     No unit in the boxes. The four share it, writing it four times would double
     the width of the grid for a constant piece of information; it stays in each
     wheel's tooltip, with the name of the corner. */
  .tpms {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.08em 0.6em;
    margin-top: 0.23em;
    padding-top: 0.23em;
    border-top: 1px solid rgba(255, 255, 255, .35);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
  /* Each column tightens towards the axis of the car: the two wheels of one
     axle read as a pair, and two numbers flushed left would have read as a
     list. */
  .wheel { text-align: center; }

  /* A silent sensor: the pressure shown is a memory. Greyed rather than written
     "silent" — the badge has no room for the word, and the detail waits in the
     tooltip. */
  .wheel.stale { opacity: .45; }

  /* A tyre called wrong — by the TPMS itself or by the set's target. Red and
     bold: on a plan, this is the box one has to see from a distance. A flag
     distinct from silence, which greys: 1.4 bar needs air, a dead cell needs a
     sensor. */
  .wheel.alarm { color: #ff6b6b; font-weight: 700; }

  /* The axle, when there is a choice to make — so never for a set of 4. */
  .pos {
    font-size: 0.77em;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding-top: 0.08em;
  }
  /* The quantity: two or four tyres. Discreet, but always there — it is what
     says whether the other axle still carries something else. */
  .qty {
    font-size: 0.77em;
    opacity: .7;
    padding-top: 0.08em;
    font-variant-numeric: tabular-nums;
  }

  /* The set's name. It carries the line: "12,000 km" does not say which of the
     two summer sets ran them, and that is the question one asks in front of a
     plan. Clipped rather than let run — the badge is placed to the pixel on a
     drawing, and a long-winded reference would push it off the bonnet. The
     whole name stays in the tooltip. */
  .name {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The mileage steps back: it is the name one looks for first. */
  .km {
    font-size: 0.92em;
    opacity: .8;
    padding-top: 0.08em;
    font-variant-numeric: tabular-nums;
  }

  /* The rotation advice. A dot, not a word: the badge sits on a busy plan, and
     "it is about time" needs no sentence to be read. The detail is in the
     card. Set in the corner, it holds the same place whether the badge has one
     line or two. */
  .tip {
    position: absolute;
    top: -0.23em;
    right: -0.23em;
    width: 0.54em;
    height: 0.54em;
    border-radius: 50%;
    background: #ffb300;
    box-shadow: 0 0 0.38em rgba(255, 179, 0, .8);
  }
  .tip[hidden] { display: none; }

  /* The pressure alarm, in the corner opposite the advice: a car with a flat
     tyre has to be visible on the plan without opening the popup, even when
     the pressure grid is not shown. Red against amber — one says "it is about
     time", the other says "now". */
  .flat {
    position: absolute;
    top: -0.23em;
    left: -0.23em;
    width: 0.54em;
    height: 0.54em;
    border-radius: 50%;
    background: #ff5252;
    box-shadow: 0 0 0.38em rgba(255, 82, 82, .8);
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
    this.#els = { badge: $(".badge"), tip: $(".tip"), flat: $(".flat"), car: null };

    // Built once with the badge, not on every state push: the element is
    // reused across repaints, so the browser never reloads the image while
    // the odometer chatters. Purely decorative — the name is already spoken.
    if (this.#config.image) {
      const img = document.createElement("img");
      img.className = "car";
      img.src = this.#config.image;
      img.alt = "";
      // A stale URL must not plant the broken-image glyph on the plan: the
      // badge simply tightens back to its text, reserve included.
      img.addEventListener("error", () => {
        img.hidden = true;
        this.#els.badge.classList.remove("with-car");
      });
      this.#els.car = img;
      this.#els.badge.classList.add("with-car");
    }

    const fire = () => this.#fire();
    this.#els.badge.addEventListener("click", fire);
    this.#els.badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      fire();
    });
  }

  /** The default popup: the whole card, on the same entity. */
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
    // Before anything is drawn: the reader's language decides every word set
    // down afterwards, and it can change without the card being rebuilt.
    const spoke = LANG;
    setLanguage(hass);
    if (!this.#config) return;
    const ids = [this.#config.entity];
    if (this.#config.advice_entity) ids.push(this.#config.advice_entity);
    // A language that changes repaints even without a new state: the words on
    // screen are the old one's, and no entity push will come and wash them out.
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

    // One line per set actually fitted. A set of 4 makes one, two distinct sets
    // make two, a lone pair makes one with its axle.
    const lines = [];
    if (same) {
      lines.push({ set: front, positions: ["front", "rear"] });
    } else {
      if (front) lines.push({ set: front, positions: ["front"] });
      if (rear) lines.push({ set: rear, positions: ["rear"] });
    }

    // The list comes from the component, already judged: the TPMS verdict or
    // the set's target, the badge has nothing to work out again.
    const alarmed = attrs.pressure_alarm ?? [];

    // The image lives outside the flow (see `.car`), so the badge stays the
    // single column it always was — with or without a car in the corner. The
    // lines get a zone of their own, which is what holds the two-slot height.
    const sets = document.createElement("div");
    sets.className = "sets";
    this.#els.badge.replaceChildren(
      this.#els.tip,
      this.#els.flat,
      ...(this.#els.car ? [this.#els.car] : []),
      sets
    );
    this.#els.tip.hidden = !advice;
    this.#els.flat.hidden = !alarmed.length;
    if (alarmed.length) this.#els.flat.title = t("card.alarm_title");

    if (!lines.length) {
      // Nothing fitted: the badge says so rather than disappear, failing which
      // one would think it broken.
      sets.appendChild(this.#line(null, [], attrs));
      this.#els.badge.title = t("card.none_fitted");
      this.#els.badge.setAttribute("aria-label", t("card.badge_none"));
      return;
    }

    for (const line of lines) {
      sets.appendChild(this.#line(line.set, line.positions, attrs));
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
   * The four pressures, from the driver's point of view.
   *
   * Two columns, two rows, in the order of `CORNERS`: front at the top, left on
   * the left — FL top left, RR bottom right. This is not the orientation of the
   * plan, which shows the car from another edge, but the one held in mind when
   * speaking of one's wheels, and it is also the card grid's: a badge and a
   * card that contradicted each other would have one read the pressure of one
   * wheel while looking at the other.
   *
   * It is that constancy which lets the corner labels go — on a floor-plan
   * badge, "FL" beside "2.3" would double the width to teach nothing the
   * position does not already say.
   *
   * The four boxes are always there as soon as one sensor exists: showing only
   * the equipped corners would slide a rear wheel into the place of a front
   * one, and the layout would stop meaning anything. A corner without a sensor
   * carries a dash.
   *
   * Nothing at all when no sensor is attached — the badge does not grow an
   * empty frame for a vehicle that has no TPMS.
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

      // Silence is seen rather than written: the badge has no room for the word
      // "silent", and a greyed pressure says well enough that it is old.
      if (read.stale) cell.classList.add("stale");
      // The alarm too: red, not a word. The two can add up — a silent sensor
      // whose dock is still shouting is a tyre to look at.
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

  /** The pressures said out loud, for the accessible label. */
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

  /** "front", "rear", nothing when the set covers all four wheels. */
  #spoken(positions) {
    if (positions.length !== 1) return "";
    return `${POSITIONS[positions[0]].toLowerCase()} `;
  }

  /**
   * One line: the season icon, the axle if there is a choice to make, the set's
   * name, its number of tyres, and its mileage.
   *
   * The axle does not appear for a set of four: there is nothing to tell apart,
   * and writing it would suggest the other axle carries something else. It is
   * the same rule as at fitting, where one is not asked where to put a set of
   * four.
   */
  #line(set, positions, attrs) {
    const el = document.createElement("div");
    el.className = "line";

    // The shade travels through `--tint`, as in the card: it is a theme
    // variable, not a hard-coded colour, and so it follows the active theme.
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

    // The same icon as in the card and in the form. It said "×4" here and
    // "4 wheels" there: a set has to read the same way everywhere.
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

/* ---------- the card ---------- */

/**
 * The portal's veil, made transparent.
 *
 * A modal `dialog` lays down a `::backdrop` the browser darkens. Our sheets
 * have their own already, and the menu wants none — two veils on top of each
 * other would turn the card underneath into a shadow.
 *
 * It is the only rule this file writes outside its shadow roots: `::backdrop`
 * belongs to the document holding the element, and is reachable neither
 * through inline style nor from a shadow root. It is laid down once and
 * carries our class, so it touches nothing else.
 */
function portalBackdrop() {
  const id = "tyres-card-portal-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = ".tyres-card-sheets::backdrop { background: transparent; }";
  document.head.appendChild(style);
}

const FP_FONTS = `
:host {
  --f-base: calc(var(--ha-font-size-s, 14px) * 15 / 14);
  --f-9-5:  calc(var(--f-base) *  9.5 / 14);
  --f-10:   calc(var(--f-base) * 10   / 14);
  --f-10-5: calc(var(--f-base) * 10.5 / 14);
  --f-11:   calc(var(--f-base) * 11   / 14);
  --f-11-5: calc(var(--f-base) * 11.5 / 14);
  --f-12:   calc(var(--f-base) * 12   / 14);
  --f-12-5: calc(var(--f-base) * 12.5 / 14);
  --f-13:   calc(var(--f-base) * 13   / 14);
  --f-14:   var(--f-base);
  --f-15:   calc(var(--f-base) * 15   / 14);
  --f-16:   calc(var(--f-base) * 16   / 14);
  --f-17:   calc(var(--f-base) * 17   / 14);
  --f-20:   calc(var(--f-base) * 20   / 14);
  --f-24:   calc(var(--f-base) * 24   / 14);
  --f-34:   calc(var(--f-base) * 34   / 14);
}
`;

const FP_CONTROLS = `
:host {
  --fp-ok:   var(--success-color, #3E9D6B);
  --fp-warn: var(--warning-color, #B38046);
  --fp-bad:  var(--error-color, #FF554C);
  --fp-info: var(--info-color, #039be5);

  --fp-focus: 2px solid var(--primary-color, #03a9f4);
  --fp-focus-off: 2px;

  --fp-s0: 2px;
  --fp-s1: 4px;
  --fp-sh: 6px;
  --fp-s2: 8px;
  --fp-s3: 12px;
  --fp-s4: 16px;
  --fp-s5: 24px;

  --fp-pill-h: 30px;
  --fp-pill-r: 15px;
  --fp-ctl-h: 40px;
  --fp-ctl-r: 8px;
  --fp-field-r: 4px;
  --fp-round: 40px;
  --fp-round-lg: 48px;
}
`;

const CARD_STYLE = `
  ${FP_FONTS}
  ${FP_CONTROLS}
  ha-card { display: block; overflow: hidden; }
  .body { padding: 0 0 var(--fp-s4); }

  /* ---- what derives from a set's shade ----

     A single setting comes from the JavaScript: \`--tint\`. Everything else is
     computed here, on the same elements — a shade taken from a theme token is
     not a string one appends "22" to.

     The rule bears on the elements that set \`--tint\` themselves, and not on
     the host: a custom property is computed where it is declared, then
     inherited as a value. Declared once at the top, it would give every set
     the same soft shade.

     \`--tint-ink\` mixes the shade towards the theme's ink: it darkens on a
     light background, lightens on a dark one. One formula for both, because it
     is the theme that says where its ink is — and a summer set's icon stops
     sitting at 1.97:1 on a white card. */
  .hero, .row, .tid, .sheet {
    --tint-soft: color-mix(in srgb, var(--tint) 16%, transparent);
    --tint-ink: color-mix(in srgb, var(--tint) 50%, var(--primary-text-color));
  }

  /* ---- the card's header ----

     The car's name, its odometer, and the only way into what aims at no set in
     particular. 16 px and medium weight, and not the 24 px of a Home Assistant
     card title: the protagonist here is the mileage just below, and a title
     heavier than it would invert the reading. */
  .chead {
    display: flex;
    align-items: flex-start;
    gap: var(--fp-s2);
    padding: var(--fp-s4) var(--fp-s2) var(--fp-s3) var(--fp-s4);
  }
  .chead .ct { flex: 1; min-width: 0; }
  .chead .h {
    font-size: var(--f-16);
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -.01em;
  }
  .chead .s {
    margin-top: var(--fp-s0);
    font-size: var(--f-13);
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }
  /* The target is 40 px, the ink much less: discreet without being small. */
  .iconbtn {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    margin-top: -var(--fp-sh);
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

  /* ---- the header answers before it is asked ---- */
  .hero {
    display: flex;
    align-items: flex-start;
    gap: var(--fp-s4);
    padding: var(--fp-s4) var(--fp-s4) var(--fp-s4);
  }
  /* Two blocks as soon as front and rear differ: announcing a single set
     would be false, and nothing further down would put the mistake right. */
  .heroes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--divider-color);
  }
  .heroes .hero { background: var(--card-background-color); padding: var(--fp-s4); }
  .heroes .km { font-size: var(--f-20); }
  .hero .mark {
    flex: 0 0 auto;
    width: 42px;
    height: 42px;
    border-radius: var(--ha-card-border-radius, 12px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 24px;
  }
  .hero .txt { flex: 1; min-width: 0; }
  /* The number of tyres, against the reference it qualifies. In \`em\`: it
     follows the body of the text carrying it, therefore the theme's scale, and
     sits as well in a header as in a list row. */
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
    margin-bottom: var(--fp-s1);
    font-size: var(--f-12);
    font-weight: 700;
    letter-spacing: .5px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .km {
    font-size: var(--f-24);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -.02em;
    font-variant-numeric: tabular-nums;
  }
  .ref { margin-top: var(--fp-s0); font-size: var(--f-14); font-weight: 500; }
  .sub { margin-top: var(--fp-s1); font-size: var(--f-13); color: var(--secondary-text-color); }

  /* ---- rotation advice ----
     An \`ha-alert\`: it is Home Assistant's component for this case, it carries
     its icon, its colour and its contrast already, and it will follow the theme
     without our having to know. All that is left is to place it. */
  .advice { display: block; margin: 0 var(--fp-s4) var(--fp-s4); }
  .advice[hidden] { display: none; }

  /* ---- the pressures, drawn as the car is ---- */
  /* Two columns, two rows: left on the left, front at the top. An aligned list
     would have required rereading the label at every corner, where the layout
     says it on its own. */
  .tpms {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--fp-sh);
    margin: 0 var(--fp-s4) var(--fp-s4);
  }
  .tpms .wheel {
    display: flex;
    align-items: baseline;
    gap: var(--fp-sh);
    padding: var(--fp-s2) var(--fp-s3);
    border-radius: var(--fp-ctl-r);
    background: var(--secondary-background-color);
  }
  .tpms .corner {
    font-size: var(--f-10);
    font-weight: 700;
    letter-spacing: .5px;
    color: var(--secondary-text-color);
  }
  /* The pressure is the datum: it carries the size and the weight. */
  .tpms .p { font-size: var(--f-16); font-weight: 500; font-variant-numeric: tabular-nums; }
  /* The second member, one per wheel only: temperature usually, low battery or
     silence when there is one — see \`#wheelAside\`. */
  .tpms .t {
    display: inline-flex;
    align-items: center;
    gap: .3em;
    margin-left: auto;
    font-size: var(--f-12);
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
    --mdc-icon-size: 14px;
  }
  .tpms .t.alarm { color: var(--fp-warn); }
  /* Red is kept for the tyre called wrong — by the dock or by the target. Amber
     says "the sensor has a problem", red says "the tyre has one": two flags,
     never one. */
  .tpms .t.danger { color: var(--fp-bad); }
  .tpms .wheel.alarm { box-shadow: inset 0 0 0 1px var(--fp-bad); }
  .tpms .wheel.alarm .p { color: var(--fp-bad); }
  /* A dead cell leaves the last value in place and says nothing. The corner is
     therefore greyed rather than showing a three-month-old pressure as though
     it were today's. */
  .tpms .wheel.stale { opacity: .45; }
  .tpms .wheel.stale .p { font-weight: 500; }

  /* ---- the stock ---- */
  .label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fp-s3);
    margin: var(--fp-s1) var(--fp-s4) var(--fp-sh);
    font-size: var(--f-12);
    font-weight: 500;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  /* The count, flushed right like the mileages of the rows it introduces. It is
     only said here: the header carries the odometer, which is what the list
     cannot say about itself. */
  .label .count { font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .row {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    align-items: center;
    gap: var(--fp-s3);
    padding: var(--fp-s2) var(--fp-s4);
    border-top: 1px solid var(--divider-color);
    transition: background 140ms ease;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .row[role="button"] { cursor: pointer; }
  .row[role="button"]:hover { background: var(--secondary-background-color); }
  .row:focus-visible { outline: var(--fp-focus); outline-offset: -2px; }
  .row .ic {
    width: 30px;
    height: 30px;
    border-radius: var(--fp-ctl-r);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 17px;
  }
  .row .name { font-size: var(--f-14); font-weight: 500; line-height: 1.25; }
  .row .meta { font-size: var(--f-12); color: var(--secondary-text-color); }
  .row .val {
    text-align: right;
    font-size: var(--f-14);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .row .state {
    display: block;
    font-size: var(--f-12);
    font-weight: 400;
    color: var(--secondary-text-color);
  }
  /* What calls for a decision. The border and the background carry the colour,
     the text stays at the theme's ink: a chip is noticed by its shape, not by
     painting twelve pixels of height orange. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: .3em;
    margin-top: var(--fp-s1);
    padding: 1px var(--fp-s2);
    border-radius: var(--fp-pill-r);
    font-size: var(--f-12);
    font-weight: 500;
    white-space: nowrap;
    color: var(--primary-text-color);
    border: 1px solid color-mix(in srgb, var(--fp-warn) 55%, transparent);
    background: color-mix(in srgb, var(--fp-warn) 15%, transparent);
    --mdc-icon-size: 13px;
  }
  .pill.quiet {
    border-color: var(--divider-color);
    background: none;
    color: var(--secondary-text-color);
  }
  .pill[title] { cursor: help; }
  /* A comparison, not a gauge: the bar is relative to the set that has run the
     furthest. The component does not know a tyre's life, so the card does not
     pretend to know it either. */
  .bar {
    grid-column: 2 / 4;
    height: 3px;
    border-radius: var(--fp-field-r);
    margin-top: var(--fp-sh);
    background: var(--divider-color);
    overflow: hidden;
  }
  .bar i { display: block; height: 100%; border-radius: var(--fp-field-r); background: var(--tint); }

  .row.is-mounted { background: color-mix(in srgb, var(--tint) 9%, transparent); }
  .row.is-mounted .state { color: var(--primary-text-color); }

  /* In history. Opacity alone was not enough to tell it from a set merely
     available: a hatched background, a rule down the left and a framed status
     are added. Three signals that do not depend on colour, therefore readable
     for whoever does not perceive it. */
  .row.is-retired {
    border-left: 3px solid var(--secondary-text-color);
    padding-left: var(--fp-s3);
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
    margin-top: var(--fp-s0);
    padding: 1px var(--fp-sh);
    border: 1px solid var(--secondary-text-color);
    border-radius: var(--fp-ctl-r);
    opacity: .85;
  }
  .row.is-retired .bar { display: none; }

  /* ---- the buttons, everywhere there are any ----

     To Home Assistant's metrics: 40 px tall, 14 px label, 18 px icon, pill
     shape. They were 30 px and 12.5 px — smaller than any neighbouring button
     on the same dashboard, and under the minimum touch target. */
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--fp-s2);
    height: var(--fp-ctl-h);
    padding: 0 var(--fp-s5);
    border: 1px solid var(--divider-color);
    border-radius: calc(var(--fp-ctl-h) / 2);
    cursor: pointer;
    font: inherit;
    font-size: var(--f-14);
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
  /* A gesture the input does not allow yet. It stays readable: it is the button
     one is looking for, and erasing it would suggest it does not exist. */
  .act[disabled] { opacity: .45; cursor: default; }
  .act[disabled]:hover { border-color: var(--divider-color); }
  /* ---- the gesture of a card that is still empty ----
     The only place where a button stays on the card: an empty card is made to
     be filled, and the menu on its own would have to be hunted for. */
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fp-s2);
    margin: var(--fp-s1) var(--fp-s4) var(--fp-s1);
  }

  /* ---- the card's menu ----

     Painted in the portal, fixed, placed to the pixel under its button. The
     transparent layer underneath catches the click that closes it: without it,
     one would have to listen to the whole document and guess what belongs to
     the menu across two shadow DOM boundaries. */
  .menu-layer { position: fixed; inset: 0; z-index: 8; }
  .cardmenu {
    position: fixed;
    min-width: 216px;
    max-width: calc(100vw - 16px);
    padding: var(--fp-s2) 0;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--ha-card-background, var(--card-background-color));
    border: 1px solid var(--divider-color);
    box-shadow: 0 4px 6px rgba(0, 0, 0, .12), 0 12px 28px rgba(0, 0, 0, .18);
  }
  .cardmenu .mi {
    display: flex;
    align-items: center;
    gap: var(--fp-s4);
    width: 100%;
    padding: var(--fp-s3) var(--fp-s4);
    border: none;
    background: none;
    font: inherit;
    font-size: var(--f-14);
    text-align: left;
    color: var(--primary-text-color);
    cursor: pointer;
    --mdc-icon-size: 18px;
  }
  .cardmenu .mi ha-icon { flex: 0 0 auto; color: var(--secondary-text-color); }
  .cardmenu .mi .mt { flex: 1; min-width: 0; }
  .cardmenu .mi .mv { font-size: var(--f-13); color: var(--secondary-text-color); }
  .cardmenu .mi:hover:not([disabled]) {
    background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
  }
  /* A row that opens onto nothing: the odometer fed by a sensor. It informs, so
     it stays readable — a half tone would make it look like an option one is
     entitled to switch on. */
  .cardmenu .mi[disabled] { cursor: default; }
  .cardmenu .msep { height: 1px; margin: var(--fp-s2) 0; background: var(--divider-color); }

  /* ---- a set's sheet ----

     The actions used to live in the row, where there was no room: everything
     had to fit on one rank, and what did not went under "…". Here they have
     the width of a sheet, which allows naming them and grouping them by what
     they touch — the record, the sensors, the count — instead of lining them
     up in order of arrival. */
  .tid { display: flex; align-items: center; gap: var(--fp-s3); margin-bottom: var(--fp-s1); }
  .tid .mark {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: var(--ha-card-border-radius, 12px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tint-soft);
    color: var(--tint-ink);
    --mdc-icon-size: 22px;
  }
  .tid .txt { min-width: 0; }
  .tid .nm { font-size: var(--f-16); font-weight: 500; line-height: 1.2; }
  .tid .st {
    margin-top: var(--fp-s0);
    font-size: var(--f-13);
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .verbs { display: flex; flex-wrap: wrap; gap: var(--fp-s2); margin: var(--fp-s4) 0 var(--fp-s1); }

  /* One block per thing one may want to change, and one verb per block. The
     body says what the block holds today: without it the verb would open a
     form to answer a question one has not yet asked. */
  .tblock {
    margin-top: var(--fp-s4);
    padding-top: var(--fp-s3);
    border-top: 1px solid var(--divider-color);
  }
  .tblock .hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fp-s3);
  }
  .tblock .ttl {
    font-size: var(--f-12);
    font-weight: 700;
    letter-spacing: .6px;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .tblock .bd {
    margin-top: var(--fp-sh);
    font-size: var(--f-13);
    line-height: 1.5;
    color: var(--secondary-text-color);
  }
  .tblock .bd b { color: var(--primary-text-color); font-weight: 500; }
  .tblock .bd.none { font-style: italic; opacity: .8; }

  /* A block's link: a verb, without a frame. One button per block would make
     four buttons of the same weight as "Fit", which is the gesture of the
     day. */
  .lnk {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: var(--f-13);
    font-weight: 500;
    color: var(--primary-color);
    white-space: nowrap;
  }
  .lnk:hover { text-decoration: underline; }
  .lnk:focus-visible { outline: var(--fp-focus); outline-offset: var(--fp-focus-off); }

  /* The rare and the consequential, at the end of the sheet: readable, but
     without a button's relief — one does not lean on it by accident. */
  .tmore {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fp-s1) var(--fp-s4);
    margin-top: var(--fp-s4);
    padding-top: var(--fp-s3);
    border-top: 1px solid var(--divider-color);
  }
  .tmore .lnk { font-weight: 500; color: var(--secondary-text-color); }
  .tmore .lnk.danger { color: var(--error-color); }

  /* The confirmation inset. It takes the place of the verbs rather than opening
     over them: a gesture is confirmed where it was asked for. */
  .confirm {
    margin: var(--fp-s4) 0 var(--fp-s1);
    padding: var(--fp-s3);
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--secondary-background-color);
    border: 1px solid var(--divider-color);
    display: flex;
    flex-direction: column;
    gap: var(--fp-s3);
  }
  .confirm.danger { border-color: color-mix(in srgb, var(--error-color) 35%, transparent); }
  .confirm .say { font-size: var(--f-13); line-height: 1.5; }
  .confirm .say b { font-weight: 500; }
  .confirm .fld { display: flex; align-items: center; gap: var(--fp-s2); font-size: var(--f-13); }
  .confirm input {
    width: 110px;
    padding: var(--fp-sh) var(--fp-s2);
    border-radius: var(--fp-ctl-r);
    font: inherit;
    font-size: var(--f-13);
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
  }
  .confirm .acts { display: flex; flex-wrap: wrap; gap: var(--fp-s2); }

  /* ---- the sheets ----

     One stack, one veil. A set's record, the screen that edits it and the form
     that fills it in are stacked instead of replacing one another: one comes
     back from where one came, and "Cancel" no longer returns to the card two
     levels below, having lost the set one was looking at.

     The veil is painted in a host placed at the end of \`body\`, outside the
     card — see \`#openPortal\`. That is what makes the \`position: fixed\` below
     reliable: inside the card, the slightest \`transform\` on an ancestor turned
     it into positioning relative to the card itself. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 7;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--fp-s4);
    background: rgba(0, 0, 0, .45);
  }
  .sheet {
    width: min(480px, 100%);
    max-height: min(86vh, 720px);
    overflow: auto;
    padding: var(--fp-s5);
    border-radius: var(--ha-card-border-radius, 16px);
    background: var(--ha-card-background, var(--card-background-color));
    color: var(--primary-text-color);
    box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
    /* A sheet that speaks of no set takes the interface's shade: the choice
       chips fall in with it without having to bother. */
    --tint: var(--primary-color);
  }
  .sheet:focus-visible { outline: none; }
  .sheet h2 { margin: 0; font-size: var(--f-17); font-weight: 500; }

  /* The header. The chevron only appears from the second floor up: on the
     first there is nothing behind, and a back arrow that closes would read as a
     cancel in disguise. */
  .shead { display: flex; align-items: center; gap: var(--fp-s3); margin-bottom: var(--fp-s4); }
  .shead .tid { flex: 1; min-width: 0; margin-bottom: 0; }
  .shead h2 { flex: 1; min-width: 0; }
  .back {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    margin-left: -var(--fp-sh);
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
    margin: 0 0 var(--fp-s4);
    font-size: var(--f-13);
    line-height: 1.45;
    color: var(--secondary-text-color);
  }
  /* Written as paragraphs rather than as one block: \`pre-wrap\` on the whole
     turned every line break into a doubled vertical gap. */
  .sheet .desc p { margin: 0 0 var(--fp-s2); }
  .sheet .desc p:last-child { margin-bottom: 0; }
  .sheet .desc ul { margin: 0 0 var(--fp-s2); padding-left: var(--fp-s4); }
  .sheet .desc li { margin: var(--fp-s0) 0; }
  .sheet .desc strong { color: var(--primary-text-color); font-weight: 500; }
  .sheet-foot { display: flex; justify-content: flex-end; gap: var(--fp-s2); margin-top: var(--fp-s5); }
  /* A form's footer carries the gesture: taller than the pills of a list row,
     which have to efface themselves. */
  .sheet-foot .act { height: 36px; padding: 0 var(--fp-s4); }
  .act[disabled] { opacity: .5; cursor: default; }

  /* ---- a field, on the sheets that still ask for one ----

     One remains: the odometer's. Its name is not written above it — the sheet
     it sits on asks for nothing else — but the line below is, because it is
     what says whether the figure just typed will be accepted. */
  .fld2 .hp { margin-top: var(--fp-sh); font-size: var(--f-12); line-height: 1.45; color: var(--secondary-text-color); }
  .fld2 .no { margin-top: var(--fp-sh); font-size: var(--f-12); line-height: 1.45; color: var(--error-color); }
  .fld2.wrong .tx { border-color: var(--error-color); }

  .tx {
    width: 100%;
    box-sizing: border-box;
    height: 40px;
    padding: 0 var(--fp-s3);
    border-radius: var(--ha-card-border-radius, 12px);
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: var(--f-14);
  }
  .tx::placeholder { color: var(--secondary-text-color); opacity: .5; }
  .tx:focus { border-color: var(--primary-color); }
  input.tx[type="number"] { font-variant-numeric: tabular-nums; }
  /* A number carries its unit on the right, outside the box: inside, it would
     be wiped out by the first keystroke. */
  .unit { display: flex; align-items: center; gap: var(--fp-s2); }
  .unit .tx { flex: 1; min-width: 0; text-align: right; }
  .unit .u { flex: 0 0 auto; font-size: var(--f-13); font-weight: 500; color: var(--secondary-text-color); }

  /* ---- an odometer's leaps ----

     An odometer is not corrected by a kilometre, it is read off several
     hundred at a time. The field's arrows advance one step at a time, which is
     right for an adjustment and absurd for a reading: these buttons give the
     leaps one actually makes, and the field stays free for the exact figure
     read off the dashboard. */
  .quick { display: flex; gap: var(--fp-s2); margin-top: var(--fp-s2); }
  .quick .qk {
    flex: 1 1 0;
    min-width: 0;
    height: var(--fp-pill-h);
    border: 1px solid var(--divider-color);
    border-radius: var(--fp-pill-r);
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
    font-size: var(--f-13);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .quick .qk:hover { border-color: var(--primary-color); }

  .empty { padding: var(--fp-s1) var(--fp-s4) var(--fp-s3); font-size: var(--f-13); color: var(--secondary-text-color); }

  /* ---- when the column tightens ----

     A card sits on 1 to 12 columns in a "sections" view. Its width therefore
     has nothing to do with the window's, and a media query would measure the
     wrong thing: it is the card that measures itself.

     Under 340 px, the two-column grids no longer have the room to be two — two
     27 px headers side by side were sharing a hundred pixels each. They unfold,
     and a row's mileage moves under its name instead of fighting for the same
     rank. */
  /* \`container-type\` also sets \`contain: layout\`, which makes the card a
     containing block for any fixed-position descendant. The sheet would
     therefore have been clipped right here — it is not, because it moved into
     the portal first. That move is what makes this line possible, and not the
     other way round. */
  ha-card { container-type: inline-size; }
  @container (max-width: 340px) {
    /* The rule between the two headers comes from the \`gap\` over the \`.heroes\`
       background: it follows the fold on its own, horizontally as well as
       vertically. */
    .heroes { grid-template-columns: 1fr; }
    .tpms { grid-template-columns: 1fr; }
    .km { font-size: var(--f-20); }
    .hero .mark { width: 36px; height: 36px; --mdc-icon-size: 20px; }
    .row { grid-template-columns: 30px 1fr; }
    .row .val {
      grid-column: 2;
      margin-top: var(--fp-s0);
      text-align: left;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--fp-s1) var(--fp-s2);
    }
    .row .state { display: inline; }
    .row .pill { margin-top: 0; }
    .row .bar { grid-column: 2 / 3; }
  }

  button:focus-visible, input:focus-visible {
    outline: var(--fp-focus);
    outline-offset: var(--fp-focus-off);
  }
  @media (prefers-reduced-motion: reduce) { .row { transition: none; } }
`;

/** A word in HA's toast: that is where the interface already puts its acknowledgements. */
function notify(el, message) {
  el.dispatchEvent(
    new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true })
  );
}


/* ---------- the screens ---------- */

/** A set's identity, the line the eye comes back to. */
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
 * A sheet's header.
 *
 * When the sheet acts on a set, it is the set that titles it: "Edit the record"
 * does not say which set, and that is the only question one asks on looking up
 * from a half-filled form. The title then becomes the subtitle of the group it
 * opens.
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

/** The footer: the gesture on the right, giving up to its left. */
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

/** A verb without a frame, for what does not deserve a button's relief. */
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


class TyresCard extends HTMLElement {
  #config = null;
  #hass = null;
  #body = null;
  #seen = {};
  #painted = false;

  /**
   * The host of the sheets, placed in `document.body`.
   *
   * The veil is `position: fixed`, and a fixed element only anchors to the
   * viewport if none of its ancestors creates a stacking context. Home
   * Assistant creates one: it puts a `transform` on the cards during
   * drag-and-drop in edit mode, and the "sections" views wrap them in a
   * sortable container. From the card's shadow root, the sheet was then drawn
   * inside the card, clipped by its `overflow: hidden`.
   *
   * Hence this separate host, outside the card. It carries its own shadow root
   * with the same style sheet: leaving the card's shadow root means leaving its
   * styles, and everything the sheet draws is described there.
   */
  #portal = null;
  #portalRoot = null;

  /**
   * The open sheets, from the oldest to the one being looked at.
   *
   * A stack, and not a sheet: opening "Edit the record" from a set used to
   * stack a dialog on a dialog, or rather wipe out the first — one cancelled,
   * and landed back on the card, the set lost. Here one comes back from where
   * one came.
   */
  #stack = [];

  /**
   * The gesture waiting to be confirmed on the open record: null | "mount" |
   * "unmount" | "rotate" | "retire" | "adjust". `#arg` carries what the
   * gesture needs to remember — the axle aimed at, for a fitting. Deleting is
   * not among them any more: it rewrites the record, which is the editor's.
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
    // The shadow root is rewritten just below: a sheet left open would
    // vanish from the screen leaving its flow running on the server side.
    // And since it lives in `body`, the rewrite no longer carries it away:
    // it is up to us to remove it.
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
    // The language counts as a state change: without this the words of the
    // old one stayed on screen until the next entity push.
    const changed = watch(hass, ids, this.#seen) || LANG !== spoke;
    if (!changed && this.#painted) return;
    this.#painted = true;
    this.#draw();
  }

  /* ----- the stack of sheets -----

     A screen is an object with three keys: `key` to recognise it, `live` to say
     whether it repaints when the state of the house moves, `paint` to draw
     itself. A set's record is live — its kilometres advance while one looks at
     it. A form is not: repainting it would wipe out what is being typed. */

  get stackDepth() {
    return this.#stack.length;
  }

  /** Pushes a screen and shows it. */
  pushScreen(screen) {
    this.#stack.push(screen);
    this.repaintSheet(true);
    return screen;
  }

  /**
   * Removes a screen, and says in passing what came of it.
   *
   * The screen aimed at rather than the last one: a reply from the server may
   * arrive after something else has been opened on top, and popping blindly
   * would close the wrong sheet.
   */
  dropScreen(screen, message = null) {
    const at = this.#stack.indexOf(screen);
    if (at >= 0) {
      this.#stack.splice(at, 1).forEach((gone) => gone.leave?.());
      this.repaintSheet(true);
    }
    if (message) notify(this, message);
  }

  /** Closes everything. */
  closeSheets() {
    while (this.#stack.length) this.#stack.pop().leave?.();
    this.repaintSheet(true);
  }

  /**
   * Repaints the topmost sheet.
   *
   * `force` tells the two callers apart: a gesture by the user always repaints,
   * a new state push only touches a screen that declares itself live.
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
      // A click on the veil closes the top floor, a click inside the sheet
      // does not go through: the card underneath is still listening for its own.
      scrim.addEventListener("click", (event) => {
        if (event.target === scrim) this.dropScreen(this.#stack[this.#stack.length - 1]);
        event.stopPropagation();
      });
      scrim.addEventListener("keydown", (event) => {
        event.stopPropagation();
        // `defaultPrevented`: an Escape already consumed — the open list of an
        // `ha-selector` closing — must not carry the sheet away with it.
        if (event.key === "Escape" && !event.defaultPrevented) {
          this.dropScreen(this.#stack[this.#stack.length - 1]);
        }
      });
      root.appendChild(scrim);
    }

    const sheet = scrim.querySelector(".sheet");
    // Repainting the same screen must not send it back to the top: we repaint
    // at every pressure reading, and the sheet would scroll up under one's
    // fingers. A different screen, for its part, opens at its beginning.
    const scrolled = scrim.dataset.key === top.key ? sheet.scrollTop : 0;
    sheet.replaceChildren();
    // The shade belongs to the screen, not to the sheet: a form that speaks of
    // no set would otherwise keep the blue of the winter set one was looking
    // at a moment before.
    sheet.style.removeProperty("--tint");
    sheet.removeAttribute("aria-label");
    scrim.dataset.key = top.key;
    top.paint(sheet);
    sheet.scrollTop = scrolled;
    if (force) sheet.focus();
  }

  /**
   * The host of the sheets, created on first need.
   *
   * Placed at the end of `body`: at equal z-index it is document order that
   * decides, and a sheet opened after a Home Assistant dialog has to come in
   * front of it.
   *
   * Document order is not enough, however, when the card is itself in a dialog
   * — which is the case from the floor-plan badge, which opens it as a
   * browser_mod popup. Two things stand in the way, and both have to be dealt
   * with.
   *
   * The first is the browser's top layer: a dialog lives there, and it paints
   * above the whole page whatever the `z-index`. A sheet placed in `body`
   * therefore went underneath, and the menu with it.
   *
   * The second is inertness. A modal dialog makes inert everything outside its
   * subtree: rising into the top layer made the menu visible, but it stayed
   * dead to clicks and to focus. No attribute exempts one from it — the only
   * way out is to be oneself the topmost modal dialog, which is what
   * `showModal()` does. The new one becomes the highest, its subtree comes back
   * to life, and the dialog carrying the card falls behind in its turn.
   *
   * The host is therefore reopened at every layer, and closed as soon as it
   * carries none: a modal dialog left open would block the whole page.
   *
   * It stays without a surface of its own: it is its two layers, fixed, that
   * cover the screen — a host that spread out would catch the clicks. Hence the
   * reset of what a `dialog` receives from the browser: frame, background,
   * padding, maximum widths, and the veil it lays behind itself that our
   * sheets' veil would double.
   */
  #openPortal() {
    if (!this.#portal) {
      const host = document.createElement("dialog");
      host.className = "tyres-card-sheets";
      host.style.cssText =
        "position:fixed;top:0;left:0;width:0;height:0;max-width:none;max-height:none;" +
        "margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:1000;";
      // Escape belongs to the layers, not to the host: the card closes one floor
      // at a time, where the browser would close everything at once.
      host.addEventListener("cancel", (event) => event.preventDefault());

      // The shadow root goes down a level: `dialog` is not among the elements
      // that accept one, and `attachShadow` throws there. So it is an inner
      // `div` that carries it, without a surface either.
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
   * Closes the host when it carries neither sheet nor menu any more.
   *
   * It stays in place, empty: it is a modal dialog, and leaving it open would
   * make inert the page just handed back to the user.
   */
  #idlePortal() {
    const root = this.#portalRoot;
    if (!root || root.querySelector(".scrim") || root.querySelector(".menu-layer")) return;
    if (this.#portal.open) this.#portal.close();
  }

  /**
   * Removes the sheet layer, leaving the host in place.
   *
   * The host also carries the card's menu, which has nothing to do with the
   * stack of screens: emptying it entirely would close one by closing the
   * other. Empty, it costs nothing — its two layers are fixed, therefore out of
   * flow.
   */
  #closeSheetLayer() {
    this.#portalRoot?.querySelector(".scrim")?.remove();
    this.#idlePortal();
  }

  /** Closes everything and removes the host from the document: nothing may outlive it. */
  #destroyPortal() {
    this.#portal?.remove();
    this.#portal = null;
    this.#portalRoot = null;
  }

  /**
   * The card leaves the page: the sheet cannot stay on it.
   *
   * It lives in `body` and not in the card — changing view or dashboard would
   * leave it open, in front of a card that is no longer there.
   */
  disconnectedCallback() {
    while (this.#stack.length) this.#stack.pop().leave?.();
    this.#destroyPortal();
  }

  /* ----- calls to the component ----- */

  #call(service, data) {
    // Entity services: it is the target that designates the vehicle, so two
    // tracked cars never tread on each other.
    return (
      this.#hass?.callService(DOMAIN, service, data, {
        entity_id: this.#config.entity,
      }) ?? Promise.reject(new Error(t("card.not_connected")))
    );
  }

  /**
   * A service, and the word that follows — but only if it went through.
   *
   * The component now refuses out loud: a set in history one tries to fit, a
   * pair one tries to rotate, an odometer going backwards. Announcing "Set
   * fitted" without waiting for the reply means displaying the opposite of what
   * just happened — and Home Assistant lays its own error toast right beside
   * it.
   *
   * On a refusal the sheet stays open, where the gesture was asked for: closing
   * it would carry the question away without having answered it.
   */
  #run(service, data, message) {
    this.#call(service, data).then(
      () => this.#did(message),
      // The refusal has been said already: `callService` lays the toast itself,
      // with the message the component wrote. Repeating it would make two voices.
      () => {}
    );
  }

  /** The vehicle's config entry, which the sensor carries as an attribute. */
  #entryId() {
    return this.#seen[this.#config.entity]?.attributes?.entry_id ?? null;
  }

  /** The sensor's attributes, where everything is read from. */
  #attrs() {
    return this.#seen[this.#config.entity]?.attributes ?? {};
  }

  /** A set, as the sensor carries it. */
  #set(setId) {
    const sets = this.#attrs().sets;
    return (Array.isArray(sets) ? sets : []).find((other) => other.id === setId) ?? null;
  }

  /**
   * Opens the editor, on this vehicle and — when one is named — on this set.
   *
   * The card used to draw those forms itself, driving the integration's options
   * flow over REST without ever showing its screens. The flow is gone: what it
   * described is now written once, in `websocket_api.py`, and given shape once,
   * in the editor panel — a page that shows the whole car at a time, where a
   * flow could only ever show one step.
   *
   * What is left here is what a card is for: reading the state, and the
   * manoeuvres, which are services and go straight to the component. Editing a
   * record is a different act — one sits down for it — and it now happens in
   * the one place that owns it, rather than in two that must agree.
   */
  #openEditor(setId = null) {
    const entryId = this.#entryId();
    if (!entryId) {
      notify(
        this,
        t("card.no_entry")
      );
      return;
    }
    // The set is named in the address, so the page opens on it rather than on
    // a list one would have to find it in again.
    const query = new URLSearchParams({ vehicle: entryId });
    if (setId) query.set("set", setId);
    this.closeSheets();
    performAction(
      this,
      this.#hass,
      { action: "navigate", navigation_path: `/${PANEL_PATH}?${query}` },
      this.#config.entity
    );
  }

  /* ----- rendering ----- */

  /**
   * The card, then the open sheet if it is live.
   *
   * Both repaint together at every state received: a set's record shows
   * kilometres and an axle, which move while it is open. A sheet painted once
   * and for all would show the state from before the gesture just made on it.
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

    // the fitted set
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

    // advice
    const advice = this.#config.advice_entity
      ? this.#seen[this.#config.advice_entity]?.state === "on"
      : false;
    if (advice) {
      // `ha-alert` rather than a box of our own: the background was a hard-coded
      // `rgba(255,167,38,…)` under text in `var(--warning-color)`, therefore red
      // on orange for anyone who redefines the warning colour.
      const a = document.createElement("ha-alert");
      a.className = "advice";
      a.setAttribute("alert-type", "warning");
      a.textContent = t("card.advice");
      this.#body.appendChild(a);
    }

    // No set at all: saying nothing beyond "nothing is fitted" would leave the
    // card at a dead end, when everything is declared from it. This is the
    // only place where the gesture keeps a button — an empty card is made to
    // be filled, and the menu on its own would have to be hunted for.
    if (!sets.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("card.no_sets");
      this.#body.appendChild(p);
      const first = document.createElement("div");
      first.className = "links";
      first.appendChild(
        actButton(t("act.add_set"), "mdi:plus", "primary", () => this.#openEditor())
      );
      this.#body.appendChild(first);
      return;
    }

    // The count is said only here. The header carries the odometer, which the
    // list cannot say; the list carries its number, flushed right like the
    // mileages of the rows it introduces.
    const lb = document.createElement("div");
    lb.className = "label";
    const l1 = document.createElement("span");
    l1.textContent = t("card.sets_label");
    const l2 = document.createElement("span");
    l2.className = "count";
    l2.textContent = String(sets.length);
    lb.append(l1, l2);
    this.#body.appendChild(lb);

    // The sets in history last: they are consulted, they are not handled, and
    // they therefore have no business in the flow of the gesture.
    const worst = Math.max(1, ...sets.map((s) => Number(s.km) || 0));
    for (const set of [...sets].sort((a, b) => (a.retired ? 1 : 0) - (b.retired ? 1 : 0))) {
      this.#body.appendChild(this.#row(set, worst, attrs));
    }
  }

  /**
   * The header: which car is being spoken of, and where its odometer stands.
   *
   * The card used to open on a big number without ever naming the vehicle. Two
   * cars on the same dashboard could only be told apart by the reference of the
   * fitted tyre — and there was nowhere to hang what aims at no set in
   * particular.
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

    // The odometer is read, it is no longer typed. It is the pivot every total
    // is derived from, and it used to live as an open field at the bottom of a
    // card one scrolls through: a slipping finger shifted them all.
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
   * The card's menu: what aims at no set.
   *
   * Adding a set and configuring the vehicle sat at the bottom of the card,
   * seen at every glance and used twice a year. They move behind a single way
   * in, where Home Assistant puts its own.
   *
   * Painted in the portal and not in the card, for the same reason as the
   * sheet: a fixed-position menu laid under a transformed ancestor would place
   * itself askew.
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
      // The listeners always go, even if the layer has already gone — a menu
      // carried off by the card being disconnected would leave them behind.
      removeEventListener("scroll", onScroll, true);
      removeEventListener("resize", close);
      // A close can happen twice: through the click, then through the scroll
      // that click triggered. The second must not steal the focus from what
      // the first has just opened.
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
    /* The menu is placed to the pixel under its button: whatever moves the
       button would leave it pointing beside it, so we close.

       Two precautions, and they are not for comfort. Scrolling is listened to
       on the capture phase, so any container in the page triggers it —
       including a dialog's. Now the card opens as a dialog from the floor-plan
       badge: giving focus to the menu's first entry, which lives outside the
       box, makes the dialog recall that focus and scroll its content. The menu
       closed within the second following its opening, which looks exactly like
       a menu that does not open.

       So: we only listen from the next frame on, long enough for that
       commotion to settle, and we only close if the button has actually moved.
       That is the condition we wanted all along — the rest was only an
       approximation by way of scrolling. */
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

    // One way in, straight to the page: adding a set, the vehicle's settings
    // and the integration's own page were three labels over the same door.
    item(t("act.editor"), "mdi:open-in-new", () => this.#openEditor());
    rule();
    // An odometer fed by a sensor is not corrected by hand: the row says so,
    // and opens onto nothing.
    if (attrs.odometer_auto === true) {
      item(t("card.odometer_menu"), "mdi:counter", null, t("card.automatic"));
    } else {
      item(t("act.update_odometer"), "mdi:counter", () => this.#askOdometer(attrs));
    }

    layer.appendChild(menu);
    root.appendChild(layer);
    anchor.setAttribute("aria-expanded", "true");

    // Placed afterwards: the menu's width depends on its labels, and its
    // overflow at the bottom of the screen is only known once measured.
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
   * Bringing the odometer up to date.
   *
   * In a sheet, and not as a field open on the card: the figure shifts every
   * total, and the component refuses a value below the last one anyway — better
   * the entry be a gesture than a brush of the hand.
   *
   * The ordinary gesture is not a correction of a few kilometres, it is a
   * reading: one looks at the dashboard and copies it over. Hence three ways of
   * arriving at the number, in the order they serve — the field open on its
   * value already selected, to type the reading over it; the leaps of a
   * hundred, five hundred and a thousand, for catching up by eye; and the
   * field's arrows, set to ten, for fine adjustment. A step of one served only
   * that last case and did all the rest by hand.
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
        // Rebuilt at every paint, but named before: the leaps call it and are
        // built above it.
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
        // Ten, and not one: the arrows are for adjustment, never for the
        // reading — that is typed, or taken from the leaps below.
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

        // The difference, rather than the total alone. It is what one checks after
        // typing — a six-character figure is hard to reread, a "+1,200 km" is
        // recognised at once as the distance one has covered.
        const gap = document.createElement("p");
        gap.className = "hp";
        field.appendChild(gap);
        sheet.appendChild(field);

        const save = actButton(t("act.save"), null, "primary", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || (from !== null && value < from)) return;
          // The sheet only closes once the reading has been accepted. It refuses a
          // figure going backwards already, but it is the component that decides —
          // and if it refuses, the typed value has to stay in front of one's eyes.
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
        // The sheet opens on the field, value selected: it is the only thing it
        // asks for, and the reading is typed over it without having to erase six
        // digits.
        queueMicrotask(() => {
          input?.focus();
          input?.select();
        });
      },
    };
    this.pushScreen(screen);
  }

  /** The service, from the odometer sheet. */
  setOdometer(value) {
    return this.#call("set_odometer", { odometer: value });
  }

  /**
   * The four corners, when sensors are attached to them.
   *
   * The component hands them over already resolved by corner: a sensor belongs
   * to the set, but a pair fitted at the rear reads at the rear, and it is the
   * vehicle that knows where it is. The card therefore has nothing to work out
   * again.
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
      // The fallback goes through the corner table: the raw key "front_left" is
      // not a word, and the floor-plan badge makes that choice already.
      label.textContent = read.label ?? CORNER_LABELS[corner] ?? corner;

      const value = document.createElement("span");
      value.className = "p";
      value.textContent =
        read.pressure == null ? "—" : `${trim(read.pressure)} ${read.unit ?? ""}`.trim();

      cell.append(label, value);

      // The pressure is the datum; the rest is context. One slot on the right,
      // and the most urgent thing takes it.
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
   * The second member of a wheel cell.
   *
   * The wheel arrives with four values — pressure, temperature, battery, date
   * of the last reading — and the card showed only one of them besides the
   * pressure, the temperature, with an assumed "°C" when the pressure, for its
   * part, reads its own unit.
   *
   * The order below is that of urgency. A silent sensor comes before
   * everything: its pressure is a memory. A low battery comes next — it is the
   * warning that allows acting before the silence, and it was thrown away. The
   * temperature comes only after: it is not read for itself, it explains a low
   * pressure on a cold morning.
   */
  #wheelAside(read) {
    const say = (text, icon, tone) => {
      const el = document.createElement("span");
      el.className = "t" + (tone ? ` ${tone}` : "");
      if (icon) el.appendChild(makeIcon(icon));
      el.appendChild(document.createTextNode(text));
      return el;
    };

    // The tyre called wrong comes before everything, as long as the reading
    // is today's: it is the information that stops one taking the road.
    // Silent, silence takes over — the alarm, like the pressure, is old,
    // and the red cell says already what is left to say.
    if (read.alarm && !read.stale) {
      return say(t("card.alarm_aside"), "mdi:car-tire-alert", "danger");
    }
    if (read.stale) {
      const since = sinceLabel(read.last_seen);
      // "3 d" on its own would not say what it is about beside a pressure.
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
      // The unit comes from the sensor. "°C" was written whatever happened,
      // which displayed "64 °C" for a probe reporting Fahrenheit.
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
    // The label first, as everywhere: the field's help promises it
    // "replaces the reference on screen", and the sensor serves it already
    // disambiguated when two sets share a reference.
    r.appendChild(
      document.createTextNode(set ? nameOf(set) : t("card.no_set"))
    );
    const qty = set ? axleIcon(axleOf(set, attrs)) : null;
    if (qty) r.appendChild(qty);

    txt.append(k, r);

    // A fitted set with no mount date — the case of a tracking taken over
    // elsewhere — has nothing to say here: better one row fewer than an empty one.
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
   * "Fitted since 12 April", without ever showing a raw date.
   *
   * The number of tyres used to be added to it; it has moved to an icon on the
   * line above, against the reference it qualifies.
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
    // The quantity sticks to the reference it qualifies, rather than drowning
    // in the metadata line where it was worth two words.
    const qty = axleIcon(axleOf(set, attrs));
    if (qty) name.appendChild(qty);
    const meta = document.createElement("div");
    meta.className = "meta";
    // The date code follows a set into the archive: it is at the moment of
    // bringing back a set stored away for years that it weighs the most.
    const dot = dotLabel(set);
    // The cost per kilometre only shows once the set has run far enough for the
    // division to mean something — the component keeps quiet before that.
    // "4 wheels" leaves this line: the icon beside the name says it already.
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

    // What calls for a decision, where one is looking. The component has
    // computed both all along: the rotation only coloured a button at the
    // bottom of a sheet, and the age was read nowhere.
    for (const pill of this.#pills(set)) val.appendChild(pill);

    row.append(ic, mid, val);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round(((Number(set.km) || 0) / worst) * 100)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    // The whole row opens the set's record, including for a retired set:
    // without that it would be a dead end, and putting it back into service
    // would mean going through the configuration flow. The row carries no
    // button — one gesture to learn, and four sets fitting on one screen.
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
   * A row's chips: what calls for a gesture, and nothing else.
   *
   * "To rotate" and not "rotation due": `rotation_due` only becomes true once
   * the interval has been passed, so the moment has come — but the card
   * advises, it does not order, and that is already the tone of the weather
   * banner.
   *
   * The figure that justifies the advice moves into the tooltip. The accessible
   * name, for its part, starts with the visible label: an `aria-label` that
   * does not contain the visible text breaks voice control.
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
    // A tyre's age is read on no counter: it ages standing still, and it is
    // precisely a stored set that ages without anyone thinking about it.
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

  /* "filed on …" and not "since …": the neighbouring line already carries
     "fitted since", and two "since" on the same rank would read as the same
     date. The status, for its part, is said by the chip. */
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

  /* ----- a set's record -----

     Three levels, and not one more: the card shows, the record acts, the
     gesture is confirmed on the spot. What follows is the second — it replaced
     the strip of actions that opened inside the row, where room was so short
     that half the verbs had to be hidden under "…".

     A fourth stacks on top when something has to be written: the form opens
     above the record and hands it back on closing. That is all the stack is
     for. */

  /** Opens a set's record, with no gesture pending. */
  #openTrain(setId) {
    this.#mode = null;
    this.#arg = null;
    this.pushScreen(this.#trainScreen(setId));
  }

  /**
   * A set's screen.
   *
   * Live as long as no gesture is waiting to be confirmed: its kilometres
   * advance while one looks at it, and that is exactly what one wants to see.
   * As soon as a confirmation inset carries an input, it freezes — repainting
   * it would wipe out the reading being typed into it.
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
        // A set deleted while its record was open: it closes rather than
        // describe a record that no longer exists.
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

  /** What the record shows under its header. */
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

  /** Puts a gesture up for confirmation, without leaving the record. */
  #ask(mode, arg = null) {
    this.#mode = mode;
    this.#arg = arg;
    this.repaintSheet(true);
  }

  /** The gesture is away: we close, and what it changes is read on the card. */
  #did(message) {
    this.#mode = null;
    this.#arg = null;
    // Set records only, not the whole stack: the server's reply may
    // arrive after another sheet has opened on top, and it has no business
    // carrying it away — that is the rule `dropScreen` has already given
    // itself.
    for (const screen of [...this.#stack]) {
      if (String(screen.key).startsWith("train:")) this.dropScreen(screen);
    }
    if (message) notify(this, message);
  }

  /**
   * The verbs of the state the set is in.
   *
   * One state, one verb brought forward: in the garage one fits, on the car one
   * removes, in history one puts back into service. The rest of the sheet
   * carries nothing but links, so that this one button stays the gesture of the
   * day.
   */
  #verbs(set, attrs) {
    const el = document.createElement("div");
    el.className = "verbs";
    const on = axesOf(set);
    // Strictly "pair", and not "not all": an unknown axle — an old
    // sensor — is treated as a set of four, the cautious rule `axleOf`
    // has given itself. The coordinator decides from the real record
    // in any case.
    const pair = axleOf(set, attrs) === "pair";

    if (set.retired) {
      el.appendChild(
        this.#button(
          t("act.restore"),
          "mdi:archive-arrow-up-outline",
          "primary",
          () => {
            // `id` and not the label: the label is optional and two duplicated
            // records may share it — the id, for its part, designates one set
            // only, and `find()` on the Python side reads it first.
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
      // The free axle comes first: it is the fitting that removes nothing.
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
      // A rotation changes no mileage: it restarts the reminder and makes the
      // pressure sensors follow their wheel.
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
   * The confirmation inset, in place of the verbs.
   *
   * It only appears for the gestures that ask for an input or that undo
   * something else — it is the only place where the card allows itself a
   * sentence, and that is because it announces a consequence there.
   */
  #confirm(set, attrs) {
    const el = document.createElement("div");
    el.className = "confirm" + (this.#mode === "retire" ? " danger" : "");

    const say = document.createElement("div");
    say.className = "say";
    el.appendChild(say);

    const acts = document.createElement("div");
    acts.className = "acts";

    const cancel = this.#button(t("act.cancel"), null, "", () => this.#ask(null));

    // The odometer is only asked for when no sensor gives it. That is the
    // flow's rule, and it is the last moment at which one can say whom the
    // last kilometres belong to.
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
      // No `|| undefined`: a reading at 0 km is a value, not an emptiness.
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
              // A set of 4 frees both axles: naming its own would be asking to remove
              // half of it, which does not exist.
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

    // The fitting is left. The axle aimed at is in `#arg` — absent for a set of
    // four, which takes both whatever is asked.
    const axis = this.#arg;
    say.append(
      document.createTextNode(
        axis
          ? t("sheet.mount_at", { position: POSITIONS[axis].toLowerCase() })
          : t("sheet.mount_all") + " "
      )
    );

    // What this fitting undoes. A set of four takes both axles, and can
    // therefore remove two at once; a pair aims only at its own. Both cases
    // are said beforehand, rather than done in silence.
    const touched = axis ? [axis] : AXES;
    const leaving = [
      ...new Map(
        touched
          .map((slot) => fittedAt(attrs, slot))
          .filter((other) => other && other.id !== set.id)
          .map((other) => [other.id, other])
      ).values(),
    ];

    // A car carries either a set of four or two pairs — never a mix: putting a
    // pair on a set of four carries the whole of it away, the other axle
    // included.
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
   * The three blocks, grouped by what they touch.
   *
   * What is written on the tyre, what measures it, what counts it. Each says
   * its state and offers one verb only: it is that division which houses the
   * pressure sensors without lengthening any list of buttons.
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
        this.#openEditor(set.id)
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
        () => this.#openEditor(set.id),
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
   * The rare and the consequential, at the end of the sheet.
   *
   * Filing a set away stays here: it takes no decision beyond the odometer, and
   * it is what one does on the day one takes a worn set off — with the car in
   * front of one, not a settings page.
   *
   * Duplicating, separating and deleting left. All three start from the same
   * record and end by rewriting it, which is the editor's work; and three links
   * pointing at the same page, each promising something else, would say the
   * gesture happens here when it does not. One link says where they live.
   */
  #more(set, attrs) {
    const el = document.createElement("div");
    el.className = "tmore";
    void attrs;

    if (!set.retired) {
      el.appendChild(
        this.#link(t("act.retire"), "", () => this.#ask("retire"))
      );
    }

    el.appendChild(this.#link(t("act.editor"), "", () => this.#openEditor(set.id)));
    return el;
  }

  /**
   * The height announced, in rows of 50 px.
   *
   * It used to be constant: a card of one set and a card of six weighed the
   * same, and the column layout balanced them askew.
   */
  getCardSize() {
    const attrs = this.#seen?.[this.#config?.entity]?.attributes ?? {};
    const sets = Array.isArray(attrs.sets) ? attrs.sets.length : 0;
    const corners = Object.keys(attrs.pressures ?? {}).length;
    return 2 + (corners ? 2 : 0) + Math.ceil(sets * 1.1);
  }

  /**
   * The place in a "sections" view, where a card sits on 1 to 12 columns.
   * Without this it received a default block and resized badly — and that is
   * the layout offered by default since 2024.11.
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

/* ---------- editors ---------- */

const ENTITY_SCHEMA = [
  { name: "entity", selector: { entity: { integration: "tyre_tracker", domain: "sensor" } } },
  { name: "advice_entity", selector: { entity: { domain: "binary_sensor" } } },
];

/* Functions and not objects: a label frozen when the module loads would stay
   in the language guessed at that point, even if `hass` announced another one
   just afterwards. */
const BADGE_LABELS = () => ({
  entity: t("editor.entity"),
  advice_entity: t("editor.advice"),
  pressures: t("editor.pressures"),
  image: t("editor.image"),
});

const CARD_LABELS = () => ({ ...BADGE_LABELS(), title: t("editor.title") });

/* The pressure grid belongs to the badge alone: the card always shows them,
   and with the detail the badge has no room to carry. */
defineEditor(
  "floor-tyres-badge-editor",
  [
    ...ENTITY_SCHEMA,
    { name: "image", selector: { text: {} } },
    { name: "pressures", selector: { boolean: {} } },
  ],
  BADGE_LABELS
);
defineEditor(
  "tyres-card-editor",
  [...ENTITY_SCHEMA, { name: "title", selector: { text: {} } }],
  CARD_LABELS
);

/* ---------- registration ---------- */

// Guards against double loading: a Lovelace resource added by hand on top of
// the integration's would load the module twice, and a second `define` of the
// same name kills the whole script.
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
