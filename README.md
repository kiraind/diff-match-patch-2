# diff-match-patch-2

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Strict TypeScript Checked](https://badgen.net/badge/TS/Strict "Strict TypeScript Checked")](https://www.typescriptlang.org)
[![Known Vulnerabilities](https://snyk.io/test/github/kiraind/diff-match-patch-2/badge.svg)](https://snyk.io/test/github/kiraind/diff-match-patch-2) 
[![NPM version](https://img.shields.io/npm/v/diff-match-patch-2.svg)](https://www.npmjs.com/package/diff-match-patch-2)

> NPM package for [diff-match-patch](https://github.com/google/diff-match-patch) re-written in TypeScript and refactored

## Installation

```sh
npm i diff-match-patch-2
```

## API

[Source](https://github.com/google/diff-match-patch/wiki/API)

### Initialization

The first step is to create a new `DiffMatchPatch` object. This object contains properties `diff`, `match` and `patch` containing different methods.

```ts
import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
```

Construstor contains an optional argument with settings:

* `timeout: number = 1.0` — Number of seconds to map a diff before giving up (0 for infinity).
* `editCost: number = 4` — Cost of an empty edit operation in terms of edit characters.
* `threshold: number = 0.5` — At what point is no match declared (0.0 = perfection, 1.0 = very loose).
* `distance: number = 1000` — How far to search for a match (0 = exact location, 1000+ = broad match). A match this many characters away from the expected location will add 1.0 to the score (0.0 is a perfect match).
* `maxBits: number = 32` — The number of bits in an int.
* `deleteThreshold: number = 0.5` — When deleting a large block of text (over ~64 characters), how close do the contents have to be to match the expected contents. (0.0 = perfection, 1.0 = very loose). Note that `threshold` controls how closely the end points of a delete need to match.
* `margin: number = 4` — Chunk size for context length.

### Usage

> See JSDoc comments

### .diff.main(text1, text2) → diffs

An array of differences is computed which describe the transformation of text1 into text2. Each difference is an `Diff` tuple. The first element specifies if it is an insertion (1), a deletion (-1) or an equality (0). The second element specifies the affected text.

```
.diff.main("Good dog", "Bad dog") → [(-1, "Goo"), (1, "Ba"), (0, "d dog")]
```

Despite the large number of optimisations used in this function, diff can take a while to compute. The `DiffMatchPatch.diff.timeout` property is available to set how many seconds any diff's exploration phase may take. The default value is 1.0. A value of 0 disables the timeout and lets diff run until completion. Should diff timeout, the return value will still be a valid difference, though probably non-optimal.

### .diff.cleanupSemantic(diffs) → null

A diff of two unrelated texts can be filled with coincidental matches. For example, the diff of "mouse" and "sofas" is `[(-1, "m"), (1, "s"), (0, "o"), (-1, "u"), (1, "fa"), (0, "s"), (-1, "e")]`. While this is the optimum diff, it is difficult for humans to understand. Semantic cleanup rewrites the diff, expanding it into a more intelligible format. The above example would become: `[(-1, "mouse"), (1, "sofas")]`. If a diff is to be human-readable, it should be passed to `.diff.cleanupSemantic`.

### .diff.cleanupEfficiency(diffs) → null

This function is similar to `.diff.cleanupSemantic`, except that instead of optimising a diff to be human-readable, it optimises the diff to be efficient for machine processing. The results of both cleanup types are often the same.

The efficiency cleanup is based on the observation that a diff made up of large numbers of small diffs edits may take longer to process (in downstream applications) or take more capacity to store or transmit than a smaller number of larger diffs. The `DiffMatchPatch.diff.editCost` property sets what the cost of handling a new edit is in terms of handling extra characters in an existing edit. The default value is 4, which means if expanding the length of a diff by three characters can eliminate one edit, then that optimisation will reduce the total costs.

### .diff.levenshtein(diffs) → int

Given a diff, measure its Levenshtein distance in terms of the number of inserted, deleted or substituted characters. The minimum distance is 0 which means equality, the maximum distance is the length of the longer string.

### .diff.prettyHtml(diffs) → html

Takes a diff array and returns a pretty HTML sequence. This function is mainly intended as an example from which to write ones own display functions.

### .match.main(text, pattern, loc) → location

Given a text to search, a pattern to search for and an expected location in the text near which to find the pattern, return the location which matches closest. The function will search for the best match based on both the number of character errors between the pattern and the potential match, as well as the distance between the expected location and the potential match.

The following example is a classic dilemma. There are two potential matches, one is close to the expected location but contains a one character error, the other is far from the expected location but is exactly the pattern sought after: `.match.main("abc12345678901234567890abbc", "abc", 26)` Which result is returned (0 or 24) is determined by the `DiffMatchPatch.match.distance` property. An exact letter match which is 'distance' characters away from the fuzzy location would score as a complete mismatch. For example, a distance of '0' requires the match be at the exact location specified, whereas a threshold of '1000' would require a perfect match to be within 800 characters of the expected location to be found using a 0.8 threshold (see below). The larger matchDistance is, the slower match.main() may take to compute. This variable defaults to 1000.

Another property is `DiffMatchPatch.match.threshold` which determines the cut-off value for a valid match. If matchThreshold is closer to 0, the requirements for accuracy increase. If matchThreshold is closer to 1 then it is more likely that a match will be found. The larger matchThreshold is, the slower match.main() may take to compute. This variable defaults to 0.5. If no match is found, the function returns -1.

### .patch.make(text1, text2) → patches

### .patch.make(diffs) → patches

### .patch.make(text1, diffs) → patches

Given two texts, or an already computed list of differences, return an array of patch objects. The third form (text1, diffs) is preferred, use it if you happen to have that data available, otherwise this function will compute the missing pieces.

### .patch.toText(patches) → text

Reduces an array of patch objects to a block of text which looks extremely similar to the standard GNU diff/patch format. This text may be stored or transmitted.

### .patch.fromText(text) → patches

Parses a block of text (which was presumably created by the patch.toText function) and returns an array of patch objects.

### .patch.apply(patches, text1) → [text2, results]

Applies a list of patches to text1. The first element of the return value is the newly patched text. The second element is an array of true/false values indicating which of the patches were successfully applied. [Note that this second element is not too useful since large patches may get broken up internally, resulting in a longer results list than the input with no way to figure out which patch succeeded or failed. A more informative API is in development.]

The previously mentioned matchDistance and matchThreshold properties are used to evaluate patch application on text which does not match exactly. In addition, the `DiffMatchPatch.patch.deleteThreshold` property determines how closely the text within a major (~64 character) delete needs to match the expected text. If patchDeleteThreshold is closer to 0, then the deleted text must match the expected text more closely. If patchDeleteThreshold is closer to 1, then the deleted text may contain anything. In most use cases patchDeleteThreshold should just be set to the same value as matchThreshold.

## License

```
http://www.apache.org/licenses/LICENSE-2.0
```
