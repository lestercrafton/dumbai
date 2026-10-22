# Ovanova Moves — taste

The bar for every screen. When in doubt, remove something.

## Feel
- Calm, quiet, confident. The app should feel like a good iOS system app, not a dashboard.
- One idea per card, one primary action per card. Everything else is secondary or hidden until needed.
- Show only what the driver decided or measured. Never display a guess (no pre-picked car, no assumed purpose).

## Color (OSC green)
- Brand `#40804F` — the one filled button, selected chips, links.
- Soft `#78BA89` — accents only (pending marker, subtle highlights).
- Tint `#E8F4EB` — secondary buttons and soft backgrounds.
- Ink `#1B2430`, muted `#6B7280`, background `#F7F5F2`, card `#FFFFFF`. Warning amber only for real problems.
- No borders where a soft shadow or spacing does the job. Hairlines only to separate a summary from a hero.

## Type (SF, system font)
- Hero numbers: 34 pt, semibold/bold, tight tracking (-0.8), tabular figures. Units smaller and muted.
- Titles 17–20 pt semibold, body 16, secondary 14–15 muted, captions 13. At most three sizes on a card.
- Sentence case. Short words: "Business", "Personal", "Friday batch", "Send now", "Change".

## Space & shape
- 8-pt grid. Cards: 18 pt padding, 18 pt radius, 12 pt between cards. 16 pt above an action row.
- Buttons 50 pt tall, 14 pt radius, full-width pairs. Chips 38 pt, pill-shaped, filled when selected.
- Touch targets ≥ 44 pt (use hitSlop for small links).

## Behavior
- Progressive disclosure: ask Business or Personal first; only Business asks for the car; only a personal car asks Send now vs Friday batch.
- Answered things collapse to a one-line summary with a quiet "Change" link. The summary reads the server's verdict: "Sent Oct 21 · $11.32", "Friday batch · $9.42", "Not sent yet · $4.10", "Logged · company car". Personal says just "Personal".
- Notes are optional, always. The purpose field says "(optional)" and nothing waits on it; an empty purpose reads "Business" in the email.
- Name the car on a card only when the driver has more than one, and only the car they picked, in the time line ("2:14 PM · 22 min · F-150"), never as a badge.
- When trips are waiting for the batch, one muted line at the top of Trips says how many, the miles, and when it goes out.
- The phone and the web page are one product: same tokens, same words, same card. Change one, change the other.
- Every tap answers back: pressed state (fade + 0.98 scale), light haptic, the screen updates immediately, and a short confirmation.
- Empty states are friendly and give the single next step.

## Never
- Two filled buttons side by side. Emoji as decoration in content, tab bars or empty states (use the line icons). Status text that repeats what's already visible.
- Showing options that don't apply (e.g. Send now on a personal trip).
