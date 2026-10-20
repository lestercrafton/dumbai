# Mileage (iPhone)

Expo / React Native app that detects drives in the background, asks at the end of each drive whether it was
business and which car was used (remembering the last car), stores trips in SQLite, and uploads answers to the
Vercel API in `../mileage-tracker/tesla-site`. Rules, API and the full setup (EAS build, TestFlight, device tokens)
are in `../mileage-tracker/PHONE-TRIPS.md`.

- `src/detector.ts` – trip detection (start: >15 mph for ~1 min; end: stopped ~4 min; GPS-jump and accuracy filtering)
- `src/background.ts` – always-on location task (`expo-location` + `expo-task-manager`)
- `src/notify.ts` – end-of-trip notification with quick actions
- `src/db.ts` – SQLite storage; `src/api.ts` – server sync
- `npm test` – detector unit tests
