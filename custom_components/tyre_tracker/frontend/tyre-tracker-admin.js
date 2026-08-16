/**
 * Tyre Tracker — admin panel.
 *
 * A custom panel reached from the sidebar, from a vehicle device's
 * configuration_url, or at /tyre-tracker directly. It is the only way to
 * configure the integration: the config flow declares a vehicle and stops
 * there, and the options flow that used to carry the rest — seventeen steps of
 * menus and forms — was removed once this covered all of them.
 *
 * One vehicle at a time, three tabs: the sets it owns, the car's own settings,
 * and the manoeuvres already done to it. Everything a set can undergo is on the
 * set itself — fit, rotate, separate, replace, retire, correct — because that
 * is where one is looking when one decides to do it, and a flow could only ever
 * offer it as a line in a menu two screens away.
 *
 * All truth stays in Python: the panel talks to five WebSocket commands
 * (tyre_tracker/config/get · config/save · action · vehicle/create ·
 * vehicle/delete) which validate by the same rules the flow applied and write
 * through the entry options and the coordinator. It therefore hard-codes no
 * bound and no default: both come down in config/get.
 */

const DOMAIN = "tyre_tracker";

const WS_GET = `${DOMAIN}/config/get`;
const WS_SAVE = `${DOMAIN}/config/save`;
const WS_ACTION = `${DOMAIN}/action`;
const WS_CREATE = `${DOMAIN}/vehicle/create`;
const WS_DELETE = `${DOMAIN}/vehicle/delete`;

/** Where the panel sends itself once it has deleted the last vehicle: the
    integration unregisters the panel with the last entry, and the page one is
    standing on stops being served. */
const INTEGRATION_PAGE = `/config/integrations/integration/${DOMAIN}`;

/* ---------- the words ----------

   A panel cannot read strings.json: the translation categories Home Assistant
   serves to the browser are fixed, and none of them houses a panel's prose. It
   carries its own dictionary, exactly as a distributed card does.

   The language is the READER'S — `hass.locale.language`, the one each admin
   chose for themselves — and not the server's, which is what names entities and
   composes states on the Python side.

   English is the fallback KEY BY KEY (see mergeWords): a table missing a line
   lets an English sentence through, which is seen and corrected, where a missing
   key would print "undefined" in the middle of the page.

   Values are strings or functions. Plural, elision and word order belong to the
   language, so each table carries its own rule instead of a shared template fed
   with a count. */

