// scripts/safekeeping/actions.js
// What the director can do from the Safekeeping row (spec 8.2): the buttons the status offers, each through the desk's `act`
// with the press as its evidence. None can reach the main version: a copy online goes to keep/<branch> and merges nothing, and a
// folder is brought up by fast-forward alone. An action the status no longer offers does nothing, so a press on a row drawn
// before things changed is refused. **Put it on GitHub** only raises the move's card, which says the code goes online.
const HOSTS = { github: 'GitHub', gitlab: 'GitLab' };
export const KEEP_PLACE = 'keep';
const STALE_LINE = 'That isn\'t offered now: look at the row again';

const refused = (line) => ({ refused: line });
export const SAVE_PROMPT = 'the director pressed Ask the First Mate to save them on the Safekeeping row: their project folder holds uncommitted changes that are only on this computer, and they want them saved.';

const ACTS = {
  // Each branch goes up on its own, and what went before a failure stays up: a second press sends the rest.
  async 'keep-online'({ readings, defaultBranch, keepCopy }) {
    const { branches } = readings.onlyHere;
    const places = branches.map((branch) => [branch, `${KEEP_PLACE}/${branch}`]);
    if (places.some(([, place]) => place === defaultBranch)) return refused('A copy can\'t go on the main version');
    for (const [branch, place] of places) {
      const got = await keepCopy({ branch, place });
      if (got?.ok !== true) return refused(`${branch} couldn't be sent: ${got?.refused ?? 'the helper didn\'t say why'}`);
    }
    const names = places.map(([, place]) => place).join(', ');
    return { ok: true, says: `Sent to ${HOSTS[readings.place] ?? readings.place}, under ${names}. Nothing was merged.` };
  },
  async 'bring-up'({ bringUp }) {
    const got = await bringUp();
    if (typeof got?.line === 'string') return refused(got.line);
    return got?.moved === true || got?.state === 'same' ? { ok: true, says: 'Your folder is up to date' } : refused('Your folder has work of its own, so it wasn\'t moved');
  },
  async 'back-up-now'({ backUpNow }) {
    const got = await backUpNow();
    if (got?.written !== undefined) return { ok: true, says: 'Backed up' };
    if (got?.skipped === 'away') return refused('The backup folder isn\'t here: plug its drive in, or choose another folder');
    return refused(got?.why ?? got?.failed ?? 'The backup couldn\'t be written');
  },
  // Picking waits on the director, so it runs apart and what comes of it shows on the row.
  async 'choose-folder'({ chooseSoon }) {
    chooseSoon();
    return { ok: true, says: 'A window is opening for you to choose the folder' };
  },
  async 'put-on-github'({ askMove }) {
    await askMove('github');
    return { ok: true, says: 'A card asks whether to move it' };
  },
  async 'try-again'({ look }) {
    await look({ force: true });
    return { ok: true };
  },
  async 'ask-save'({ prompt }) {
    return { ok: true, submit: [prompt] };
  },
};

// The system's window, then the folder if it counts and a first backup there. A folder that doesn't count is noted for the row,
// and a closed window changes nothing.
export async function chooseFolder({ pick, choose, noteRefused, backUpNow, look }) {
  const folder = await pick();
  if (folder === null) return;
  const chosen = choose(folder);
  if (chosen.ok) await backUpNow();
  else noteRefused(chosen.why);
  await look();
}

// safekeepingAct(action, ctx) -> { ok, says?, submit? } | { refused }. `ctx` holds the `status` and `readings` the last look kept,
// and the helper's ways of doing each: keepCopy, bringUp, backUpNow, chooseSoon, askMove and look.
export async function safekeepingAct(action, ctx) {
  const offered = Array.isArray(ctx?.status?.actions) && ctx.status.actions.some((a) => a.action === action);
  if (!offered || !Object.hasOwn(ACTS, action)) return refused(STALE_LINE);
  return ACTS[action](ctx);
}
