# Three Things Learned

## 1. Player-vs-player combat is almost absent

Only 3 `Kill` and 3 `Killed` events appear across 796 matches. By contrast, the data contains 2,415 `BotKill` and 700 `BotKilled` events. Most combat pressure in this sample is coming from bots, not other human players.

Action: review spawn routes, objective placement, extraction timing, and bot density to understand why humans are not colliding. Track player-vs-player encounter rate, time-to-first-human-contact, extraction rate, and bot damage share after any layout or pacing change.

Why a level designer should care: if the intended fantasy includes tense player encounters, the current route network may be letting humans pass through parallel lanes without meaningful overlap.

## 2. Ambrose Valley is the main source of both engagement and loot behavior

Ambrose Valley accounts for 566 of 796 matches, 68.5% of all rows, 77.3% of loot pickups, and 74.4% of bot kills. It is not just the most played map; it is where most observable player decision-making is happening.

Action: prioritize Ambrose Valley for iteration first, then use Grand Rift and Lockdown as comparison maps. Track loot pickups per minute, bot kills per match, and path coverage before and after changes to confirm whether improvements move behavior rather than just adding noise.

Why a level designer should care: iteration time should go where the telemetry is strongest. Ambrose Valley has enough volume to validate changes quickly.

## 3. Ambrose has a repeated central hotspot

The Ambrose Valley grid cell around minimap cell `(13, 15)` is the top traffic cell with 834 movement samples. It is also the top kill cell with 65 kill events and the top death cell with 42 death events. Its approximate world center is `(x=9.7, z=-8.9)`.

Action: inspect this area for sightline dominance, bot spawn pressure, loot clustering, and route convergence. Possible actions are adding alternate approaches, cover breaks, secondary loot incentives nearby, or intentional signage if the area is supposed to be a fight anchor. Track deaths per visit, kill/death density, and route split after adjustments.

Why a level designer should care: a hotspot can be healthy if it creates memorable fights, but the same cell leading traffic, kills, and deaths deserves a pass for fairness and choice.