const WORDS = {
  en: {
    // The one key with no French twin, on purpose: a product name is not
    // translated, and `mergeWords` hands the English one down to every
    // language. Nothing is missing here.
    title: "Tyre Tracker",
    loading: "Loading…",
    loadError: "The configuration could not be read.",
    retry: "Try again",
    saved: "Saved.",
    deleted: "Vehicle deleted.",
    discardConfirm: "Discard the changes in progress?",
    menu: "Menu",
    noVehicle: "No vehicle yet. Declare the first one right here — one entry per car.",
    addVehicle: "Add a vehicle",
    notLoaded: "This vehicle is not loaded: its records can be read, nothing can be done to them. Fix what its notification reports, then come back.",

    tabs: { sets: "Tyre sets", vehicle: "Vehicle", history: "History" },

    car: {
      title: "On the car",
      empty: "Nothing fitted",
      odometer: "Odometer",
      auto: (entity) => `read from ${entity}`,
      manual: "typed in by hand",
      setOdometer: "Enter a reading",
    },

    sets: {
      none: "No set declared yet. Add one to start counting its kilometres.",
      add: "Add a set",
      fallback: "Set",
      history: "History",
      sensors: "Pressure sensors",
    },

    status: {
      mounted: "Fitted",
      mountedAt: (position) => `Fitted at the ${position.toLowerCase()}`,
      off: "Off the car",
      retired: "In the history",
      since: (date) => `since ${date}`,
      rotationDue: "Rotation due",
      sinceRotation: (km) => `${km} km since the last rotation`,
      neverRotated: "Never rotated",
      aged: (years) => `${years} years old`,
      agedHint: "A tyre ages standing still, whatever its mileage",
      age: (years) => `${years} years`,
      costPer: (amount) => `${amount} € / 1000 km`,
      stale: "No recent reading",
      alarm: "Pressure out of band",
    },

    season: { summer: "Summer", winter: "Winter", all_season: "All-season" },
    axle: { all: "4 wheels", pair: "2 wheels (a pair)" },
    position: { front: "Front", rear: "Rear" },
    corner: {
      front_left: "Front left", front_right: "Front right",
      rear_left: "Rear left", rear_right: "Rear right",
    },
    side: { left: "Left", right: "Right" },

    field: {
      reference: "Reference",
      season: "Type",
      axle: "Wheels",
      size: "Size",
      dot: "Date code (DOT)",
      label: "Label",
      price: "Price",
      storage: "Stored at",
      initial_total: "Distance already run",
      pressure_front: "Front target pressure",
      pressure_rear: "Rear target pressure",
      vehicle: "Vehicle",
      odometer_entity: "Odometer entity",
      rotation_interval: "Rotate every",
      initial_odometer: "Current odometer reading",
      odometer: "Odometer reading",
      total: "Total for this set",
      position: "Which axle",
      pair: "Which pair leaves",
      newLabel: "Label for the new pair",
      replace: "Replace the fitted set",
      keepBoth: "Add it alongside",
      keepBothNote: "The original stays where it is.",
    },

    hint: {
      reference: "What is written on the sidewall, or what you would ask for at the counter.",
      axle: "A pair is fitted front or rear as you please: moving it across is an ordinary rotation.",
      dot: "The four digits at the end of the DOT code: two of week, two of year. “3223” is week 32 of 2023.",
      label: "Only to tell two sets of the same reference apart.",
      price: "For the whole set. Divided by what it runs, it says which reference was actually the cheapest.",
      storage: "The question you ask six months later, and nothing else answers it.",
      initial_total: "What the tyres had already run when you declared them. Written once; afterwards the total is corrected from the set itself.",
      pressure: "The door-sticker figure, cold, in bar. Filled in, any pressure sensor becomes an alarm.",
      vehicle: "Names the device and, through it, every entity of this car.",
      odometer_entity: "Leave empty if the counter is typed in by hand.",
      initial_odometer: "Where the counter stands today. A set fitted before the odometer is known starts counting from zero.",
      rotation_interval: "Kilometres between two rotations. Zero says nothing about it.",
      tpms: "One sensor per tyre, held by the set: it is screwed to the wheel, so it travels with it, not with the car.",
      replace: "The old set comes off and closes its count at today's reading; the new one goes on in its place.",
    },

    act: {
      save: "Save",
      cancel: "Cancel",
      back: "Back",
      edit: "Edit",
      delete: "Delete",
      discard: "Discard",
      deleteSet: "Delete the set",
      deleteVehicle: "Delete this vehicle",
      duplicate: "Duplicate",
      mount: "Fit",
      mountAt: (position) => `Fit at the ${position.toLowerCase()}`,
      moveTo: (position) => `Move to the ${position.toLowerCase()}`,
      unmount: "Remove",
      rotate: "Rotate",
      separate: "Separate",
      retire: "Move to history",
      restore: "Put back into service",
      adjust: "Correct the total",
      addSet: "Add the set",
      createCopy: "Create the copy",
      confirm: "Confirm",
      keepTracking: "Keep the tracking",
      takeSensor: "Take the sensor's reading",
    },

    ask: {
      mount: "Fit this set",
      mountLede: "Fitting closes the count of whatever it displaces, at the reading below.",
      unmount: "Take the tyres off",
      unmountLede: "The car is left on jacks: the count is closed and nothing goes back on.",
      rotate: "Record a rotation",
      rotateLede: "Each wheel moves to the other end of its side. The mileage does not change — what is recorded is the date, and the sensors follow their wheels.",
      retire: "Move to the history",
      retireLede: "The set keeps its mileage, frozen. It can be put back into service at any time.",
      adjust: "Correct the total",
      adjustLede: "A tracking taken over, a swap entered a month late, a second-hand set: the total is a figure you know better than the integration does.",
      separate: "Separate into two pairs",
      separateLede: "Both halves carry away what the four ran together, then count for themselves. One keeps this record; the other is born from it.",
      odometer: "Odometer reading",
      odometerLede: "An odometer does not go backwards: a reading below the one recorded is refused.",
      resync: "Two readings disagree",
      resyncLede: (entity, reading, tracked) =>
        `${entity} reads ${reading} km, where ${tracked} km have been counted. Taking the sensor settles the fitted sets at ${tracked} km — those kilometres stay theirs — then counts again from ${reading} km.`,
      deleteSet: (name) =>
        `Delete “${name}”? Its device and its sensor go with it. The kilometres are kept in the store: adding the set back finds them again.`,
      deleteVehicle: (name) =>
        `Delete “${name}”? Its device, its entities, its tyre sets and every kilometre counted for them go with it. Nothing brings them back.`,
      deleteLastVehicle: (name) =>
        `Delete “${name}”? It is the last vehicle: its device, its entities, its tyre sets and every kilometre counted for them go with it, and this page leaves the sidebar until a car is declared again. Nothing brings them back.`,
    },

    vehicle: {
      title: "This vehicle",
      lede: "The name is the device's, and through it the name of every entity of this car.",
      dangerTitle: "Delete this vehicle",
      danger: "The device, its entities, its tyre sets and every kilometre counted for them go with the car. Nothing brings them back.",
    },

    history: {
      none: "Nothing recorded yet.",
      mounted: "Fitted",
      unmounted: "Removed",
      retired: "Moved to history",
      restored: "Put back into service",
      rotated: "Rotated",
      adjusted: "Total corrected",
      separated: "Separated",
      added: (km) => `+${km} km`,
    },

    errors: {
      reference_required: () => "Give the tyres a reference — what is written on the sidewall.",
      dot_invalid: () => "A date code reads as two digits of week, then two of year — for example “3223”.",
      tpms_duplicate: () => "That sensor is already on another wheel of this set. One sensor is screwed to one wheel.",
      axle_conflict: () => "This set is fitted and the other axle already carries something else: growing it to four wheels would declare six on the car. Take the other set off first.",
      replace_axle: () => "Replacing puts the copy exactly where the original stands, so it must cover the same wheels. Add the copy without replacing, then fit it separately.",
      initial_total_invalid: () => "That distance is not a number.",
      odometer_required: () => "Give a reading first: this car's odometer is typed in by hand.",
      vehicle_required: () => "Give the vehicle a name.",
      vehicle_exists: () => "Another vehicle already goes by that name.",
      sets_stale: () => "The sets of this vehicle changed elsewhere while this page was open — a rotation, another browser, a set deleted from its own page. Nothing has been written and the page has just been read again: check it, then make the change once more if it still applies.",
      interval_invalid: () => "The rotation reminder reads in kilometres, from 0 to 100 000.",
      not_loaded: () => "The vehicle is not loaded right now.",
      unknown_set: () => "That set no longer exists.",
      unknown_entry: () => "That vehicle no longer exists.",
      not_separable: () => "Only a set of four in service can be separated.",
      not_replaceable: () => "Only a fitted set can be replaced.",
      set_retired: () => "A set in the history cannot be fitted. Put it back into service first.",
      not_mounted: () => "That set is not on the car: there is nothing to rotate.",
      pair_not_rotatable: () => "A pair changes ends by being fitted to the other axle, which is a swap and is recorded as one.",
      odometer_backwards: () => "An odometer does not go backwards: that reading is below the one already recorded.",
    },
    rawError: (raw) => `Refused: ${raw}`,
  },

  fr: {
    loading: "Chargement…",
    loadError: "La configuration n'a pas pu être lue.",
    retry: "Réessayer",
    saved: "Enregistré.",
    deleted: "Véhicule supprimé.",
    discardConfirm: "Abandonner les modifications en cours ?",
    menu: "Menu",
    noVehicle: "Aucun véhicule pour l'instant. Déclarez le premier ici même — une entrée par voiture.",
    addVehicle: "Ajouter un véhicule",
    notLoaded: "Ce véhicule n'est pas chargé : ses fiches se lisent, rien ne peut leur être fait. Corrigez ce que signale sa notification, puis revenez.",

    tabs: { sets: "Trains", vehicle: "Véhicule", history: "Historique" },

    car: {
      title: "Sur la voiture",
      empty: "Rien de monté",
      odometer: "Compteur",
      auto: (entity) => `lu depuis ${entity}`,
      manual: "saisi à la main",
      setOdometer: "Saisir un relevé",
    },

    sets: {
      none: "Aucun train déclaré. Ajoutez-en un pour commencer à compter ses kilomètres.",
      add: "Ajouter un train",
      fallback: "Train",
      history: "Historique",
      sensors: "Capteurs de pression",
    },

    status: {
      mounted: "Monté",
      mountedAt: (position) => `Monté à l'${position.toLowerCase()}`,
      off: "Déposé",
      retired: "À l'historique",
      since: (date) => `depuis le ${date}`,
      rotationDue: "Permutation à faire",
      sinceRotation: (km) => `${km} km depuis la dernière permutation`,
      neverRotated: "Jamais permuté",
      aged: (years) => `${years} ans`,
      agedHint: "Un pneu vieillit à l'arrêt, quel que soit son kilométrage",
      age: (years) => `${years} ans`,
      costPer: (amount) => `${amount} € / 1000 km`,
      stale: "Pas de relevé récent",
      alarm: "Pression hors plage",
    },

    season: { summer: "Été", winter: "Hiver", all_season: "4 saisons" },
    axle: { all: "4 roues", pair: "2 roues (une paire)" },
    position: { front: "Avant", rear: "Arrière" },
    corner: {
      front_left: "Avant gauche", front_right: "Avant droit",
      rear_left: "Arrière gauche", rear_right: "Arrière droit",
    },
    side: { left: "Gauche", right: "Droite" },

    field: {
      reference: "Référence",
      season: "Type",
      axle: "Roues",
      size: "Dimension",
      dot: "Code DOT",
      label: "Libellé",
      price: "Prix",
      storage: "Rangé à",
      initial_total: "Kilométrage déjà parcouru",
      pressure_front: "Pression cible avant",
      pressure_rear: "Pression cible arrière",
      vehicle: "Véhicule",
      odometer_entity: "Entité odomètre",
      rotation_interval: "Permuter tous les",
      initial_odometer: "Relevé actuel du compteur",
      odometer: "Relevé du compteur",
      total: "Cumul de ce train",
      position: "Quel essieu",
      pair: "Paire qui part",
      newLabel: "Libellé de la nouvelle paire",
      replace: "Remplacer le train monté",
      keepBoth: "Ajouter à côté",
      keepBothNote: "L'original reste où il est.",
    },

    hint: {
      reference: "Ce qui est écrit sur le flanc, ou ce que vous demanderiez au comptoir.",
      axle: "Une paire se monte à l'avant ou à l'arrière comme on veut : la déplacer est une permutation ordinaire.",
      dot: "Les quatre chiffres au bout du code DOT : deux de semaine, deux d'année. « 3223 », c'est la semaine 32 de 2023.",
      label: "Uniquement pour distinguer deux trains de même référence.",
      price: "Pour le train entier. Divisé par ce qu'il parcourt, il dit quelle référence revenait le moins cher.",
      storage: "La question qu'on se pose six mois plus tard, et à laquelle rien d'autre ne répond.",
      initial_total: "Ce que les pneus avaient déjà parcouru à leur déclaration. Écrit une fois ; ensuite le cumul se corrige depuis le train.",
      pressure: "Le chiffre de l'étiquette de portière, à froid, en bar. Renseigné, n'importe quel capteur de pression devient une alarme.",
      vehicle: "Nomme l'appareil et, à travers lui, chaque entité de cette voiture.",
      odometer_entity: "Laisser vide si le compteur se saisit à la main.",
      initial_odometer: "Où en est le compteur aujourd'hui. Un train monté avant que le compteur soit connu compte à partir de zéro.",
      rotation_interval: "Kilomètres entre deux permutations. Zéro n'en dit rien.",
      tpms: "Un capteur par pneu, tenu par le train : il est vissé à la roue, il voyage donc avec elle et non avec la voiture.",
      replace: "L'ancien train est déposé et clôt son compte au relevé du jour ; le nouveau prend sa place.",
    },

    act: {
      save: "Enregistrer",
      cancel: "Annuler",
      back: "Retour",
      edit: "Modifier",
      delete: "Supprimer",
      discard: "Abandonner",
      deleteSet: "Supprimer le train",
      deleteVehicle: "Supprimer ce véhicule",
      duplicate: "Dupliquer",
      mount: "Monter",
      mountAt: (position) => `Monter à l'${position.toLowerCase()}`,
      moveTo: (position) => `Déplacer à l'${position.toLowerCase()}`,
      unmount: "Déposer",
      rotate: "Permuter",
      separate: "Séparer",
      retire: "Passer à l'historique",
      restore: "Remettre en service",
      adjust: "Corriger le cumul",
      addSet: "Ajouter le train",
      createCopy: "Créer la copie",
      confirm: "Confirmer",
      keepTracking: "Garder le suivi",
      takeSensor: "Prendre le relevé du capteur",
    },

    ask: {
      mount: "Monter ce train",
      mountLede: "Le montage clôt le compte de ce qu'il remplace, au relevé ci-dessous.",
      unmount: "Déposer les pneus",
      unmountLede: "La voiture reste sur chandelles : le compte est clos et rien ne remonte.",
      rotate: "Enregistrer une permutation",
      rotateLede: "Chaque roue passe à l'autre bout de son côté. Le kilométrage ne bouge pas — ce qui est noté, c'est la date, et les capteurs suivent leurs roues.",
      retire: "Passer à l'historique",
      retireLede: "Le train garde son kilométrage, figé. Il peut être remis en service à tout moment.",
      adjust: "Corriger le cumul",
      adjustLede: "Un suivi repris, une permutation notée un mois trop tard, un train d'occasion : le cumul est un chiffre que vous connaissez mieux que l'intégration.",
      separate: "Séparer en deux paires",
      separateLede: "Les deux moitiés emportent ce que les quatre ont parcouru ensemble, puis comptent pour elles-mêmes. L'une garde cette fiche, l'autre en naît.",
      odometer: "Relevé du compteur",
      odometerLede: "Un compteur ne recule pas : un relevé inférieur à celui enregistré est refusé.",
      resync: "Deux relevés se contredisent",
      resyncLede: (entity, reading, tracked) =>
        `${entity} affiche ${reading} km, là où ${tracked} km ont été comptés. Prendre le capteur clôt les trains montés à ${tracked} km — ces kilomètres restent les leurs — puis recompte à partir de ${reading} km.`,
      deleteSet: (name) =>
        `Supprimer « ${name} » ? Son appareil et son capteur partent avec. Les kilomètres restent dans le stockage : remettre le train les retrouve.`,
      deleteVehicle: (name) =>
        `Supprimer « ${name} » ? Son appareil, ses entités, ses trains et chaque kilomètre compté pour eux partent avec. Rien ne les ramène.`,
      deleteLastVehicle: (name) =>
        `Supprimer « ${name} » ? C'est le dernier véhicule : son appareil, ses entités, ses trains et chaque kilomètre compté pour eux partent avec, et cette page quitte la barre latérale jusqu'à ce qu'une voiture soit déclarée à nouveau. Rien ne les ramène.`,
    },

    vehicle: {
      title: "Ce véhicule",
      lede: "Le nom est celui de l'appareil, et à travers lui celui de chaque entité de cette voiture.",
      dangerTitle: "Supprimer ce véhicule",
      danger: "L'appareil, ses entités, ses trains et chaque kilomètre compté pour eux partent avec la voiture. Rien ne les ramène.",
    },

    history: {
      none: "Rien d'enregistré pour l'instant.",
      mounted: "Monté",
      unmounted: "Déposé",
      retired: "Passé à l'historique",
      restored: "Remis en service",
      rotated: "Permuté",
      adjusted: "Cumul corrigé",
      separated: "Séparé",
      added: (km) => `+${km} km`,
    },

    errors: {
      reference_required: () => "Donnez une référence aux pneus — ce qui est écrit sur le flanc.",
      dot_invalid: () => "Un code DOT se lit deux chiffres de semaine, puis deux d'année — par exemple « 3223 ».",
      tpms_duplicate: () => "Ce capteur est déjà sur une autre roue de ce train. Un capteur est vissé à une roue.",
      axle_conflict: () => "Ce train est monté et l'autre essieu porte déjà autre chose : le passer à quatre roues en déclarerait six sur la voiture. Déposez l'autre train d'abord.",
      replace_axle: () => "Le remplacement met la copie exactement là où est l'original : elle doit couvrir les mêmes roues. Ajoutez la copie sans remplacer, puis montez-la séparément.",
      initial_total_invalid: () => "Ce kilométrage n'est pas un nombre.",
      odometer_required: () => "Saisissez d'abord un relevé : le compteur de cette voiture se saisit à la main.",
      vehicle_required: () => "Donnez un nom au véhicule.",
      vehicle_exists: () => "Un autre véhicule porte déjà ce nom.",
      sets_stale: () => "Les trains de ce véhicule ont changé ailleurs pendant que cette page était ouverte — une permutation, un autre navigateur, un train supprimé depuis sa propre page. Rien n'a été écrit et la page vient d'être relue : vérifiez, puis recommencez si la modification tient toujours.",
      interval_invalid: () => "Le rappel de permutation se lit en kilomètres, de 0 à 100 000.",
      not_loaded: () => "Le véhicule n'est pas chargé pour le moment.",
      unknown_set: () => "Ce train n'existe plus.",
      unknown_entry: () => "Ce véhicule n'existe plus.",
      not_separable: () => "Seul un train de quatre en service peut être séparé.",
      not_replaceable: () => "Seul un train monté peut être remplacé.",
      set_retired: () => "Un train à l'historique ne peut pas être monté. Remettez-le en service d'abord.",
      not_mounted: () => "Ce train n'est pas sur la voiture : il n'y a rien à permuter.",
      pair_not_rotatable: () => "Une paire change de bout en étant montée sur l'autre essieu, ce qui est un montage et se note comme tel.",
      odometer_backwards: () => "Un compteur ne recule pas : ce relevé est inférieur à celui déjà enregistré.",
    },
    rawError: (raw) => `Refusé : ${raw}`,
  },
};

/** The three markings of a sidewall, and the shade that goes with each. */
const SEASON_LOOK = {
  summer: { icon: "mdi:white-balance-sunny", tint: "#E8A33D" },
  winter: { icon: "mdi:snowflake", tint: "#4FA3D1" },
  all_season: { icon: "mdi:sun-snowflake", tint: "#6FA96F" },
};
/** A set out of service: an archive box rather than a worn tyre. */
const RETIRED_LOOK = { icon: "mdi:archive-outline", tint: "#8C8C8C" };

const AXLE_ICONS = { all: "mdi:numeric-4-box-outline", pair: "mdi:numeric-2-box-outline" };

/** "fr-CA" has no table of its own; its base language has one, and that is the answer. */
function pickLanguage(want) {
  const asked = String(want || "en");
  const base = asked.split("-")[0].split("_")[0];
  return WORDS[asked] ? asked : WORDS[base] ? base : "en";
}

/** English, overlaid with whatever the chosen language actually translated. */
function mergeWords(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    const under = out[key];
    // Plain objects merge; strings and functions replace. `typeof fn` is
    // "function", never "object", so a translated function is never walked into.
    out[key] =
      value && typeof value === "object" && under && typeof under === "object"
        ? mergeWords(under, value)
        : value;
  }
  return out;
}

let LANG = pickLanguage(
  (typeof document !== "undefined" && document.documentElement?.lang) ||
    (typeof navigator !== "undefined" && navigator.language)
);
let T = mergeWords(WORDS.en, WORDS[LANG]);

/** Adopt the reader's language. True when it changed and the page must be redrawn. */
function setLanguage(hass) {
  const next = pickLanguage(hass?.locale?.language || hass?.language || LANG);
  if (next === LANG) return false;
  LANG = next;
  T = mergeWords(WORDS.en, WORDS[LANG]);
  return true;
}

/* ---------- ha-selector loader (same trick as the card) ----------
   The component exists in the frontend, but its chunk is only loaded when a
   card opens its editor. So we ask Home Assistant to build the editor of a core
   card, which pulls it along. Without this, createElement("ha-selector") would
   render an empty box — and picking one entity out of two thousand is the one
   control worth borrowing rather than rebuilding. */
