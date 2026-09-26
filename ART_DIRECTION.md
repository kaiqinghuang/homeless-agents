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

Fifth face / lower-hood: tiny black-silver painted hooded face below-right of the fourth. User requests more conspicuous, varied and asymmetric expressions than face four. Its character is watchful unease with localized buckled lips and unequal eyelid/cheek tension. Eight distinct poses, no teeth or tongue, fixed outer head/hood/neck/ground, direct image switching.

Latest fifth-face selection: user enabled all 13 generated images, including the initial and intermediate corrections. Paired EE/AH/OH poses split 50/50. F/V has three variants; user explicitly chose equal thirds. Keep all candidates in their corresponding pose, resample on each cue, and preserve original rest.

## Sixth face — 2026-09-24

Small brown clay head immediately right of face five (`clay-lower`). More restrained and subtle than prior faces, but still asymmetric and uncanny. Character: quiet uneven lip-plane pressure, interrupted hairline seams, shallow central dimples and tiny notched openings. Preserve blank closed eyes without adding pupils; no teeth or tongue. Eight distinct stills plus original rest, fixed exterior/hair/neck/ground. Library: `assets/clay-lower-visemes-v1`.

## Seventh face — 2026-09-24

Larger black/silver face inside the pale hood immediately left of face four (`left-profile`). Special rule: mouth remains a tiny dark triangular notch with small changes of compression and taper; never broadly open it, even for AH/OH cues. Expression lives in asymmetric cheek/perioral/nasolabial/chin tension, with secondary linked brow and eyelid muscle response. Keep hood, neck, outer silhouette and ground fixed; no teeth or tongue. Eight distinct expression stills plus original rest in `assets/left-profile-visemes-v1`. Use the same whole-artwork framing as all other faces.

## Seventh face: two active sets — 2026-09-24

Keep the first eight images intact and add eight second-set images in `assets/left-profile-visemes-v2`. The second set has slightly larger, stranger small folded/wedge mouth contours with asymmetric muscle tension. Select set one with 70% probability and set two with 30% for each matching A–H cue; hold the selected still through that cue. No cross-pose selection; rest remains original. Both sets share the same fixed mask, calibration and whole-artwork crop.

## Eighth face — 2026-09-24

Frontal gray bronze face in a brown hood, upper-right of face seven (`upper-left`). Medium change, neither extremely restrained nor large. Character: taut asymmetric muscle tension with opposing lip pressure and uneven cheeks; secondary uneven brow/eyelid response. Keep mouth apertures small, toothless and tongueless; white chin paint remains. Fixed outer face/hood/neck/ground. Eight generated stills plus original rest in `assets/upper-left-visemes-v1`, direct switching and shared artwork crop.

## Eighth face: two active sets — 2026-09-24

Preserve the first eight stills and add eight quieter counterparts in `assets/upper-left-visemes-v2`. The second set is more restrained in both mouth and facial motion, like muttering to oneself: slight uneven lip pressure, narrow shallow seams and minimal secondary cheek/eyelid response. Each matching A–H cue selects the first set with 35% probability or the second set with 65%, held through the cue. Rest, fixed mask, calibration and whole-artwork framing stay unchanged.

## Eighth face: selected third-set replacements — 2026-09-24

Replace Wide in both active collections with the third collection’s Wide. Replace Pressed in the second collection with the third collection’s Pressed. Copy corresponding lip anchors. Keep all other third-set images preserved and exclude the third collection from playback. Continue the modified first/second collections at 35%/65%.

## Eighth face: three active sets — latest selection

Activate all three sets with probabilities 10% / 35% / 55%, in creation order. Keep prior Wide replacements in both earlier sets and Pressed replacement in set two. Select only corresponding poses and hold for each cue; original rest and fixed mask remain. This supersedes earlier third-set inactivity and two-set weighting.

## Ninth face — quiet murmuring

Large dark feminine silver face right of the red-eyed man (`right-large`). Least uncanny of the collection, most restrained. The generated images keep upper-face changes minimal; mainly tiny vertical lip opening/closure with faint unequal heights and a little immediately adjacent muscle motion. Minimal OO rounding, no strong pucker or lateral contraction. Closed eyes, soft photographic focus, empty toothless/tongueless mouth. Latest user correction: use the full facial surface for image switching; keep hair, ornaments, neck and ground outside a fixed face mask. Existing stills remain unchanged. Eight stills plus original rest in `assets/right-large-visemes-v1`.

## Ninth face: second set

`right-large-visemes-v2`: six subtly uncanny, asymmetric expressions with quiet small mouth motion and gentle cheek/closed-eye/brow tension. Whole-face switching remains active. Matching A/B/E/F/G/H cues select the first set with 70% probability and the second with 30%, holding the selection until the next cue. Parted (C) and Open (D) were deleted from the second set and use the first set only. Rest remains original. First-set artwork is preserved.

Ninth-face boundary correction: the shared fixed mask now reaches the hairline, outer cheeks and underside of the chin. A 24px inward transition softens the join across all active stills, without extending into surrounding ground. Other faces keep their previous 8px transition. Sprite images and the 70/30 selection remain unchanged.

