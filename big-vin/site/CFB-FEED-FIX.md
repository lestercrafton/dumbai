# College football live coverage — October 17, 2026

The large coverage banner exposed a feed request defect. ESPN's single-date college-football endpoint silently returned 25 events per group for `limit=1000`; the supported `limit=200` returned 52 FBS and 58 FCS events for October 17, deduplicating to 107 games. The date-range endpoint still returned HTTP 400, so every date/group remains checked through the existing bounded daily fallback.

Both browser and server requests now use a maximum of 200 for college football. Successful responses below the cap no longer manufacture a partial flag. Failed dates/groups, malformed payloads and responses reaching the requested limit still remain partial. Weekend POST no longer unconditionally marks college football partial. The server cache key changes so old partial responses do not linger after publication. Existing saved predictions, grades, clocks, prices and model selection are unchanged.

Live direct adapter checks returned 107 games today, 111 across Friday–Sunday, and 118 across Monday–Sunday, with all date/group requests successful and below their caps. These are observed provider cards, not a guarantee about every possible league event or complete historical season coverage. Historical-record coverage is a separate concern.

The normal board no longer needs the banner. An actual future feed problem appears as a small expandable status beside the records rather than a full-width warning block. Failures with no returned games retain their explicit unavailable-state messages.

Validation: all 232 lib runtime tests pass, including added browser/server coverage and response-cap regressions; TypeScript and whitespace checks pass. Direct network checks cover the actual today, weekend and full-week feeds.
