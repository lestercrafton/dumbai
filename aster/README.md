# The Last Bell of Xenaland

[Play the complete game](https://last-bell-of-xenaland.sunlightisfree.chatgpt.site)

An original, compact storybook RPG starring **Oshn**, a seven-year-old boy, and **Isha**, his sister. A sleepy spell gives Isha a magical moth form until the happy ending. Three painted locations, six turn-based encounters, a two-phase final boss, optional gifts, permanent upgrades, and a happy ending. The early-reader story uses short sentences: collect six notes, help the spellbound guards, and wake the bell with the wizard Vadish. About 15–25 minutes, depending on reading and battle pace.

## Play

Click or tap actions. Battles wait indefinitely for your decision. Read the next move, stop big spells with Ring, get magic with Tap or Shield, heal with Heal, and use Team song at three song lights. Health and magic refill before each battle. Easy play is offered first; More challenge is also available. Change levels in Settings.

Progress saves automatically to the current browser's local storage after every action. It is device/browser-specific. Clearing site data clears the save. A defeated player retries the same encounter with all prior choices preserved. Saves from the first release migrate to the revised family story while keeping progress, upgrades, health, magic, and the damage already shown for the next enemy move.

Keyboard: 1–5 choose actions, Space advances single-choice dialogue, J opens the journal, M toggles audio, Escape closes a dialog. Touch layouts, visible keyboard focus, sound controls, and reduced motion are supported.

## Run / build / test

No dependency installation is required. Requires a current browser, Node.js for tests/build, and Python 3 for the convenience local server.

```sh
cd aster
npm start        # http://localhost:4173
npm test         # deterministic complete-game and mechanics tests
npm run build    # creates dist/ containing only the static game
```

The built dist directory can be served by any static HTTPS host. All game code, original art, and generated music run in the browser; there are no runtime game services, API keys, sign-ins, purchases, trackers, or network gameplay dependencies. Google Fonts is optional; system fonts work offline. Web Audio begins after a user gesture.

## Original work

This is an independent game inspired by the broad appeal of painted fantasy and turn-based battles. It uses no Child of Light characters, story, artwork, music, maps, or other assets and is not affiliated with Ubisoft. All story, characters, vector illustrations, game logic, and synthesized music were created for this project. Raster paintings were generated with OpenAI's image-generation tool. The saved asset prompts are in assets/ART-PROMPTS.txt. Cormorant Garamond and DM Sans are served by Google Fonts under their open font licenses.

## Verification

The automated engine suite covers complete runs in both difficulties; all optional memories and the direct route; alternative upgrades; both boss phases; resource limits; interruption, healing, defense and enemy effects; immutability; retry checkpoints; and save validation. The UI was also played from the title through the ending in a browser, including save/resume and responsive layout checks. See VERIFICATION.md for the final release results.