let formLoading = null;
function loadHaForm() {
  if (customElements.get("ha-selector")) return Promise.resolve();
  if (!formLoading) {
    formLoading = (async () => {
      const helpers = await window.loadCardHelpers?.();
      const card = await helpers?.createCardElement?.({ type: "entities", entities: [] });
      await card?.constructor?.getConfigElement?.();
    })().catch(() => {});
  }
  return formLoading;
}

/* ---------- tiny DOM helpers ---------- */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, cls = "") {
  const i = document.createElement("ha-icon");
  i.setAttribute("icon", name);
  if (cls) i.className = cls;
  return i;
}

function toast(node, message) {
  node.dispatchEvent(new CustomEvent("hass-notification", {
    detail: { message }, bubbles: true, composed: true,
  }));
}

/** A distance as it is written here: thin-spaced thousands, no decimal. */
function km(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}`.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A date as the reader's locale writes it, from an ISO stamp. */
function day(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(LANG, { day: "numeric", month: "short", year: "numeric" });
}

function money(value) {
  if (value === null || value === undefined) return null;
  return Number(value).toLocaleString(LANG, { maximumFractionDigits: 2 });
}

/** True when a field carries something. Zero counts. */
function filled(value) {
  return value !== undefined && value !== null && value !== "";
}

/** What a set is called on screen. */
function nameOf(record) {
  return record?.label || record?.reference || T.sets.fallback;
}

function look(record) {
  if (record?.live?.retired) return RETIRED_LOOK;
  return SEASON_LOOK[record?.season] ?? SEASON_LOOK.summer;
}

/** Turn a server refusal into a sentence. */
function wsError(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  // The codes this integration raises itself travel in the message, with
  // whatever they name after a colon — "reference_required:2".
  if (code === "invalid_config" || code === "invalid_action" || code === "invalid_format") {
    const [key, ...rest] = message.split(":");
    const fn = T.errors[key];
    return fn ? fn(...rest) : T.rawError(message);
  }
  // A coordinator refusal arrives under its own translation key, with Home
  // Assistant's sentence beside it. Ours first: it is written for this page.
  const fn = T.errors[code];
  if (fn) return fn();
  return message || T.rawError(code || "?");
}

const FONTS = `
:host {
  --f-base: calc(var(--ha-font-size-s, 14px) * 15 / 14);
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
}
`;

const CONTROLS = `
:host {
  --fp-ok:   var(--success-color, #3E9D6B);
  --fp-warn: var(--warning-color, #B38046);
  --fp-bad:  var(--error-color, #FF554C);

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
}
`;

const STYLE = `
  ${FONTS}
  ${CONTROLS}
  :host {
    display: block;
    /* Not 100vh: on a phone that is the height with the address bar retracted,
       so the scroller runs further than the screen and its last pixels sit
       under the fold, out of reach. The old unit stays underneath for the
       browsers that do not know the new one. */
    height: 100vh;
    height: 100dvh;
    overflow: auto;
    background: var(--primary-background-color);
    color: var(--primary-text-color);
    -webkit-font-smoothing: antialiased;
    font-size: var(--f-14);
  }
  * { box-sizing: border-box; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: var(--fp-s4) var(--fp-s4) calc(var(--fp-s5) * 2); }

  header.bar { display: flex; align-items: center; gap: var(--fp-s3); flex-wrap: wrap;
               padding: var(--fp-s2) var(--fp-s1) var(--fp-s4); }
  .logo { width: var(--fp-ctl-h); height: var(--fp-ctl-h); border-radius: var(--fp-ctl-r); flex: none;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
          display: flex; align-items: center; justify-content: center; }
  .logo ha-icon { --mdc-icon-size: 22px; width: 22px; height: 22px; }
  .title { font-size: var(--f-17); font-weight: 600; }
  .ver { font-size: var(--f-11); color: var(--secondary-text-color); }
  .bar .spacer { flex: 1; }

  .tabs { display: flex; gap: var(--fp-s0); padding: var(--fp-s1);
          background: var(--secondary-background-color); border-radius: var(--fp-ctl-r); }
  .tab { border: 0; background: transparent; color: var(--secondary-text-color); font: inherit;
         font-size: var(--f-13); font-weight: 500; height: var(--fp-pill-h); padding: 0 var(--fp-s4);
         border-radius: var(--fp-field-r); cursor: pointer; }
  .tab[aria-selected="true"] { background: var(--card-background-color); color: var(--primary-text-color);
                               font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .tab:focus-visible, button:focus-visible, input:focus-visible {
    outline: var(--fp-focus); outline-offset: var(--fp-focus-off); }

  .cars { display: flex; gap: var(--fp-s2); flex-wrap: wrap; margin: 0 0 var(--fp-s4); }
  .car-tab { display: inline-flex; align-items: center; gap: var(--fp-sh); border: 1px solid var(--divider-color);
             background: var(--card-background-color); color: var(--primary-text-color); font: inherit;
             font-size: var(--f-13); font-weight: 500; height: var(--fp-pill-h); padding: 0 var(--fp-s3);
             border-radius: var(--fp-pill-r); cursor: pointer; }
  .car-tab[aria-selected="true"] { border-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
  .car-tab ha-icon { --mdc-icon-size: 15px; width: 15px; height: 15px; }

  .note { font-size: var(--f-12-5); color: var(--secondary-text-color);
          background: var(--secondary-background-color); border-radius: var(--fp-ctl-r);
          padding: var(--fp-s2) var(--fp-s3); margin: 0 0 var(--fp-s4); }
  .note.warn { color: var(--fp-warn); background: color-mix(in srgb, var(--fp-warn) 12%, transparent); }
  .center { padding: calc(var(--fp-s5) * 3) var(--fp-s5); text-align: center; color: var(--secondary-text-color); }
  .center p { margin: 0 0 var(--fp-s4); }

  .card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
          border: 1px solid var(--divider-color); padding: var(--fp-s4); margin-bottom: var(--fp-s3); }
  h3.sec { font-size: var(--f-14); margin: 0 0 var(--fp-s1); }
  p.secsub { font-size: var(--f-12); color: var(--secondary-text-color); margin: 0 0 var(--fp-s3); }
  .toolbar { display: flex; align-items: center; gap: var(--fp-s3); flex-wrap: wrap; margin: 0 0 var(--fp-s3); }
  .toolbar .spacer { flex: 1; }

  /* ---------- the car plan ---------- */
  .plan { display: grid; grid-template-columns: 1fr 1fr; gap: var(--fp-s3); }
  @media (max-width: 600px) { .plan { grid-template-columns: 1fr; } }
  .axle { border: 1px solid var(--divider-color); border-radius: var(--fp-ctl-r); padding: var(--fp-s3);
          background: var(--secondary-background-color); }
  .axle .ah { font-size: var(--f-11); font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
              color: var(--secondary-text-color); margin-bottom: var(--fp-s1); }
  .axle .an { font-weight: 600; font-size: var(--f-14); display: flex; align-items: center; gap: var(--fp-sh); }
  .axle .an ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }
  .axle.empty .an { color: var(--secondary-text-color); font-weight: 500; }
  .axle .am { font-size: var(--f-12); color: var(--secondary-text-color); margin-top: var(--fp-s0); }

  .odo { display: flex; align-items: center; gap: var(--fp-s3); flex-wrap: wrap; margin-top: var(--fp-s3);
         border-top: 1px solid var(--divider-color); padding-top: var(--fp-s3); }
  .odo .big { font-size: var(--f-24); font-weight: 600; font-variant-numeric: tabular-nums; }
  .odo .k { font-size: var(--f-12); color: var(--secondary-text-color); }

  /* ---------- a set ---------- */
  .set-head { display: flex; align-items: center; gap: var(--fp-s3); }
  .mark { width: 38px; height: 38px; border-radius: var(--fp-ctl-r); flex: none; display: flex;
          align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--tint) 18%, transparent); color: var(--tint); }
  .mark ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; }
  .set-head .nm { font-weight: 600; font-size: var(--f-15); line-height: 1.2; }
  .set-head .st { font-size: var(--f-12); color: var(--secondary-text-color); }
  .set-head .spacer { flex: 1; }
  .set-head .run { text-align: right; }
  .set-head .run .v { font-size: var(--f-20); font-weight: 600; font-variant-numeric: tabular-nums; }
  .set-head .run .u { font-size: var(--f-11); color: var(--secondary-text-color); }
  .card.retired { opacity: .8; }

  .chips { display: flex; gap: var(--fp-sh); flex-wrap: wrap; margin-top: var(--fp-s3); }
  .chip { display: inline-flex; align-items: center; gap: var(--fp-s1); font-size: var(--f-12); font-weight: 500;
          border: 1px solid var(--divider-color); border-radius: var(--fp-pill-r);
          padding: var(--fp-s0) var(--fp-s2); color: var(--secondary-text-color); }
  .chip ha-icon { --mdc-icon-size: 13px; width: 13px; height: 13px; }
  .chip.warn { color: var(--fp-warn); border-color: color-mix(in srgb, var(--fp-warn) 45%, transparent); }
  .chip.bad { color: var(--fp-bad); border-color: color-mix(in srgb, var(--fp-bad) 45%, transparent); }
  .chip.on { color: var(--primary-color); border-color: color-mix(in srgb, var(--primary-color) 45%, transparent); }

  .wheels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--fp-s2);
            margin-top: var(--fp-s3); }
  .wheel { border: 1px solid var(--divider-color); border-radius: var(--fp-ctl-r); padding: var(--fp-s2);
           font-size: var(--f-12); display: flex; align-items: baseline; gap: var(--fp-s2);
           flex-wrap: wrap; }
  /* What is wrong with this wheel, said rather than merely coloured. Its own
     line: it is a sentence, not a third figure on the rank above. */
  .wheel .wn { flex: 0 0 100%; font-size: var(--f-10-5); line-height: 1.3; }
  .wheel .k { color: var(--secondary-text-color); font-size: var(--f-10-5); text-transform: uppercase;
              letter-spacing: .04em; }
  .wheel .v { font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; }
  .wheel.stale { border-style: dashed; color: var(--secondary-text-color); }
  .wheel.alarm { border-color: color-mix(in srgb, var(--fp-bad) 55%, transparent); color: var(--fp-bad); }

  .actions { display: flex; align-items: center; gap: var(--fp-s2); flex-wrap: wrap; margin-top: var(--fp-s3);
             border-top: 1px solid var(--divider-color); padding-top: var(--fp-s3); }
  .actions .spacer { flex: 1; }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--fp-sh);
         font: inherit; font-size: var(--f-13); font-weight: 600; border-radius: var(--fp-ctl-r);
         height: var(--fp-ctl-h); padding: 0 var(--fp-s4); cursor: pointer;
         border: 1px solid var(--divider-color); background: var(--card-background-color);
         color: var(--primary-text-color); }
  .btn ha-icon { --mdc-icon-size: 17px; width: 17px; height: 17px; }
  .btn.primary { background: var(--primary-color); border-color: var(--primary-color);
                 color: var(--text-primary-color, #fff); }
  .btn.ghost { border-color: transparent; color: var(--secondary-text-color); }
  .btn.danger { border-color: transparent; color: var(--fp-bad); }
  /* The one that carries out a deletion, in a sheet where it is the only thing
     to press. The plain .danger above is a row action among others; this one
     has to read as the end of a question. */
  .btn.danger.fill { border-color: var(--fp-bad); color: var(--fp-bad);
                     background: color-mix(in srgb, var(--fp-bad) 12%, transparent); }
  /* The sidebar, on a narrow screen where it is folded away. Without it this
     page is a room with no door: it fills the window, and Home Assistant draws
     no bar of its own above a custom panel. */
  .menu { border: 0; background: transparent; color: var(--primary-text-color);
          padding: var(--fp-s1); margin-left: calc(var(--fp-s1) * -1); cursor: pointer;
          display: inline-flex; align-items: center; border-radius: var(--fp-ctl-r); }
  .menu ha-icon { --mdc-icon-size: 24px; width: 24px; height: 24px; }
  .btn.small { height: var(--fp-pill-h); padding: 0 var(--fp-s3); font-size: var(--f-12-5); }
  .btn[disabled] { opacity: .5; cursor: default; }

  /* ---------- fields ---------- */
  .field { display: flex; align-items: center; gap: var(--fp-s3); padding: var(--fp-s2) 0;
           border-top: 1px solid var(--divider-color); font-size: var(--f-13); }
  .field:first-of-type { border-top: 0; }
  .field .flabel { flex: 1 1 200px; font-weight: 500; }
  .field .fhint { display: block; font-size: var(--f-11); color: var(--secondary-text-color); font-weight: 400; }
  .field.wrong .flabel { color: var(--fp-bad); }
  .fno { font-size: var(--f-11-5); color: var(--fp-bad); padding-bottom: var(--fp-s2); }
  .ftext { flex: 1 1 220px; min-width: 0; height: var(--fp-ctl-h); font: inherit; font-size: var(--f-13);
           padding: 0 var(--fp-s3); border-radius: var(--fp-field-r); border: 1px solid var(--divider-color);
           background: var(--card-background-color); color: var(--primary-text-color); }
  .ftext.fnum { flex: 0 0 130px; text-align: right; font-variant-numeric: tabular-nums; }
  .funit { color: var(--secondary-text-color); font-size: var(--f-12-5); flex: none; min-width: 28px; }
  .field.vertical { display: block; }
  .field.vertical .flabel { margin-bottom: var(--fp-s2); }

  .seg { display: flex; gap: var(--fp-s1); flex-wrap: wrap; }
  .seg button { display: inline-flex; align-items: center; gap: var(--fp-sh); border: 1px solid var(--divider-color);
                background: var(--card-background-color); color: var(--secondary-text-color); font: inherit;
                font-size: var(--f-12-5); font-weight: 500; height: var(--fp-ctl-h); padding: 0 var(--fp-s3);
                border-radius: var(--fp-ctl-r); cursor: pointer; }
  .seg button ha-icon { --mdc-icon-size: 16px; width: 16px; height: 16px; }
  .seg button[aria-checked="true"] { border-color: var(--pick, var(--primary-color));
                                     color: var(--pick, var(--primary-color)); font-weight: 600;
                                     background: color-mix(in srgb, var(--pick, var(--primary-color)) 12%, transparent); }
  .seg .sub { display: block; font-size: var(--f-10-5); font-weight: 400; color: var(--secondary-text-color); }
  .seg.stack { flex-direction: column; align-items: stretch; }
  .seg.stack button { height: auto; padding: var(--fp-s2) var(--fp-s3); text-align: left; justify-content: flex-start; }

  ha-selector { display: block; flex: 1 1 260px; }

  .slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--fp-s3);
           margin-top: var(--fp-s2); }
  @media (max-width: 600px) { .slots { grid-template-columns: 1fr; } }
  .slot .sk { font-size: var(--f-11); font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
              color: var(--secondary-text-color); margin-bottom: var(--fp-s1); }

  details.fold { border-top: 1px solid var(--divider-color); margin-top: var(--fp-s2); }
  details.fold summary { display: flex; align-items: center; gap: var(--fp-s2); padding: var(--fp-s3) 0;
                         cursor: pointer; font-weight: 600; font-size: var(--f-13); list-style: none; }
  details.fold summary::-webkit-details-marker { display: none; }
  details.fold summary ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px;
                                 color: var(--secondary-text-color); transition: transform .15s; }
  details.fold[open] summary ha-icon { transform: rotate(90deg); }

  .backbar { display: flex; align-items: center; gap: var(--fp-s2); margin-bottom: var(--fp-s3); }
  .backbar .bt { display: inline-flex; align-items: center; gap: var(--fp-s1); border: 0; background: transparent;
                 color: var(--secondary-text-color); font: inherit; font-size: var(--f-13); cursor: pointer; }
  .backbar .bt ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }

  /* ---------- history ---------- */
  .line { display: flex; align-items: center; gap: var(--fp-s3); padding: var(--fp-s2) 0;
          border-top: 1px solid var(--divider-color); font-size: var(--f-13); }
  .line:first-of-type { border-top: 0; }
  .line ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; color: var(--secondary-text-color); }
  .line .right { margin-left: auto; color: var(--secondary-text-color); font-size: var(--f-12);
                 font-variant-numeric: tabular-nums; }

  /* ---------- dialog ---------- */
  .scrim { position: fixed; inset: 0; z-index: 8; background: rgba(0,0,0,.45); }
  .dialog { position: fixed; z-index: 9; left: 50%; top: 50%; transform: translate(-50%, -50%);
            width: 460px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow-y: auto;
            background: var(--card-background-color); border: 1px solid var(--divider-color);
            border-radius: var(--ha-card-border-radius, 12px); padding: var(--fp-s4);
            box-shadow: 0 8px 32px rgba(0,0,0,.35); }
  .dialog h4 { margin: 0 0 var(--fp-s1); font-size: var(--f-16); }
  .dialog .lede { font-size: var(--f-12-5); color: var(--secondary-text-color); margin: 0 0 var(--fp-s3); }
  .dialog .foot { display: flex; align-items: center; gap: var(--fp-s2); margin-top: var(--fp-s4); }
  .dialog .foot .spacer { flex: 1; }
  .versus { display: grid; grid-template-columns: 1fr 1fr; gap: var(--fp-s3); margin-bottom: var(--fp-s3); }
  .fig { border: 1px solid var(--divider-color); border-radius: var(--fp-ctl-r); padding: var(--fp-s3); }
  .fig .k { font-size: var(--f-11); color: var(--secondary-text-color); text-transform: uppercase;
            letter-spacing: .04em; }
  .fig .v { font-size: var(--f-20); font-weight: 600; font-variant-numeric: tabular-nums; }
  .fig .w { font-size: var(--f-11); color: var(--secondary-text-color); overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

class TyreTrackerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cfg = null;
    this._state = "loading";  // loading | ready | error
    this._entryId = null;     // the vehicle being looked at
    this._tab = "sets";       // sets | vehicle | history
    this._edit = null;        // open set editor: {draft, clean, creating, replace, errors}
    this._vehicleDraft = null;
    this._vehicleClean = null;
    this._dialog = null;      // {spec, values, resolve}
    this._busy = false;
    this._liveNodes = [];     // mounted ha-selectors, refreshed on every render
    this._settleTimer = null; // the second read that follows a write
    this._settling = false;
    this._narrow = false;     // sidebar folded away: see the setter below
  }

  /* Panel contract: HA sets hass on every state change — render once, then only
     refresh the hass reference of the live HA elements. */
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const relang = setLanguage(hass);
    if (first) { this._load(); return; }
    if (relang) { this._render(); return; }
    for (const node of this._liveNodes) node.hass = hass;
  }
  get hass() { return this._hass; }

  /**
   * Whether the sidebar is folded away, which Home Assistant sets on every
   * panel and this one used to throw away.
   *
   * It is the whole question of how one leaves this page: a custom panel fills
   * the window and Home Assistant draws no bar above it, so on a narrow screen
   * the sidebar is both hidden and unreachable — the browser's back button was
   * the only way out. See `_headerBar`.
   */
  set narrow(narrow) {
    const next = Boolean(narrow);
    if (next === this._narrow) return;
    this._narrow = next;
    if (this._state !== "loading" || this.shadowRoot.firstChild) this._render();
  }

  set panel(_) {}

  /**
   * Route changes reach a panel that is already mounted through this setter:
   * the frontend keeps panel elements alive across navigations, so a link from
   * the card can land here without `_load` ever running again. The address is
   * read wherever it changes.
   */
  set route(_) {
    if (this._state === "ready") {
      this._openFromUrl();
      this._render();
    }
  }

  connectedCallback() {
    if (!this.shadowRoot.firstChild) this._renderShell();
    // Re-entered from the cache: the page is stale by however long it spent
    // detached, and the address may name a set to open.
    if (this._state === "ready") {
      this._openFromUrl();
      this._refresh().catch(() => this._render());
    }
  }

  /** Leaving the page cancels what was still to be read: nothing outlives it. */
  disconnectedCallback() {
    clearTimeout(this._settleTimer);
    this._settling = false;
    // A dialog left waiting would keep its promise for ever, and with it the
    // action that was about to be taken.
    this._dialog?.resolve(null);
    this._dialog = null;
  }

  /* ---------- data ---------- */

  async _load() {
    this._state = "loading";
    this._render();
    try {
      this._cfg = await this._hass.connection.sendMessagePromise({ type: WS_GET });
      this._state = "ready";
    } catch (err) {
      console.error(`${DOMAIN}: config load failed`, err);
      this._state = "error";
    }
    this._adoptVehicle();
    this._openFromUrl();
    this._render();
  }

  /**
   * What the address asks for: a car, and possibly one of its sets.
   *
   * The card links here with both — it knows which row was touched, and
   * arriving on a list one would have to find that row in again would undo the
   * gesture that opened the page. The query is then wiped from the address:
   * refreshing the page a day later must not reopen an editor on a set one has
   * long since forgotten about.
   */
  _openFromUrl() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch {
      return;
    }
    const wanted = params.get("vehicle");
    const set = params.get("set");
    if (!wanted && !set) return;
    if (wanted && (this._cfg?.vehicles ?? []).some((v) => v.entry_id === wanted)) {
      this._entryId = wanted;
    }
    const record = set ? this._setOf(set) : null;
    if (record) this._openEditor({ draft: this._draftOf(record), creating: false });
    history.replaceState(null, "", location.pathname);
  }

  /** Keep looking at the same car across a refresh; fall back to the first. */
  _adoptVehicle() {
    const vehicles = this._cfg?.vehicles ?? [];
    if (!vehicles.some((v) => v.entry_id === this._entryId)) {
      this._entryId = vehicles[0]?.entry_id ?? null;
    }
  }

  /** Re-read from the source of truth rather than trusting the local copy. */
  async _refresh() {
    this._cfg = await this._hass.connection.sendMessagePromise({ type: WS_GET });
    this._adoptVehicle();
    this._render();
  }

  /**
   * Write one section, then read everything back.
   *
   * A save reloads the entry, which rebuilds the coordinator: the counters that
   * come back are the ones the new records produced, and a local copy patched
   * by hand would show the old ones until the next visit.
   */
  async _save(section, data) {
    const message = { type: WS_SAVE, entry_id: this._entryId, section, data };
    // Saving a set writes the WHOLE list back, rebuilt from the copy this page
    // was handed — so it carries the print of that copy, and the server refuses
    // it if the list has moved since. What moves it without anyone touching
    // this page: a rotation re-files a set's pressure sensors into the options,
    // a second browser saves, a set is deleted from its own device page. The
    // vehicle section needs none of this — it writes its own three fields.
    if (section === "sets" && this._vehicle?.sets_rev) {
      message.sets_rev = this._vehicle.sets_rev;
    }
    let result;
    try {
      result = await this._hass.connection.sendMessagePromise(message);
    } catch (err) {
      // Refused for being out of date: read again straight away, so the page
      // shows what the server actually holds and a second attempt — if the
      // change is still wanted — starts from there rather than from the copy
      // that was just refused.
      if (String(err?.message || "") === "sets_stale") {
        await this._refresh().catch(() => {});
      }
      throw err;
    }
    await this._refresh();
    this._settle();
    return result;
  }

  async _act(payload) {
    // An absent answer is left out rather than sent as null: the command's
    // schema knows `position` as one of two words, and null is neither.
    const message = { type: WS_ACTION, entry_id: this._entryId };
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined) message[key] = value;
    }
    const result = await this._hass.connection.sendMessagePromise(message);
    await this._refresh();
    this._settle();
    return result;
  }

  /**
   * Read once more, a moment later.
   *
   * Writing a record reloads the vehicle, and a reload is not finished when the
   * save returns: Home Assistant runs the entry's update listener as a task of
   * its own. The figures read straight after therefore come from a coordinator
   * on its way out — or from none at all, for the second the entry is down.
   *
   * So the page reads again once the dust has settled. Not while something is
   * being typed: a refresh rebuilds every picker on the page, and one rebuilt
   * under the cursor loses what was half-chosen.
   */
  _settle() {
    clearTimeout(this._settleTimer);
    this._settling = true;
    this._settleTimer = setTimeout(() => {
      this._settling = false;
      // Not over an open editor or dialog: the refresh would rebuild the very
      // field being typed in, and the settled figures will be read at its close.
      if (this._edit || this._dialog || this._vehicleDraft) return;
      this._refresh().catch(() => this._render());
    }, 1200);
  }

  /** A write, with the waiting and the refusal handled once for all of them. */
  async _run(fn, done) {
    if (this._busy) return false;
    this._busy = true;
    this._render();
    try {
      await fn();
    } catch (err) {
      this._busy = false;
      this._render();
      toast(this, wsError(err));
      return false;
    }
    this._busy = false;
    this._render();
    if (done) toast(this, done);
    return true;
  }

  /* ---------- the current vehicle ---------- */

  get _vehicle() {
    return (this._cfg?.vehicles ?? []).find((v) => v.entry_id === this._entryId) ?? null;
  }

  get _schema() {
    return this._cfg?.schema ?? {};
  }

  _setOf(setId) {
    return (this._vehicle?.sets ?? []).find((s) => s.id === setId) ?? null;
  }

  /** What a position carries right now, by name. */
  _fittedName(position) {
    const vehicle = this._vehicle;
    const setId = vehicle?.mounted?.[position];
    if (!setId) return null;
    return nameOf(this._setOf(setId));
  }

  /** Where a pair would go by default: the free axle, or the other end. */
  _freeAxle(record) {
    const positions = this._schema.positions ?? ["front", "rear"];
    const on = record?.live?.positions ?? [];
    if (on.length) return positions.find((p) => !on.includes(p)) ?? positions[0];
    const mounted = this._vehicle?.mounted ?? {};
    return positions.find((p) => !mounted[p]) ?? positions[0];
  }

  /* ---------- shell ---------- */

  _renderShell() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.shadowRoot.append(style, el("div", "wrap"));
  }

  _render() {
    if (!this.shadowRoot.firstChild) this._renderShell();
    const wrap = this.shadowRoot.querySelector(".wrap");
    wrap.replaceChildren();
    this.shadowRoot.querySelectorAll(".scrim, .dialog").forEach((node) => node.remove());
    this._liveNodes = [];

    wrap.append(this._headerBar());

    if (this._state === "loading") {
      wrap.append(el("div", "center", T.loading));
      return;
    }
    if (this._state === "error") {
      const box = el("div", "center");
      box.append(el("p", "", T.loadError));
      const retry = el("button", "btn", T.retry);
      retry.addEventListener("click", () => this._load());
      box.append(retry);
      wrap.append(box);
      return;
    }

    const vehicles = this._cfg?.vehicles ?? [];
    if (!vehicles.length) {
      const box = el("div", "center");
      box.append(el("p", "", T.noVehicle));
      box.append(this._button(T.addVehicle, "mdi:plus", "primary", () => this._createVehicle()));
      wrap.append(box);
      // The declaration dialog opens over this very state: without this line
      // the early return would skip it, and the button would press for nothing.
      if (this._dialog) this._renderDialog();
      return;
    }

    // Everything below is built from ha-selector. WAIT for the chunk rather than
    // render now and re-render when it lands: that second render rebuilds every
    // node, so it would wipe whatever field was being typed in meanwhile.
    if (!customElements.get("ha-selector")) {
      wrap.append(el("div", "center", T.loading));
      loadHaForm().then(() => this._render());
      return;
    }

    if (vehicles.length > 1) wrap.append(this._carTabs(vehicles));

    const vehicle = this._vehicle;
    if (!vehicle) return;
    // Silent while a write settles: a vehicle is down for the second its reload
    // takes, and announcing that as a fault would make every save look like one.
    if (!vehicle.loaded && !this._settling) wrap.append(el("div", "note warn", T.notLoaded));

    if (this._edit) this._renderSetEditor(wrap);
    else if (this._tab === "sets") this._renderSets(wrap);
    else if (this._tab === "vehicle") this._renderVehicle(wrap);
    else this._renderHistory(wrap);

    if (this._dialog) this._renderDialog();
  }

  _headerBar() {
    const bar = el("header", "bar");
    // The way back to the sidebar, and only when it is folded: on a wide screen
    // the sidebar is already there and a second handle would be noise.
    // `hass-toggle-menu` is the event the app shell listens on — the same one
    // every full-page panel of Home Assistant sends.
    if (this._narrow) {
      const menu = el("button", "menu");
      menu.type = "button";
      menu.title = T.menu;
      menu.setAttribute("aria-label", T.menu);
      menu.append(icon("mdi:menu"));
      menu.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("hass-toggle-menu", {
          bubbles: true, composed: true,
        }));
      });
      bar.append(menu);
    }
    const logo = el("span", "logo");
    logo.append(icon("mdi:tire"));
    const box = el("div");
    box.append(el("div", "title", T.title));
    if (this._cfg?.version) box.append(el("div", "ver", `v${this._cfg.version}`));
    bar.append(logo, box, el("span", "spacer"));

    if (this._state === "ready" && (this._cfg?.vehicles ?? []).length) {
      const tabs = el("nav", "tabs");
      tabs.setAttribute("role", "tablist");
      for (const key of ["sets", "vehicle", "history"]) {
        const button = el("button", "tab", T.tabs[key]);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(this._tab === key && !this._edit));
        // Leaving by a tab drops the draft exactly as the back button does.
        // Keeping it alive would restore it silently on the way back, so the
        // two ways out of an editor would mean opposite things.
        button.addEventListener("click", async () => {
          if (!await this._leaveEditor()) return;
          this._tab = key;
          this._render();
        });
        tabs.append(button);
      }
      bar.append(tabs);
    }
    return bar;
  }

  _carTabs(vehicles) {
    const row = el("div", "cars");
    for (const vehicle of vehicles) {
      const button = el("button", "car-tab");
      button.setAttribute("aria-selected", String(vehicle.entry_id === this._entryId));
      button.append(icon("mdi:car"), el("span", "", vehicle.vehicle));
      button.addEventListener("click", async () => {
        if (vehicle.entry_id === this._entryId) return;
        if (!await this._leaveEditor()) return;
        this._entryId = vehicle.entry_id;
        this._render();
      });
      row.append(button);
    }
    const add = el("button", "car-tab");
    add.title = T.addVehicle;
    add.setAttribute("aria-label", T.addVehicle);
    add.append(icon("mdi:plus"));
    add.addEventListener("click", () => this._createVehicle());
    row.append(add);
    return row;
  }

  /**
   * Declare a new car, without leaving the page.
   *
   * The dialog asks what the first-install form asks — the name, the odometer
   * source, today's reading — and the server routes it through the same config
   * flow (`vehicle/create` → `async_step_import`), so both doors create the
   * same entry.
   */
  async _createVehicle() {
    // The entity picker needs Home Assistant's form chunk, which a page opened
    // on the empty state never had a reason to load yet.
    if (!customElements.get("ha-selector")) await loadHaForm();
    const fields = this._schema.vehicle_fields ?? {};
    const values = await this._ask({
      title: T.addVehicle,
      verb: T.addVehicle,
      fields: [
        { name: "vehicle", label: T.field.vehicle, hint: T.hint.vehicle },
        { name: "odometer_entity", kind: "entity", label: T.field.odometer_entity,
          spec: fields.odometer_entity?.selector ?? { entity: {} },
          hint: T.hint.odometer_entity },
        { name: "initial_odometer", kind: "number", label: T.field.initial_odometer,
          spec: { min: 0, max: 2_000_000, step: 10 }, hint: T.hint.initial_odometer },
      ],
    });
    if (!values) return;
    await this._run(async () => {
      const message = { type: WS_CREATE, vehicle: (values.vehicle ?? "").trim() };
      if (values.odometer_entity) message.odometer_entity = values.odometer_entity;
      if (values.initial_odometer !== null && values.initial_odometer !== undefined) {
        message.initial_odometer = values.initial_odometer;
      }
      const result = await this._hass.connection.sendMessagePromise(message);
      await this._refresh();
      // Land on the car just declared: its sets tab, empty, is the next thing
      // one fills in.
      if (result?.entry_id) this._entryId = result.entry_id;
      this._settle();
      this._render();
    }, T.saved);
  }

  /* ---------- unsaved-changes guard ---------- */

  _dirty() {
    if (this._edit && JSON.stringify(this._edit.draft) !== this._edit.clean) return true;
    if (this._vehicleDraft && JSON.stringify(this._vehicleDraft) !== this._vehicleClean) return true;
    return false;
  }

  /** Drop the open editor, asking first when it holds unsaved edits. */
  async _leaveEditor() {
    if (this._dirty()) {
      const go = await this._confirm({ title: T.discardConfirm, verb: T.act.discard });
      if (!go) return false;
    }
    this._edit = null;
    this._vehicleDraft = null;
    this._vehicleClean = null;
    return true;
  }

  /* ---------- the sets tab ---------- */

  _renderSets(wrap) {
    const vehicle = this._vehicle;
    wrap.append(this._carCard(vehicle));

    const bar = el("div", "toolbar");
    bar.append(el("h3", "sec", T.tabs.sets), el("span", "spacer"));
    bar.append(this._button(T.sets.add, "mdi:plus", "primary", () => this._openNew()));
    wrap.append(bar);

    if (!vehicle.sets.length) {
      wrap.append(el("div", "note", T.sets.none));
      return;
    }
    // In service first, history last: a retired set is a record one consults,
    // not a thing one acts on, and it would otherwise sit between two sets that
    // are actually on the shelf.
    const live = vehicle.sets.filter((s) => !s.live?.retired);
    const gone = vehicle.sets.filter((s) => s.live?.retired);
    for (const record of live) wrap.append(this._setCard(record));
    if (gone.length) {
      wrap.append(el("h3", "sec", T.sets.history));
      for (const record of gone) wrap.append(this._setCard(record));
    }
  }

  /** What the car carries, and what its counter reads. */
  _carCard(vehicle) {
    const card = el("div", "card");
    // The car names its own block. With a single vehicle there are no tabs to
    // name it, and a page that never says which car it is talking about is a
    // page one hesitates to save anything on.
    card.append(el("h3", "sec", vehicle.vehicle));
    card.append(el("p", "secsub", T.car.title));

    const plan = el("div", "plan");
    for (const position of this._schema.positions ?? ["front", "rear"]) {
      const name = this._fittedName(position);
      const box = el("div", `axle${name ? "" : " empty"}`);
      box.append(el("div", "ah", T.position[position]));
      const line = el("div", "an");
      if (name) {
        const record = this._setOf(vehicle.mounted[position]);
        const tone = look(record);
        const mark = icon(tone.icon);
        mark.style.color = tone.tint;
        line.append(mark, el("span", "", name));
      } else {
        line.append(el("span", "", T.car.empty));
      }
      box.append(line);
      const record = name ? this._setOf(vehicle.mounted[position]) : null;
      if (record?.live) {
        const bits = [`${km(record.live.distance)} km`];
        const since = day(record.live.mounted_since);
        if (since) bits.push(T.status.since(since));
        box.append(el("div", "am", bits.join(" · ")));
      }
      plan.append(box);
    }
    card.append(plan);

    const odo = el("div", "odo");
    const value = el("div");
    value.append(el("span", "big", km(vehicle.odometer)));
    value.append(document.createTextNode(" km"));
    odo.append(value);
    odo.append(el("span", "k", vehicle.odometer_entity
      ? T.car.auto(vehicle.odometer_entity)
      : T.car.manual));
    odo.append(el("span", "spacer"));
    // Typing a reading is only ever needed on a car that has no sensor: with
    // one, the figure below is the sensor's and typing over it would be undone
    // by the next state change.
    if (!vehicle.odometer_entity) {
      odo.append(this._button(T.car.setOdometer, "mdi:counter", "small", () => this._askOdometer()));
    }
    const unmounted = Object.values(vehicle.mounted ?? {}).some(Boolean);
    if (unmounted) {
      odo.append(this._button(T.act.unmount, "mdi:car-lifted-pickup", "small ghost", () => this._unmount()));
    }
    card.append(odo);
    return card;
  }

  _setCard(record) {
    const live = record.live;
    const tone = look(record);
    const card = el("div", `card${live?.retired ? " retired" : ""}`);
    card.style.setProperty("--tint", tone.tint);

    const head = el("div", "set-head");
    const mark = el("span", "mark");
    mark.append(icon(tone.icon));
    const text = el("div");
    text.append(el("div", "nm", nameOf(record)));
    text.append(el("div", "st", this._statusLine(record)));
    head.append(mark, text, el("span", "spacer"));
    if (live) {
      const run = el("div", "run");
      run.append(el("div", "v", km(live.distance)));
      run.append(el("div", "u", "km"));
      head.append(run);
    }
    card.append(head);
    card.append(this._setChips(record));

    const wheels = this._wheels(record);
    if (wheels) card.append(wheels);

    card.append(this._setActions(record));
    return card;
  }

  _statusLine(record) {
    const live = record.live;
    if (!live) return T.axle[record.axle] ?? "";
    const bits = [T.axle[record.axle]];
    if (live.retired) {
      const when = day(live.retired_at);
      bits.push(when ? `${T.status.retired} (${when})` : T.status.retired);
    } else if (live.mounted) {
      const positions = live.positions ?? [];
      bits.push(positions.length > 1
        ? T.status.mounted
        : T.status.mountedAt(T.position[positions[0]] ?? ""));
    } else {
      bits.push(T.status.off);
    }
    return bits.filter(Boolean).join(" · ");
  }

  _setChips(record) {
    const chips = el("div", "chips");
    const live = record.live;
    // `note` is what justifies the chip when the chip itself is an advice. It
    // becomes the tooltip AND the accessible name — which starts with the
    // visible text, because a name that does not contain what is written on
    // screen breaks voice control.
    const add = (text, iconName, cls = "", note = null) => {
      if (!text) return;
      const chip = el("span", `chip${cls ? ` ${cls}` : ""}`);
      if (iconName) chip.append(icon(iconName));
      chip.append(el("span", "", text));
      if (note) {
        chip.title = note;
        chip.setAttribute("aria-label", `${text} — ${note}`);
      }
      chips.append(chip);
    };

    add(T.season[record.season], SEASON_LOOK[record.season]?.icon);
    add(T.axle[record.axle], AXLE_ICONS[record.axle]);
    add(record.size, "mdi:ruler");
    if (record.dot) {
      const years = live?.age_years;
      // Past the age tyres are changed at, the age is said as an age and not
      // as a figure — and the reason follows it. The amber alone said this
      // before, which told nothing to a colour-blind eye and nothing at all to
      // a screen reader.
      const old = Boolean(live?.aged);
      const text = years !== null && years !== undefined
        ? `${record.dot} · ${old ? T.status.aged(years) : T.status.age(years)}`
        : record.dot;
      add(text, "mdi:calendar", old ? "warn" : "", old ? T.status.agedHint : null);
    }
    if (live?.cost_per_1000 !== null && live?.cost_per_1000 !== undefined) {
      add(T.status.costPer(money(live.cost_per_1000)), "mdi:cash");
    } else if (record.price) {
      add(`${money(record.price)} €`, "mdi:cash");
    }
    add(record.storage, "mdi:archive");
    if (live && record.axle === "all" && live.mounted) {
      const since = live.km_since_rotation;
      const figure = since === null || since === undefined
        ? T.status.neverRotated
        : T.status.sinceRotation(km(since));
      // Once the interval is passed, the chip says the advice and the figure
      // that justifies it moves behind — the same order the card puts them in.
      add(
        live.rotation_due ? T.status.rotationDue : figure,
        "mdi:rotate-3d-variant",
        live.rotation_due ? "warn" : "",
        live.rotation_due ? figure : null
      );
    }
    return chips;
  }

  /** The pressure sensors as they read right now, one box per wheel. */
  _wheels(record) {
    const readings = record.live?.tpms ?? {};
    const slots = Object.keys(readings);
    if (!slots.length) return null;
    const grid = el("div", "wheels");
    for (const slot of slots) {
      const read = readings[slot];
      const box = el("div", `wheel${read.stale ? " stale" : ""}${read.alarm ? " alarm" : ""}`);
      box.append(el("span", "k", read.label || slot));
      // The unit is the sensor's, carried with the figure: a probe reporting
      // psi would otherwise be written « 32 bar », which is a tyre about to go.
      const value = read.pressure;
      box.append(el("span", "v", value === null || value === undefined
        ? "—"
        : `${Number(value).toFixed(2)}${read.unit ? ` ${read.unit}` : ""}`));
      // In words as well as in colour. A tooltip does not open under a finger
      // and is read by no screen reader worth the name: on a grid of four
      // wheels, the red border was the whole message.
      const note = read.alarm ? T.status.alarm : read.stale ? T.status.stale : null;
      if (note) {
        box.title = note;
        box.setAttribute("aria-label", `${read.label || slot} — ${note}`);
        box.append(el("span", "wn", note));
      }
      grid.append(box);
    }
    return grid;
  }

  _setActions(record) {
    const row = el("div", "actions");
    const live = record.live;
    const loaded = Boolean(this._vehicle?.loaded && live);
    if (loaded && !live.retired) {
      // A set of four already on the car has nowhere left to go. A fitted pair
      // keeps the button: it is how a pair changes ends.
      const isFullyOn = record.axle === "all" && live.mounted;
      if (!isFullyOn) {
        const target = this._freeAxle(record);
        const label = record.axle === "all"
          ? T.act.mount
          : live.mounted
            ? T.act.moveTo(T.position[target])
            : T.act.mountAt(T.position[target]);
        row.append(this._button(label, "mdi:car-wrench", "primary small", () => this._mount(record)));
      }
      if (record.axle === "all" && live.mounted) {
        row.append(this._button(T.act.rotate, "mdi:rotate-3d-variant", "small", () => this._rotate(record)));
      }
      // Separating is the same shape of act as rotating, minus the requirement
      // of being fitted: a set of four bought as four can be split on the shelf.
      if (record.axle === "all") {
        row.append(this._button(T.act.separate, "mdi:call-split", "small", () => this._separate(record)));
      }
    }

    row.append(this._button(T.act.edit, "mdi:pencil", "small", () => this._openEdit(record)));
    if (loaded) {
      row.append(this._button(T.act.adjust, "mdi:counter", "small", () => this._adjust(record)));
      row.append(this._button(T.act.duplicate, "mdi:content-copy", "small", () => this._openDuplicate(record)));
    }
    row.append(el("span", "spacer"));
    if (loaded) {
      row.append(live.retired
        ? this._button(T.act.restore, "mdi:backup-restore", "small ghost", () => this._restore(record))
        : this._button(T.act.retire, "mdi:archive-arrow-down", "small ghost", () => this._retire(record)));
    }
    row.append(this._button(T.act.delete, "mdi:trash-can-outline", "small danger", () => this._delete(record)));
    return row;
  }

  /* ---------- the set editor ---------- */

  _openNew() {
    const defaults = this._schema.set_fields ?? {};
    this._openEditor({
      draft: {
        reference: "", season: defaults.season?.default ?? "summer",
        axle: defaults.axle?.default ?? "all", size: "", dot: "", label: "",
        price: null, pressure_front: null, pressure_rear: null, storage: "",
        initial_total: 0, tpms: {},
      },
      creating: true,
    });
  }

  _openEdit(record) {
    this._openEditor({ draft: this._draftOf(record), creating: false });
  }

  /**
   * A copy of the record, ready to be a second set.
   *
   * The label goes: it exists to tell two sets apart, and a copy inheriting it
   * would defeat its only job. The date code goes: a second set bought two
   * years later shares the reference, never the week it left the factory. The
   * sensors go: they are screwed to the wheels of the set being copied. And
   * what the original has run goes, because the whole point of copying a set is
   * to watch the second one wear against the first.
   */
  _openDuplicate(record) {
    const draft = this._draftOf(record);
    delete draft.id;
    draft.label = "";
    draft.dot = "";
    draft.tpms = {};
    draft.initial_total = 0;
    this._openEditor({
      draft,
      creating: true,
      // Replacing is only on offer while the original is on the car. Off it,
      // the copy is a second set bought alongside the first, and there is
      // nothing to take off.
      from: record.live?.mounted && !record.live?.retired ? record : null,
      replace: Boolean(record.live?.mounted && !record.live?.retired),
    });
  }

  _draftOf(record) {
    return {
      id: record.id,
      reference: record.reference ?? "",
      season: record.season,
      axle: record.axle,
      size: record.size ?? "",
      dot: record.dot ?? "",
      label: record.label ?? "",
      price: record.price ?? null,
      pressure_front: record.pressure_front ?? null,
      pressure_rear: record.pressure_rear ?? null,
      storage: record.storage ?? "",
      tpms: { ...(record.tpms ?? {}) },
    };
  }

  _openEditor(edit) {
    this._edit = { replace: false, from: null, odometer: null, errors: {}, ...edit,
                   clean: JSON.stringify(edit.draft) };
    this._render();
  }

  _renderSetEditor(wrap) {
    const edit = this._edit;
    const draft = edit.draft;
    const fields = this._schema.set_fields ?? {};

    const back = el("div", "backbar");
    const button = el("button", "bt");
    button.append(icon("mdi:chevron-left"), document.createTextNode(T.act.back));
    button.addEventListener("click", async () => { if (await this._leaveEditor()) this._render(); });
    back.append(button);
    wrap.append(back);

    const card = el("div", "card");
    card.append(el("h3", "sec", edit.creating
      ? (edit.from ? T.act.duplicate : T.sets.add)
      : T.act.edit));

    const set = (name, value) => { draft[name] = value; };
    const err = (name) => edit.errors[name];

    // What is written on the sidewall first — brand and model, then type, then
    // how many wheels — and the refinements after.
    card.append(this._textRow(T.field.reference, draft.reference, (v) => set("reference", v),
      { hint: T.hint.reference, placeholder: "Michelin CrossClimate 2", error: err("reference") }));
    card.append(this._choiceRow(T.field.season, draft.season,
      (this._schema.seasons ?? []).map((value) => ({
        value, label: T.season[value], icon: SEASON_LOOK[value]?.icon, tint: SEASON_LOOK[value]?.tint,
      })), (v) => set("season", v)));
    card.append(this._choiceRow(T.field.axle, draft.axle,
      (this._schema.axles ?? []).map((value) => ({
        value, label: T.axle[value], icon: AXLE_ICONS[value],
      })), (v) => {
        set("axle", v);
        // The slots change with the count, and a sensor left under « rear left »
        // on a pair would be read at a corner the pair may never sit at.
        draft.tpms = {};
        this._render();
      }, { hint: T.hint.axle, error: err("axle") }));

    const more = el("details", "fold");
    // A filled field is not hidden — one would edit half a record without
    // seeing it — and neither is a refused one: an error under a closed fold
    // is an error nobody finds.
    if (["size", "dot", "label", "price", "storage", "pressure_front", "pressure_rear"]
        .some((name) => filled(draft[name]))
        || ["dot", "initial_total"].some((name) => edit.errors[name])) {
      more.open = true;
    }
    const summary = el("summary");
    summary.append(icon("mdi:chevron-right"), document.createTextNode(
      `${T.field.size} · ${T.field.dot} · ${T.field.price} · ${T.field.storage}…`));
    more.append(summary);
    const box = el("div");
    box.append(this._textRow(T.field.size, draft.size, (v) => set("size", v),
      { placeholder: "225/45 R17" }));
    box.append(this._numberRow(T.field.pressure_front, draft.pressure_front, fields.pressure_front,
      (v) => set("pressure_front", v), { hint: T.hint.pressure }));
    box.append(this._numberRow(T.field.pressure_rear, draft.pressure_rear, fields.pressure_rear,
      (v) => set("pressure_rear", v)));
    box.append(this._textRow(T.field.dot, draft.dot, (v) => set("dot", v),
      { hint: T.hint.dot, placeholder: "3223", error: err("dot") }));
    box.append(this._textRow(T.field.label, draft.label, (v) => set("label", v),
      { hint: T.hint.label }));
    box.append(this._numberRow(T.field.price, draft.price, fields.price,
      (v) => set("price", v), { hint: T.hint.price }));
    box.append(this._textRow(T.field.storage, draft.storage, (v) => set("storage", v),
      { hint: T.hint.storage }));
    if (edit.creating) {
      box.append(this._numberRow(T.field.initial_total, draft.initial_total, fields.initial_total,
        (v) => set("initial_total", v),
        { hint: T.hint.initial_total, error: err("initial_total") }));
    }
    more.append(box);
    card.append(more);
    wrap.append(card);

    // The sensors, on a plan of what this set covers.
    const sensors = el("div", "card");
    sensors.append(el("h3", "sec", T.sets.sensors));
    sensors.append(el("p", "secsub", T.hint.tpms));
    sensors.append(this._slotGrid(draft));
    wrap.append(sensors);

    if (edit.from) wrap.append(this._replaceCard(edit));

    const foot = el("div", "actions");
    foot.append(this._button(T.act.cancel, null, "ghost", async () => {
      if (await this._leaveEditor()) this._render();
    }));
    foot.append(el("span", "spacer"));
    const save = this._button(
      edit.creating ? (edit.from && edit.replace ? T.act.createCopy : T.act.addSet) : T.act.save,
      "mdi:check", "primary", () => this._saveEditor());
    if (this._busy) save.disabled = true;
    foot.append(save);
    wrap.append(foot);
  }

  /** The plan of the car, one picker per wheel this set covers. */
  _slotGrid(draft) {
    const grid = el("div", "slots");
    const slots = draft.axle === "all"
      ? (this._schema.corners ?? [])
      : (this._schema.sides ?? []);
    const labels = draft.axle === "all" ? T.corner : T.side;
    for (const slot of slots) {
      const box = el("div", "slot");
      box.append(el("div", "sk", labels[slot] ?? slot));
      box.append(this._entityControl(draft.tpms?.[slot], { device_class: "pressure", domain: "sensor" },
        (value) => {
          const tpms = { ...(draft.tpms ?? {}) };
          if (value) tpms[slot] = value; else delete tpms[slot];
          draft.tpms = tpms;
        }));
      grid.append(box);
    }
    return grid;
  }

  /** Replacing: one act, in the order the garage does it. */
  _replaceCard(edit) {
    const card = el("div", "card");
    card.append(el("h3", "sec", T.field.replace));
    card.append(el("p", "secsub", T.hint.replace));
    card.append(this._choiceRow("", edit.replace, [
      { value: true, label: T.field.replace, sub: nameOf(edit.from), icon: "mdi:swap-horizontal" },
      { value: false, label: T.field.keepBoth, sub: T.field.keepBothNote, icon: "mdi:garage-variant" },
    ], (value) => { edit.replace = value; this._render(); }, { stack: true }));
    if (edit.replace && !this._vehicle.odometer_entity) {
      card.append(this._numberRow(T.field.odometer, edit.odometer ?? this._vehicle.odometer,
        this._schema.odometer_field, (v) => { edit.odometer = v; }));
    }
    return card;
  }

  /** Which field a refusal is about, so it lands under that field. */
  static _FIELD_OF_ERROR = {
    reference_required: "reference",
    dot_invalid: "dot",
    axle_conflict: "axle",
    replace_axle: "axle",
    initial_total_invalid: "initial_total",
  };

  async _saveEditor() {
    const edit = this._edit;
    const draft = { ...edit.draft };
    edit.errors = {};

    const write = edit.creating && edit.from && edit.replace
      ? () => this._act({
          action: "replace",
          set_id: edit.from.id,
          record: draft,
          odometer: edit.odometer ?? null,
        })
      : () => {
          const records = (this._vehicle.sets ?? []).map((record) => this._draftOf(record));
          const payload = draft.id
            ? records.map((record) => (record.id === draft.id ? draft : record))
            : [...records, draft];
          return this._save("sets", payload);
        };

    if (this._busy) return;
    this._busy = true;
    this._render();
    try {
      await write();
    } catch (err) {
      this._busy = false;
      // A refusal that names a field lands under it, where the correction is
      // typed; anything else is said in the toast, as the actions do.
      const code = String(err?.message || "").split(":")[0];
      const field = TyreTrackerPanel._FIELD_OF_ERROR[code];
      if (field) edit.errors[field] = wsError(err);
      else toast(this, wsError(err));
      this._render();
      return;
    }
    this._busy = false;
    this._edit = null;
    this._render();
    toast(this, T.saved);
  }

  /* ---------- the manoeuvres ---------- */

  async _mount(record) {
    const fields = [];
    const isPair = record.axle !== "all";
    if (isPair) {
      fields.push({
        name: "position", kind: "choice", label: T.field.position,
        value: this._freeAxle(record),
        options: (this._schema.positions ?? []).map((value) => ({
          value, label: T.position[value],
          sub: this._fittedName(value) ?? T.car.empty,
        })),
        stack: true,
      });
    }
    if (!this._vehicle.odometer_entity) {
      fields.push(this._odometerField());
    }
    // A set of four, on a car whose odometer reads itself, leaves nothing to
    // ask: the axle is not a question and the mileage is already known.
    const values = fields.length
      ? await this._ask({ title: T.ask.mount, lede: T.ask.mountLede, sub: nameOf(record),
                          verb: T.act.mount, fields })
      : {};
    if (!values) return;
    await this._run(() => this._act({
      action: "mount", set_id: record.id,
      position: values.position ?? null, odometer: values.odometer ?? null,
    }), T.saved);
  }

  async _unmount() {
    const fields = this._vehicle.odometer_entity ? [] : [this._odometerField()];
    const values = await this._ask({
      title: T.ask.unmount, lede: T.ask.unmountLede, verb: T.act.unmount, fields,
    });
    if (!values) return;
    await this._run(() => this._act({ action: "unmount", odometer: values.odometer ?? null }), T.saved);
  }

  async _rotate(record) {
    const since = record.live?.km_since_rotation;
    const fields = this._vehicle.odometer_entity ? [] : [this._odometerField()];
    const values = await this._ask({
      title: T.ask.rotate, lede: T.ask.rotateLede, verb: T.act.rotate,
      sub: since === null || since === undefined
        ? `${nameOf(record)} · ${T.status.neverRotated}`
        : `${nameOf(record)} · ${T.status.sinceRotation(km(since))}`,
      fields,
    });
    if (!values) return;
    await this._run(() => this._act({
      action: "rotate", set_id: record.id, odometer: values.odometer ?? null,
    }), T.saved);
  }

  async _retire(record) {
    const fields = record.live?.mounted && !this._vehicle.odometer_entity
      ? [this._odometerField()]
      : [];
    const values = await this._ask({
      title: T.ask.retire, lede: T.ask.retireLede, sub: nameOf(record),
      verb: T.act.retire, fields,
    });
    if (!values) return;
    await this._run(() => this._act({
      action: "retire", set_id: record.id, odometer: values.odometer ?? null,
    }), T.saved);
  }

  async _restore(record) {
    await this._run(() => this._act({ action: "restore", set_id: record.id }), T.saved);
  }

  async _adjust(record) {
    const values = await this._ask({
      title: T.ask.adjust, lede: T.ask.adjustLede, sub: nameOf(record), verb: T.act.save,
      fields: [{
        name: "total", kind: "number", label: T.field.total,
        value: Math.round(record.live?.distance ?? 0),
        spec: this._schema.odometer_field,
      }],
    });
    if (!values) return;
    await this._run(() => this._act({
      action: "adjust", set_id: record.id, total: Number(values.total || 0),
    }), T.saved);
  }

  async _separate(record) {
    const fields = [
      {
        name: "pair", kind: "choice", label: T.field.pair, value: "front",
        options: (this._schema.positions ?? []).map((value) => ({
          value, label: T.position[value],
        })),
        stack: true,
      },
      { name: "label", kind: "text", label: T.field.newLabel, value: "" },
    ];
    if (record.live?.mounted && !this._vehicle.odometer_entity) fields.push(this._odometerField());
    const values = await this._ask({
      title: T.ask.separate, lede: T.ask.separateLede, sub: nameOf(record),
      verb: T.act.separate, fields,
    });
    if (!values) return;
    await this._run(() => this._act({
      action: "separate", set_id: record.id, pair: values.pair,
      label: values.label ?? "", odometer: values.odometer ?? null,
    }), T.saved);
  }

  async _delete(record) {
    const go = await this._confirm({
      title: T.act.deleteSet,
      lede: T.ask.deleteSet(nameOf(record)),
      verb: T.act.delete,
    });
    if (!go) return;
    const payload = (this._vehicle.sets ?? [])
      .filter((other) => other.id !== record.id)
      .map((other) => this._draftOf(other));
    await this._run(() => this._save("sets", payload), T.saved);
  }

  async _askOdometer() {
    const values = await this._ask({
      title: T.ask.odometer, lede: T.ask.odometerLede, verb: T.act.save,
      fields: [{
        name: "odometer", kind: "number", label: T.field.odometer,
        value: this._vehicle.odometer ?? 0, spec: this._schema.odometer_field,
      }],
    });
    if (!values) return;
    await this._run(() => this._act({
      action: "set_odometer", odometer: Number(values.odometer || 0),
    }), T.saved);
  }

  _odometerField() {
    return {
      name: "odometer", kind: "number", label: T.field.odometer,
      value: this._vehicle.odometer ?? null, spec: this._schema.odometer_field,
    };
  }

  /* ---------- the vehicle tab ---------- */

  _renderVehicle(wrap) {
    const vehicle = this._vehicle;
    if (!this._vehicleDraft) {
      this._vehicleDraft = {
        vehicle: vehicle.vehicle,
        odometer_entity: vehicle.odometer_entity ?? null,
        rotation_interval: vehicle.rotation_interval ?? 0,
      };
      this._vehicleClean = JSON.stringify(this._vehicleDraft);
    }
    const draft = this._vehicleDraft;
    const fields = this._schema.vehicle_fields ?? {};

    const card = el("div", "card");
    card.append(el("h3", "sec", T.vehicle.title));
    card.append(el("p", "secsub", T.vehicle.lede));
    card.append(this._textRow(T.field.vehicle, draft.vehicle, (v) => { draft.vehicle = v; },
      { hint: T.hint.vehicle, placeholder: "Alfa GT" }));
    card.append(this._entityRow(T.field.odometer_entity, draft.odometer_entity,
      fields.odometer_entity?.selector ?? { entity: {} },
      (v) => { draft.odometer_entity = v; }, T.hint.odometer_entity));
    card.append(this._numberRow(T.field.rotation_interval, draft.rotation_interval,
      fields.rotation_interval, (v) => { draft.rotation_interval = v; },
      { hint: T.hint.rotation_interval }));
    wrap.append(card);

    const foot = el("div", "actions");
    foot.append(this._button(T.act.cancel, null, "ghost", () => {
      this._vehicleDraft = null;
      this._vehicleClean = null;
      this._render();
    }));
    foot.append(el("span", "spacer"));
    const save = this._button(T.act.save, "mdi:check", "primary", () => this._saveVehicle());
    if (this._busy) save.disabled = true;
    foot.append(save);
    wrap.append(foot);

    // Adding a car is the « + » of the car tabs, and refreshing is what every
    // write already does: the row that used to sit here repeated both and sent
    // the only thing it could not do — deleting — to another page. It is that
    // one thing that stays.
    const more = el("div", "card");
    more.append(el("h3", "sec", T.vehicle.dangerTitle));
    more.append(el("p", "secsub", T.vehicle.danger));
    const row = el("div", "actions");
    row.append(el("span", "spacer"));
    const remove = this._button(T.act.deleteVehicle, "mdi:trash-can-outline", "danger",
      () => this._deleteVehicle());
    if (this._busy) remove.disabled = true;
    row.append(remove);
    more.append(row);
    wrap.append(more);
  }

  /**
   * Delete this car, entry and all.
   *
   * The panel asks and the server removes the entry: Home Assistant carries
   * the rest — the device, the entities, and the store the counters live in.
   * Nothing of it can be put back, so the question names the car rather than
   * asking « are you sure ».
   *
   * The last vehicle takes the page with it: the integration unregisters the
   * panel with the last entry, so the sidebar item one is standing on stops
   * existing. Rather than be left on a page that is no longer served, the
   * panel leaves for the integration page, which is where a car is declared
   * again.
   */
  async _deleteVehicle() {
    const vehicle = this._vehicle;
    if (!vehicle) return;
    const last = (this._cfg?.vehicles ?? []).length <= 1;
    const go = await this._confirm({
      title: T.act.deleteVehicle,
      lede: last
        ? T.ask.deleteLastVehicle(vehicle.vehicle)
        : T.ask.deleteVehicle(vehicle.vehicle),
      verb: T.act.delete,
    });
    if (!go) return;

    const entryId = vehicle.entry_id;
    // The question is worded from what the page shows; the departure is decided
    // by what the server counts once the entry is off its list. The two only
    // differ when another dialog deleted a car meanwhile, and it is the
    // server's figure that says whether this page still exists.
    let emptied = last;
    const ok = await this._run(async () => {
      const result = await this._hass.connection.sendMessagePromise({
        type: WS_DELETE, entry_id: entryId,
      });
      emptied = result?.remaining === 0;
      // The draft belonged to the car that just went, and the tab it was open
      // on is gone with it: whichever car `_adoptVehicle` lands on is looked
      // at from its sets, as an arrival always is.
      this._vehicleDraft = null;
      this._vehicleClean = null;
      this._edit = null;
      this._entryId = null;
      this._tab = "sets";
      await this._refresh();
    }, T.deleted);
    if (ok && emptied) this._goto(INTEGRATION_PAGE);
  }

  /**
   * Save the car's settings, answering the odometer's question if it asks one.
   *
   * The server refuses to adopt a source reading below what has been counted
   * without being told what to do about it: both figures are real, and only the
   * owner can say which one the tracking continues on. It answers with the two
   * readings instead of an error, and the same save is sent again with the
   * answer attached.
   */
  async _saveVehicle() {
    const draft = { ...this._vehicleDraft };
    const send = async (extra = {}) => {
      const result = await this._save("vehicle", { ...draft, ...extra });
      if (result?.resync) return result.resync;
      return null;
    };

    let question = null;
    const ok = await this._run(async () => { question = await send(); }, null);
    if (!ok) return;
    if (!question) {
      this._vehicleDraft = null;
      this._vehicleClean = null;
      this._render();
      toast(this, T.saved);
      return;
    }

    const answer = await this._askResync(question);
    if (answer === null) return;
    const done = await this._run(() => send({ resync: answer }), T.saved);
    if (done) {
      this._vehicleDraft = null;
      this._vehicleClean = null;
      this._render();
    }
  }

  /** Two readings that contradict each other: the gap between them asks the question. */
  _askResync(question) {
    return this._ask({
      title: T.ask.resync,
      lede: T.ask.resyncLede(question.entity_id, km(question.reading), km(question.tracked)),
      fields: [],
      body: () => {
        const grid = el("div", "versus");
        const fig = (key, value, who) => {
          const box = el("div", "fig");
          box.append(el("div", "k", key));
          box.append(el("div", "v", `${km(value)} km`));
          const w = el("div", "w", who);
          w.title = who;
          box.append(w);
          return box;
        };
        grid.append(
          fig(T.field.odometer_entity, question.reading, question.entity_id),
          fig(T.car.odometer, question.tracked, T.title)
        );
        return grid;
      },
      // Two named outcomes, not a « confirm » over a ticked box: what is chosen
      // here closes the fitted sets' accounts, and a button has to say what it does.
      choices: [
        { label: T.act.keepTracking, value: false },
        { label: T.act.takeSensor, value: true, primary: true },
      ],
    }).then((values) => (values === null ? null : values.__choice));
  }

  /* ---------- the history tab ---------- */

  _renderHistory(wrap) {
    const card = el("div", "card");
    card.append(el("h3", "sec", T.tabs.history));
    const history = [...(this._vehicle.history ?? [])].reverse();
    if (!history.length) {
      card.append(el("p", "secsub", T.history.none));
      wrap.append(card);
      return;
    }
    const icons = {
      mounted: "mdi:car-wrench", unmounted: "mdi:car-lifted-pickup",
      retired: "mdi:archive-arrow-down", restored: "mdi:backup-restore",
      rotated: "mdi:rotate-3d-variant", adjusted: "mdi:counter",
      separated: "mdi:call-split",
    };
    for (const entry of history) {
      const kind = String(entry.event || "").replace(`${DOMAIN}_`, "");
      const line = el("div", "line");
      line.append(icon(icons[kind] ?? "mdi:circle-small"));
      const text = el("div");
      text.append(el("div", "", T.history[kind] ?? kind));
      const who = nameOf(this._setOf(entry.set) ?? {});
      text.append(el("div", "secsub", who));
      line.append(text);
      const right = el("div", "right");
      const when = day(entry.at);
      const added = Object.values(entry.added ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);
      right.textContent = [when, added ? T.history.added(km(added)) : null]
        .filter(Boolean).join(" · ");
      line.append(right);
      card.append(line);
    }
    wrap.append(card);
  }

  /* ---------- the dialog ---------- */

  /**
   * Ask for what an action still needs, and nothing else.
   *
   * Resolves with the values, or null when it is given up on. A spec with no
   * field and no choice is a plain confirmation — which is why the callers can
   * skip it entirely when there is nothing left to ask.
   */
  _ask(spec) {
    return new Promise((resolve) => {
      const values = {};
      for (const field of spec.fields ?? []) values[field.name] = field.value ?? null;
      this._dialog = { spec, values, resolve };
      this._render();
    });
  }

  /**
   * A question with nothing to fill in, answered yes or no.
   *
   * The page's own sheet rather than `window.confirm`: the three heaviest
   * gestures — deleting a set, deleting a car, dropping a draft — used to be
   * the only ones asked in the browser's grey box, which is to say the
   * irreversible ones inherited the least considered screen.
   */
  async _confirm({ title, lede, verb }) {
    const answer = await this._ask({
      title,
      lede,
      choices: [{ label: verb, value: true, danger: true }],
    });
    return answer !== null;
  }

  _closeDialog(result) {
    const dialog = this._dialog;
    this._dialog = null;
    this._render();
    dialog?.resolve(result);
  }

  _renderDialog() {
    const { spec, values } = this._dialog;
    const scrim = el("div", "scrim");
    scrim.addEventListener("click", () => this._closeDialog(null));

    const box = el("div", "dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    // A modal is named by its own heading. Without this the sheet announces
    // itself as « dialog », and the question it is asking is read only once
    // the focus has wandered into it.
    const heading = el("h4", "", spec.title);
    heading.id = "dialog-title";
    box.setAttribute("aria-labelledby", heading.id);
    box.append(heading);
    if (spec.sub) box.append(el("div", "lede", spec.sub));
    if (spec.body) box.append(spec.body());
    if (spec.lede) box.append(el("div", "lede", spec.lede));

    for (const field of spec.fields ?? []) {
      if (field.kind === "choice") {
        box.append(this._choiceRow(field.label, values[field.name], field.options,
          (value) => { values[field.name] = value; },
          { stack: field.stack, hint: field.hint }));
      } else if (field.kind === "number") {
        box.append(this._numberRow(field.label, values[field.name], field.spec,
          (value) => { values[field.name] = value; }, { hint: field.hint }));
      } else if (field.kind === "entity") {
        box.append(this._entityRow(field.label, values[field.name],
          field.spec ?? { entity: {} },
          (value) => { values[field.name] = value; }, field.hint));
      } else {
        box.append(this._textRow(field.label, values[field.name],
          (value) => { values[field.name] = value; }, { hint: field.hint }));
      }
    }

    const foot = el("div", "foot");
    foot.append(this._button(T.act.cancel, null, "ghost", () => this._closeDialog(null)));
    foot.append(el("span", "spacer"));
    for (const choice of spec.choices ?? [{ label: spec.verb ?? T.act.confirm, primary: true }]) {
      const variant = choice.danger ? "danger fill" : choice.primary ? "primary" : "";
      const button = this._button(choice.label, null, variant, () => {
        this._closeDialog({ ...values, __choice: choice.value });
      });
      foot.append(button);
    }
    box.append(foot);

    // Escape, and the focus kept inside. A sheet one cannot leave by the key
    // every other dialog in Home Assistant answers to reads as a page that has
    // frozen; a focus that walks out of it leaves the keyboard behind a veil it
    // cannot see through.
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this._closeDialog(null);
        return;
      }
      if (event.key !== "Tab") return;
      // The sheet's own controls. What lives inside an `ha-selector` has its
      // own shadow root and is not reachable from here — the wrap is done on
      // the boundaries, which is what actually holds the focus in.
      const stops = [...box.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), ha-selector, [tabindex]:not([tabindex="-1"])'
      )];
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = this.shadowRoot.activeElement;
      if (event.shiftKey && (here === first || !box.contains(here))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && here === last) {
        event.preventDefault();
        first.focus();
      }
    });

    this.shadowRoot.append(scrim, box);
    // The sheet opens on what it asks for: one field, ready to be typed over.
    // A sheet that asks nothing — a confirmation — opens on its first control
    // instead, so the keyboard is inside it from the first keystroke.
    queueMicrotask(() => {
      const input = box.querySelector("input");
      if (input) {
        input.focus();
        input.select?.();
        return;
      }
      box.querySelector("button")?.focus();
    });
  }

  /* ---------- rows ---------- */

  _row(label, control, { hint, error, vertical } = {}) {
    const row = el("div", `field${vertical ? " vertical" : ""}${error ? " wrong" : ""}`);
    if (label) {
      const text = el("div", "flabel", label);
      if (hint) text.append(el("span", "fhint", hint));
      row.append(text);
    }
    row.append(control);
    if (error) {
      const box = el("div", "fno", error);
      row.append(box);
    }
    return row;
  }

  _textRow(label, value, onInput, opts = {}) {
    const input = el("input", "ftext");
    input.type = "text";
    input.value = value ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return this._row(label, input, opts);
  }

  /**
   * A number and its unit.
   *
   * The arrows' step comes from the field described and not from the browser: a
   * mileage is read off by tens where a pressure is set by twentieths, and the
   * step of one the browser assumes only suits the second.
   */
  _numberRow(label, value, spec = {}, onInput, opts = {}) {
    const wrap = el("div", "seg");
    wrap.style.flex = "1 1 auto";
    wrap.style.alignItems = "center";
    const input = el("input", "ftext fnum");
    input.type = "number";
    input.inputMode = "decimal";
    if (spec?.min !== undefined && spec.min !== null) input.min = String(spec.min);
    if (spec?.max !== undefined && spec.max !== null) input.max = String(spec.max);
    if (spec?.step) input.step = String(spec.step);
    input.value = value === null || value === undefined ? "" : String(value);
    input.addEventListener("input", () =>
      onInput(input.value === "" ? null : Number(input.value)));
    wrap.append(input);
    if (spec?.unit) wrap.append(el("span", "funit", spec.unit));
    return this._row(label, wrap, opts);
  }

  /**
   * A choice as chips.
   *
   * Two or three options, all visible, each carrying the icon and the shade it
   * has everywhere else on the page. A radiogroup and not a row of buttons: the
   * arrow keys navigate it, which a list of buttons does not do.
   *
   * The chips mark themselves before warning the caller: most choices do not
   * repaint the page, and without this a click on « Winter » would change the
   * value with nothing on screen saying so. Focus follows the value on the
   * arrow keys — a focus left on the old chip would be lost at the next press.
   */
  _choiceRow(label, value, options, onPick, opts = {}) {
    const group = el("div", `seg${opts.stack ? " stack" : ""}`);
    group.setAttribute("role", "radiogroup");
    const buttons = [];
    const select = (picked, focus) => {
      buttons.forEach((button, i) => {
        const on = options[i].value === picked;
        button.setAttribute("aria-checked", String(on));
        button.tabIndex = on ? 0 : -1;
        if (on && focus) button.focus();
      });
      onPick(picked);
    };
    options.forEach((option, index) => {
      const button = el("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(option.value === value));
      button.tabIndex = option.value === value || (value === undefined && !index) ? 0 : -1;
      if (option.tint) button.style.setProperty("--pick", option.tint);
      if (option.icon) button.append(icon(option.icon));
      const text = el("span", "", option.label);
      if (option.sub) text.append(el("span", "sub", option.sub));
      button.append(text);
      button.addEventListener("click", () => select(option.value, false));
      button.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        select(options[(index + step + options.length) % options.length].value, true);
      });
      buttons.push(button);
      group.append(button);
    });
    return this._row(label, group, { ...opts, vertical: opts.stack || opts.vertical });
  }

  /** Home Assistant's own entity picker, inside the page's frame. */
  _entityControl(value, filter, onPick) {
    const node = document.createElement("ha-selector");
    node.hass = this._hass;
    node.selector = filter.entity ? filter : { entity: filter };
    node.value = value ?? undefined;
    node.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      onPick(event.detail.value || null);
    });
    this._liveNodes.push(node);
    return node;
  }

  _entityRow(label, value, selector, onPick, hint) {
    return this._row(label, this._entityControl(value, selector, onPick), { hint });
  }

  _button(label, iconName, variant, onClick) {
    const button = el("button", `btn${variant ? ` ${variant}` : ""}`);
    button.type = "button";
    if (iconName) button.append(icon(iconName));
    button.append(document.createTextNode(label));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  /** Home Assistant's own navigation, so the page is not reloaded. */
  _goto(path) {
    history.pushState(null, "", path);
    this.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }
}

customElements.define("tyre-tracker-panel", TyreTrackerPanel);