Ninth-face image-right expansion: extend the subject-left cheek/jaw replacement through adjacent hair, approximately 45–60 sprite pixels beyond the previous edge. Keep the image-left edge and forehead-strand cutout unchanged. The 24px transition now lies beyond the right cheek rather than across it. Both sets share this mask.

## Tenth face — 2026-09-25

White bald painted head above the central face (`white-upper`). Very strange, uncoordinated mouth shapes, distinct from prior characters: contrary upper/lower lip pressure, local folds, off-center small openings, subtle supporting eye/brow response. No teeth or tongue, including no tooth-like pale ridges along mouth interiors. Original painted patina and glass eyes retained. Eight stills plus original rest in `assets/white-upper-visemes-v1`; whole-head switching inside the fixed exterior silhouette, no intermediate frames.

## Tenth face: two active sets — 2026-09-25

Activate `white-upper-visemes-v2`, focusing on small perioral, nasolabial, lower-cheek and chin-muscle changes with centered, ordinary mouth contours. First set 75%, second set 25% for every matching A–H cue. Hold a selected image through its cue, resample on a new cue, and use original rest. Both sets use the same full-head silhouette and artwork framing.

## Eleventh face — 2026-09-25

Small white painted head with black graphic eye outlines and blue neck (`tiny-right`). Modest mouth opening, but diverse uncanny mouth and facial changes: compressed lip folds, taut narrow slits, small local openings, contrary cheek tension and unequal eyebrow/eyelid response. Preserve painted identity. No teeth or tongue. Eight speaking images plus original rest in `assets/tiny-right-visemes-v1`. Full-head image switching within fixed outer silhouette, including hair and ears; ground, neck and shadow excluded. No intermediate frames.

### Eleventh face — two collections, 80/20

The original collection has 80% probability and the lower-face-focused second collection has 20%, independently per speech cue. Eight matched A–H pairs; hold each selected still through its cue, with the original resting image. Use the existing full-head mask and shared scene crop.

## Twelfth face — 2026-09-25

Gray-white fur-collared head (`ruffle-right`). Main changes are strange asymmetric mouth shapes: offset pressure, uneven lip layers, one-sided slits and restrained inward folds. Other facial regions stay restrained. Keep gray weathered material and cloudy eyes; no teeth or tongue, including tooth-like interior highlights. Eight speech stills plus original rest in `assets/ruffle-right-visemes-v1`, full-head switching without intermediate frames. Neck, fur collar, ground and shadows remain static.

### Twelfth face — flatter second collection, 2026-09-26

Second collection keeps articulation flatter and more restrained: narrower horizontal seams, less vertical movement, subtle lip-layer mismatch and unequal pressure. No teeth or tongue. First collection 50%, second collection 50% per matched speech cue, held through the cue. Original rest and whole-head boundary retained.

## Thirteenth face — 2026-09-26

Gray sculptural head with center-parted hair, earrings and carved goatee (`upper-right`). Taut, tense asymmetric muttering with indistinct lips: mismatched pressure, shallow off-center slits, inward folding and compressed round shapes. Slight linked uneven brow/eyelid tension. No teeth, tongue, gums or tooth-like highlights. Whole-head still switching, excluding neck, earrings, surrounding ground and cast shadow. No intermediate frames. Eight speech stills plus original rest in `assets/upper-right-visemes-v1`.

### Thirteenth face — second collection enabled, 2026-09-26

Both original collections preserved; no individual pose replacement. First collection 20%, second collection 80% per matching speech cue. Second collection has quieter forehead, brows and eyes, with tense ambiguous lip changes and nearby muscle tension. No teeth or tongue. Shared whole-head mask and original rest.

## Fourteenth face — 2026-09-26

Wrapped sculptural head with dark cheek paint and crossing cloth bands (`wrapped`). Asymmetry comes mainly from unequal inward pressure, hollows and small diagonal pulls in both cheeks. Upper face remains quiet and mouth movement stays small. Preserve the existing cloth bands and their facial coverage. No teeth, tongue, gums or tooth-like highlights. Whole-head still switching, excluding wrapped torso, surrounding ground and cast shadow. No intermediate frames. Eight speech stills plus original rest in `assets/wrapped-visemes-v1`.

## Fifteenth face — 2026-09-26

Dark sculptural head with carved bangs and long side curls (`far-right`). Uncanny asymmetric mouth shapes at small amplitude: uneven lip pressure, thin offset slits, inward folds and restrained oval openings. Upper face, eyes, nose and other facial regions remain quiet. No teeth, tongue, gums or tooth-like highlights. Whole-head still switching, excluding neck, collar, hanging hair tails, surrounding ground and cast shadow. No intermediate frames. Eight speech stills plus original rest in `assets/far-right-visemes-v1`.

### Fifteenth face — original Skew restored, 2026-09-26

Nine speech stills plus original rest. Both Skew images are active at 50% each per matching cue. The user explicitly accepts the pale tooth-like speck in the restored initial Skew; preserve that image unchanged. Other poses and the whole-head mask remain unchanged.
