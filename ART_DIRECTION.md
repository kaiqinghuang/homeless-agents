# Facial animation direction

## User preference — 2026-09-23

For future face-pose generation, use a moderate expression amplitude between the first six mouth variants and the later four stronger expression variants in `assets/red-eyes-variants-20260923`. The later four are too strong as a general baseline. This is an artistic reference interval, not a numerical slider value or an instruction to blend images.

- Uncanny and asymmetric, but avoid large overall facial changes.
- Concentrate the main changes around the lips, mouth corners, chin and nearby lower cheeks.
- Let eyes, eyebrows and forehead respond to the mouth with smaller supporting changes. Do not freeze the upper face, but avoid pronounced eye widening, squinting, brow lifting or forehead deformation as the default.
- Give every face its own kind of strangeness and every pose a distinct local mechanism; do not repeatedly use a raised crooked mouth corner or mirror the same expression.
- Keep mouths toothless and tongueless, with dark empty interiors and small openings.
- Keep head position, exterior silhouette, surrounding ground, cast shadows and neighboring objects stable.
- Continue direct image-pose switching without intermediate frames unless the user requests otherwise.

中文标准：以后变化幅度取这十张图中前六张与后四张之间的适中程度。怪，但不要变化特别大；主要变化在嘴附近，上半脸可以相应变化，但幅度更轻。每张脸要有自己的怪异方式。

## Reference images

- Subtler first six: `01-pressed-mouth.png`, `02-wide-mouth.png`, `04-open-mouth.png`, `05-oh-mouth.png`, `07-fold-mouth.png`, `08-skew-mouth.png`.
- Stronger later four: `01-pressed-expression.png`, `02-wide-expression.png`, `04-open-expression.png`, `05-oh-expression.png`.
- These were previously preserved in `assets/red-eyes-variants-20260923`; that unused collection was later moved to Trash at the user’s request.

This preference governs future work. For the red-eye-shadow AH pose, the user prefers the original subtler 04-open-mouth.png. It was restored in the preserved first set. The later moderate AH and all four stronger expression variants remain preserved but inactive. This specific selection does not replace the general amplitude guidance above.

## Complete second red-face set — latest preference

The user requested a wholly new set while preserving the previous one. Use the third brown face as the immediate reference for restrained movement and expression amplitude. Make the lip shapes slightly stranger and varied, keep overall change small, and let eyebrows make slight odd asymmetric changes. Most movement remains around the mouth; avoid large upper-face changes. This specific brief takes precedence over the broader earlier amplitude interval for this new red set.

On 2026-09-24 the user asked to switch back. Active: `assets/red-eyes-visemes-v1` (revision 6, original subtler AH). The later second set was initially kept inactive; see the latest cleanup selection below.

## Fourth face — 2026-09-24

Nearest small hooded face left of the central head (`small-left`). User requests subtle uncanny asymmetry distinct from the first three, small overall movement and small mouth area. Character direction: sleepy, upward-looking face with lips that slip, catch and close slightly out of register; small local lip compression instead of a repeated diagonal sneer. Preserve the heavy eyelids, hood, neck and surrounding ground. Active library: `assets/small-left-visemes-v1`.

## Two active red-face sets — 2026-09-24

Latest user selection supersedes earlier storage/activation notes above: keep the current red-eyes-visemes-v1 set and restore all eleven original generated images (8 base plus early EH/OO/L expressions) in red-eyes-first11. Choose the earliest first11 set with 30% probability and the current set with 70% for each phoneme cue; choose corresponding candidates only and hold the selected image for the cue. Other red-face backups are removed from the project to macOS Trash. The historical reference names above describe prior art direction, not currently retained project folders.

2026-09-24: add the user-selected restrained v2 Wide image as `red-eyes-first11/12-wide-expression.png`. Keep the folder name. Its two Wide candidates split the collection’s 30% equally (15% each); the current set’s Wide remains 70%. Other selections and masks stay unchanged.
