
import Operation from './types/Operation'
import Diff from './types/Diff'
import PatchObj from './PatchObj'

/**
 * Class containing the diff, match and patch methods.
 */
export default class DiffMatchPatch {
  diffTimeout: number
  diffEditCost: number
  matchThreshold: number
  matchDistance: number
  matchMaxBits: number
  patchDeleteThreshold: number
  patchMargin: number

  constructor () {
    // Defaults.
    // Redefine these in your program to override the defaults.

    // Number of seconds to map a diff before giving up (0 for infinity).
    this.diffTimeout = 1.0
    // Cost of an empty edit operation in terms of edit characters.
    this.diffEditCost = 4
    // At what point is no match declared (0.0 = perfection, 1.0 = very loose).
    this.matchThreshold = 0.5
    // How far to search for a match (0 = exact location, 1000+ = broad match).
    // A match this many characters away from the expected location will add
    // 1.0 to the score (0.0 is a perfect match).
    this.matchDistance = 1000
    // When deleting a large block of text (over ~64 characters), how close do
    // the contents have to be to match the expected contents. (0.0 = perfection,
    // 1.0 = very loose).  Note that matchThreshold controls how closely the
    // end points of a delete need to match.
    this.patchDeleteThreshold = 0.5
    // Chunk size for context length.
    this.patchMargin = 4

    // The number of bits in an int.
    this.matchMaxBits = 32
  }

  //  DIFF FUNCTIONS

  /**
   * Find the differences between two texts.  Simplifies the problem by stripping
   * any common prefix or suffix off the texts before diffing.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {boolean} checklines Optional speedup flag. If present and false,
   *     then don't run a line-level diff first to identify the changed areas.
   *     Defaults to true, which does a faster, slightly less optimal diff.
   * @param {number} deadline Optional time when the diff should be complete
   *     by.  Used internally for recursive calls.  Users should set DiffTimeout
   *     instead.
   * @return {Diff[]} Array of diff tuples.
   */
  diff_main (
    text1: string,
    text2: string,
    checklines: boolean = true,
    deadline: number = this.diffTimeout <= 0 ? Number.MAX_VALUE : (new Date()).getTime() + this.diffTimeout * 1000
  ): Diff[] {
    // Check for null inputs.
    if (text1 === null || text2 === null) {
      throw new Error('Null input. (diff_main)')
    }

    // Check for equality (speedup).
    if (text1 === text2) {
      if (text1 !== '') {
        return [[Operation.DIFF_EQUAL, text1]]
      }
      return []
    }

    // Trim off common prefix (speedup).
    let commonlength = this.diff_commonPrefix(text1, text2)
    const commonprefix = text1.substring(0, commonlength)
    text1 = text1.substring(commonlength)
    text2 = text2.substring(commonlength)

    // Trim off common suffix (speedup).
    commonlength = this.diff_commonSuffix(text1, text2)
    const commonsuffix = text1.substring(text1.length - commonlength)
    text1 = text1.substring(0, text1.length - commonlength)
    text2 = text2.substring(0, text2.length - commonlength)

    // Compute the diff on the middle block.
    const diffs = this.diff_compute(text1, text2, checklines, deadline)

    // Restore the prefix and suffix.
    if (commonprefix !== '') {
      diffs.unshift([Operation.DIFF_EQUAL, commonprefix])
    }
    if (commonsuffix !== '') {
      diffs.push([Operation.DIFF_EQUAL, commonsuffix])
    }
    this.diff_cleanupMerge(diffs)
    return diffs
  }

  /**
   * Find the differences between two texts.  Assumes that the texts do not
   * have any common prefix or suffix.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {boolean} checklines Speedup flag.  If false, then don't run a
   *     line-level diff first to identify the changed areas.
   *     If true, then run a faster, slightly less optimal diff.
   * @param {number} deadline Time when the diff should be complete by.
   * @return {Diff[]} Array of diff tuples.
   * @private
   */
  diff_compute (
    text1: string,
    text2: string,
    checklines: boolean,
    deadline: number
  ): Diff[] {
    let diffs: Diff[]

    if (text1 === '') {
      // Just add some text (speedup).
      return [[Operation.DIFF_INSERT, text2]]
    }

    if (text2 === '') {
      // Just delete some text (speedup).
      return [[Operation.DIFF_DELETE, text1]]
    }

    const longtext = text1.length > text2.length ? text1 : text2
    const shorttext = text1.length > text2.length ? text2 : text1
    const i = longtext.indexOf(shorttext)
    if (i !== -1) {
      // Shorter text is inside the longer text (speedup).
      diffs = [
        [Operation.DIFF_INSERT, longtext.substring(0, i)],
        [Operation.DIFF_EQUAL, shorttext],
        [Operation.DIFF_INSERT, longtext.substring(i + shorttext.length)]
      ]

      // Swap insertions for deletions if diff is reversed.
      if (text1.length > text2.length) {
        diffs[0][0] = diffs[2][0] = Operation.DIFF_DELETE
      }

      return diffs
    }

    if (shorttext.length === 1) {
      // Single character string.
      // After the previous speedup, the character can't be an equality.
      return [
        [Operation.DIFF_DELETE, text1],
        [Operation.DIFF_INSERT, text2]
      ]
    }

    // Check to see if the problem can be split in two.
    const hm = this.diff_halfMatch(text1, text2)

    if (hm !== null) {
      // A half-match was found, sort out the return data.
      const text1A = hm[0]
      const text1B = hm[1]
      const text2A = hm[2]
      const text2B = hm[3]
      const midCommon = hm[4]
      // Send both pairs off for separate processing.
      const diffsA = this.diff_main(text1A, text2A, checklines, deadline)
      const diffsB = this.diff_main(text1B, text2B, checklines, deadline)
      // Merge the results.
      return diffsA.concat(
        [
          [Operation.DIFF_EQUAL, midCommon]
        ],
        diffsB
      )
    }

    if (checklines && text1.length > 100 && text2.length > 100) {
      return this.diff_lineMode(text1, text2, deadline)
    }

    return this.diff_bisect(text1, text2, deadline)
  }

  /**
   * Do a quick line-level diff on both strings, then rediff the parts for
   * greater accuracy.
   * This speedup can produce non-minimal diffs.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {number} deadline Time when the diff should be complete by.
   * @return {Diff[]} Array of diff tuples.
   * @private
   */
  diff_lineMode (
    text1: string,
    text2: string,
    deadline: number
  ): Diff[] {
  // Scan the text on a line-by-line basis first.
    const a = this.diff_linesToChars(text1, text2)
    text1 = a.chars1
    text2 = a.chars2
    const linearray = a.lineArray

    const diffs = this.diff_main(text1, text2, false, deadline)

    // Convert the diff back to original text.
    this.diff_charsToLines(diffs, linearray)
    // Eliminate freak matches (e.g. blank lines)
    this.diff_cleanupSemantic(diffs)

    // Rediff any replacement blocks, this time character-by-character.
    // Add a dummy entry at the end.
    diffs.push([Operation.DIFF_EQUAL, ''])
    let pointer = 0
    let countDelete = 0
    let countInsert = 0
    let textDelete = ''
    let textInsert = ''
    while (pointer < diffs.length) {
      switch (diffs[pointer][0]) {
        case Operation.DIFF_INSERT:
          countInsert++
          textInsert += diffs[pointer][1]
          break
        case Operation.DIFF_DELETE:
          countDelete++
          textDelete += diffs[pointer][1]
          break
        case Operation.DIFF_EQUAL:
        // Upon reaching an equality, check for prior redundancies.
          if (countDelete >= 1 && countInsert >= 1) {
          // Delete the offending records and add the merged ones.
            diffs.splice(pointer - countDelete - countInsert,
              countDelete + countInsert)
            pointer = pointer - countDelete - countInsert
            const subDiff =
              this.diff_main(textDelete, textInsert, false, deadline)
            for (let j = subDiff.length - 1; j >= 0; j--) {
              diffs.splice(pointer, 0, subDiff[j])
            }
            pointer = pointer + subDiff.length
          }
          countInsert = 0
          countDelete = 0
          textDelete = ''
          textInsert = ''
          break
      }
      pointer++
    }
    diffs.pop() // Remove the dummy entry at the end.

    return diffs
  }

  /**
   * Find the 'middle snake' of a diff, split the problem in two
   * and return the recursively constructed diff.
   * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {number} deadline Time at which to bail if not yet complete.
   * @return {Diff[]} Array of diff tuples.
   * @private
   */
  diff_bisect (text1: string, text2: string, deadline: number): Diff[] {
    // Cache the text lengths to prevent multiple calls.
    const text1Length = text1.length
    const text2Length = text2.length
    const maxD = Math.ceil((text1Length + text2Length) / 2)
    const vOffset = maxD
    const vLength = 2 * maxD
    const v1 = new Array<number>(vLength)
    const v2 = new Array<number>(vLength)
    // Setting all elements to -1 is faster in Chrome & Firefox than mixing
    // integers and undefined.
    for (let x = 0; x < vLength; x++) {
      v1[x] = -1
      v2[x] = -1
    }
    v1[vOffset + 1] = 0
    v2[vOffset + 1] = 0
    const delta = text1Length - text2Length
    // If the total number of characters is odd, then the front path will collide
    // with the reverse path.
    const front = (delta % 2 !== 0)
    // Offsets for start and end of k loop.
    // Prevents mapping of space beyond the grid.
    let k1start = 0
    let k1end = 0
    let k2start = 0
    let k2end = 0
    for (let d = 0; d < maxD; d++) {
      // Bail out if deadline is reached.
      if ((new Date()).getTime() > deadline) {
        break
      }

      // Walk the front path one step.
      for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
        const k1Offset = vOffset + k1
        let x1
        if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) {
          x1 = v1[k1Offset + 1]
        } else {
          x1 = v1[k1Offset - 1] + 1
        }
        let y1 = x1 - k1
        while (x1 < text1Length && y1 < text2Length &&
             text1.charAt(x1) === text2.charAt(y1)) {
          x1++
          y1++
        }
        v1[k1Offset] = x1
        if (x1 > text1Length) {
          // Ran off the right of the graph.
          k1end += 2
        } else if (y1 > text2Length) {
          // Ran off the bottom of the graph.
          k1start += 2
        } else if (front) {
          const k2Offset = vOffset + delta - k1
          if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
            // Mirror x2 onto top-left coordinate system.
            const x2 = text1Length - v2[k2Offset]
            if (x1 >= x2) {
              // Overlap detected.
              return this.diff_bisectSplit(text1, text2, x1, y1, deadline)
            }
          }
        }
      }

      // Walk the reverse path one step.
      for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
        const k2Offset = vOffset + k2
        let x2
        if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) {
          x2 = v2[k2Offset + 1]
        } else {
          x2 = v2[k2Offset - 1] + 1
        }
        let y2 = x2 - k2
        while (x2 < text1Length && y2 < text2Length &&
             text1.charAt(text1Length - x2 - 1) ===
             text2.charAt(text2Length - y2 - 1)) {
          x2++
          y2++
        }
        v2[k2Offset] = x2
        if (x2 > text1Length) {
          // Ran off the left of the graph.
          k2end += 2
        } else if (y2 > text2Length) {
          // Ran off the top of the graph.
          k2start += 2
        } else if (!front) {
          const k1Offset = vOffset + delta - k2
          if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
            const x1 = v1[k1Offset]
            const y1 = vOffset + x1 - k1Offset
            // Mirror x2 onto top-left coordinate system.
            x2 = text1Length - x2
            if (x1 >= x2) {
            // Overlap detected.
              return this.diff_bisectSplit(text1, text2, x1, y1, deadline)
            }
          }
        }
      }
    }
    // Diff took too long and hit the deadline or
    // number of diffs equals number of characters, no commonality at all.
    return [
      [Operation.DIFF_DELETE, text1],
      [Operation.DIFF_INSERT, text2]
    ]
  }

  /**
   * Given the location of the 'middle snake', split the diff in two parts
   * and recurse.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {number} x Index of split point in text1.
   * @param {number} y Index of split point in text2.
   * @param {number} deadline Time at which to bail if not yet complete.
   * @return {Diff[]} Array of diff tuples.
   * @private
   */
  diff_bisectSplit (
    text1: string,
    text2: string,
    x: number,
    y: number,
    deadline: number
  ): Diff[] {
    const text1a = text1.substring(0, x)
    const text2a = text2.substring(0, y)
    const text1b = text1.substring(x)
    const text2b = text2.substring(y)

    // Compute both diffs serially.
    const diffs = this.diff_main(text1a, text2a, false, deadline)
    const diffsb = this.diff_main(text1b, text2b, false, deadline)

    return diffs.concat(diffsb)
  }

  /**
   * Split two texts into an array of strings.  Reduce the texts to a string of
   * hashes where each Unicode character represents one line.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {{chars1: string, chars2: string, lineArray: string[]}}
   *     An object containing the encoded text1, the encoded text2 and
   *     the array of unique strings.
   *     The zeroth element of the array of unique strings is intentionally blank.
   * @private
   */
  diff_linesToChars (text1: string, text2: string): {
    chars1: string
    chars2: string
    lineArray: string[]
  } {
    const lineArray = [] // e.g. lineArray[4] == 'Hello\n'
    const lineHash: Record<string, number> = {} // e.g. lineHash['Hello\n'] == 4

    // '\x00' is a valid character, but various debuggers don't like it.
    // So we'll insert a junk entry to avoid generating a null character.
    lineArray[0] = ''

    /**
     * Split a text into an array of strings.  Reduce the texts to a string of
     * hashes where each Unicode character represents one line.
     * Modifies linearray and linehash through being a closure.
     * @param {string} text String to encode.
     * @param {number} maxLines Max number of lines
     * @return {string} Encoded string.
     * @private
     */
    function linesToCharsMunge (text: string, maxLines: number): string {
      let chars = ''
      // Walk the text, pulling out a substring for each line.
      // text.split('\n') would would temporarily double our memory footprint.
      // Modifying text would create many large strings to garbage collect.
      let lineStart = 0
      let lineEnd = -1
      // Keeping our own length variable is faster than looking it up.
      let lineArrayLength = lineArray.length
      while (lineEnd < text.length - 1) {
        lineEnd = text.indexOf('\n', lineStart)
        if (lineEnd === -1) {
          lineEnd = text.length - 1
        }
        let line = text.substring(lineStart, lineEnd + 1)

        if (lineHash[line] !== undefined) {
          chars += String.fromCharCode(lineHash[line])
        } else {
          if (lineArrayLength === maxLines) {
          // Bail out at 65535 because
          // String.fromCharCode(65536) == String.fromCharCode(0)
            line = text.substring(lineStart)
            lineEnd = text.length
          }
          chars += String.fromCharCode(lineArrayLength)
          lineHash[line] = lineArrayLength
          lineArray[lineArrayLength++] = line
        }
        lineStart = lineEnd + 1
      }
      return chars
    }
    // Allocate 2/3rds of the space for text1, the rest for text2.
    const chars1 = linesToCharsMunge(text1, 40000)
    const chars2 = linesToCharsMunge(text2, 65535)
    return { chars1: chars1, chars2: chars2, lineArray: lineArray }
  }

  /**
   * Rehydrate the text in a diff from a string of line hashes to real lines of
   * text.
   * @param {Diff[]} diffs Array of diff tuples.
   * @param {string[]} lineArray Array of unique strings.
   * @private
   */
  diff_charsToLines (diffs: Diff[], lineArray: string[]): void {
    for (let i = 0; i < diffs.length; i++) {
      const chars = diffs[i][1]
      const text = []
      for (let j = 0; j < chars.length; j++) {
        text[j] = lineArray[chars.charCodeAt(j)]
      }
      diffs[i][1] = text.join('')
    }
  }

  /**
   * Determine the common prefix of two strings.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the start of each
   *     string.
   */
  diff_commonPrefix (text1: string, text2: string): number {
  // Quick check for common null cases.
    if (text1 === '' || text2 === '' || text1.charAt(0) !== text2.charAt(0)) {
      return 0
    }
    // Binary search.
    // Performance analysis: https://neil.fraser.name/news/2007/10/09/
    let pointermin = 0
    let pointermax = Math.min(text1.length, text2.length)
    let pointermid = pointermax
    let pointerstart = 0
    while (pointermin < pointermid) {
      if (text1.substring(pointerstart, pointermid) ===
        text2.substring(pointerstart, pointermid)) {
        pointermin = pointermid
        pointerstart = pointermin
      } else {
        pointermax = pointermid
      }
      pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin)
    }
    return pointermid
  }

  /**
   * Determine the common suffix of two strings.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the end of each string.
   */
  diff_commonSuffix (text1: string, text2: string): number {
    // Quick check for common null cases.
    if (
      text1 === '' || text2 === '' ||
      text1.charAt(text1.length - 1) !== text2.charAt(text2.length - 1)
    ) {
      return 0
    }
    // Binary search.
    // Performance analysis: https://neil.fraser.name/news/2007/10/09/
    let pointermin = 0
    let pointermax = Math.min(text1.length, text2.length)
    let pointermid = pointermax
    let pointerend = 0
    while (pointermin < pointermid) {
      if (text1.substring(text1.length - pointermid, text1.length - pointerend) ===
        text2.substring(text2.length - pointermid, text2.length - pointerend)) {
        pointermin = pointermid
        pointerend = pointermin
      } else {
        pointermax = pointermid
      }
      pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin)
    }
    return pointermid
  }

  /**
   * Determine if the suffix of one string is the prefix of another.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the end of the first
   *     string and the start of the second string.
   * @private
   */
  diff_commonOverlap (text1: string, text2: string): number {
  // Cache the text lengths to prevent multiple calls.
    const text1Length = text1.length
    const text2Length = text2.length
    // Eliminate the null case.
    if (text1Length === 0 || text2Length === 0) {
      return 0
    }
    // Truncate the longer string.
    if (text1Length > text2Length) {
      text1 = text1.substring(text1Length - text2Length)
    } else if (text1Length < text2Length) {
      text2 = text2.substring(0, text1Length)
    }
    const textLength = Math.min(text1Length, text2Length)
    // Quick check for the worst case.
    if (text1 === text2) {
      return textLength
    }

    // Start by looking for a single character match
    // and increase length until no match is found.
    // Performance analysis: https://neil.fraser.name/news/2010/11/04/
    let best = 0
    let length = 1
    while (true) {
      const pattern = text1.substring(textLength - length)
      const found = text2.indexOf(pattern)
      if (found === -1) {
        return best
      }
      length += found
      if (
        found === 0 ||
        text1.substring(textLength - length) === text2.substring(0, length)
      ) {
        best = length
        length++
      }
    }
  }

  /**
   * Do the two texts share a substring which is at least half the length of the
   * longer text?
   * This speedup can produce non-minimal diffs.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {[string, string, string, string, string] | null} Five element Array, containing the prefix of
   *     text1, the suffix of text1, the prefix of text2, the suffix of
   *     text2 and the common middle.  Or null if there was no match.
   * @private
   */
  diff_halfMatch (text1: string, text2: string): [string, string, string, string, string] | null {
    if (this.diffTimeout <= 0) {
      // Don't risk returning a non-optimal diff if we have unlimited time.
      return null
    }
    const longtext = text1.length > text2.length ? text1 : text2
    const shorttext = text1.length > text2.length ? text2 : text1
    if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
      return null // Pointless.
    }
    /**
     * Does a substring of shorttext exist within longtext such that the substring
     * is at least half the length of longtext?
     * Closure, but does not reference any external variables.
     * @param {string} longtext Longer string.
     * @param {string} shorttext Shorter string.
     * @param {number} i Start index of quarter length substring within longtext.
     * @return {[string, string, string, string, string] | null} Five element Array, containing the prefix of
     *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
     *     of shorttext and the common middle.  Or null if there was no match.
     * @private
     */
    const halfMatchI = (
      longtext: string,
      shorttext: string,
      i: number
    ): [string, string, string, string, string] | null => {
      // Start with a 1/4 length substring at position i as a seed.
      const seed = longtext.substring(i, i + Math.floor(longtext.length / 4))
      let j = -1
      let bestCommon = ''
      let bestLongtextA = ''
      let bestLongtextB = ''
      let bestShorttextA = ''
      let bestShorttextB = ''

      while ((j = shorttext.indexOf(seed, j + 1)) !== -1) {
        const prefixLength = this.diff_commonPrefix(longtext.substring(i),
          shorttext.substring(j))
        const suffixLength = this.diff_commonSuffix(longtext.substring(0, i),
          shorttext.substring(0, j))
        if (bestCommon.length < suffixLength + prefixLength) {
          bestCommon = shorttext.substring(j - suffixLength, j) +
            shorttext.substring(j, j + prefixLength)
          bestLongtextA = longtext.substring(0, i - suffixLength)
          bestLongtextB = longtext.substring(i + prefixLength)
          bestShorttextA = shorttext.substring(0, j - suffixLength)
          bestShorttextB = shorttext.substring(j + prefixLength)
        }
      }
      if (
        bestCommon.length * 2 >= longtext.length
      ) {
        return [
          bestLongtextA,
          bestLongtextB,
          bestShorttextA,
          bestShorttextB,
          bestCommon
        ]
      } else {
        return null
      }
    }

    // First check if the second quarter is the seed for a half-match.
    const hm1 = halfMatchI(longtext, shorttext,
      Math.ceil(longtext.length / 4))

    // Check again based on the third quarter.
    const hm2 = halfMatchI(longtext, shorttext,
      Math.ceil(longtext.length / 2))

    let hm: [string, string, string, string, string]
    if (hm1 !== null && hm2 !== null) {
      // Both matched.  Select the longest.
      hm = hm1[4].length > hm2[4].length ? hm1 : hm2
    } else if (hm1 !== null) {
      hm = hm1
    } else if (hm2 !== null) {
      hm = hm2
    } else {
      return null
    }

    // A half-match was found, sort out the return data.
    let text1A, text1B, text2A, text2B
    if (text1.length > text2.length) {
      text1A = hm[0]
      text1B = hm[1]
      text2A = hm[2]
      text2B = hm[3]
    } else {
      text2A = hm[0]
      text2B = hm[1]
      text1A = hm[2]
      text1B = hm[3]
    }
    const midCommon = hm[4]
    return [text1A, text1B, text2A, text2B, midCommon]
  }

  /**
   * Reduce the number of edits by eliminating semantically trivial equalities.
   * @param {Diff[]} diffs Array of diff tuples.
   */
  diff_cleanupSemantic (diffs: Diff[]): void {
    let changes = false
    const equalities = [] // Stack of indices where equalities are found.
    let equalitiesLength = 0 // Keeping our own length var is faster in JS.
    let lastEquality: string | null = null
    // Always equal to diffs[equalities[equalitiesLength - 1]][1]
    let pointer = 0 // Index of current position.
    // Number of characters that changed prior to the equality.
    let lengthInsertions1 = 0
    let lengthDeletions1 = 0
    // Number of characters that changed after the equality.
    let lengthInsertions2 = 0
    let lengthDeletions2 = 0
    while (pointer < diffs.length) {
      if (diffs[pointer][0] === Operation.DIFF_EQUAL) { // Equality found.
        equalities[equalitiesLength++] = pointer
        lengthInsertions1 = lengthInsertions2
        lengthDeletions1 = lengthDeletions2
        lengthInsertions2 = 0
        lengthDeletions2 = 0
        lastEquality = diffs[pointer][1]
      } else { // An insertion or deletion.
        if (diffs[pointer][0] === Operation.DIFF_INSERT) {
          lengthInsertions2 += diffs[pointer][1].length
        } else {
          lengthDeletions2 += diffs[pointer][1].length
        }
        // Eliminate an equality that is smaller or equal to the edits on both
        // sides of it.
        if (lastEquality !== null && (lastEquality.length <=
          Math.max(lengthInsertions1, lengthDeletions1)) &&
          (lastEquality.length <= Math.max(lengthInsertions2,
            lengthDeletions2))) {
        // Duplicate record.
          diffs.splice(
            equalities[equalitiesLength - 1],
            0,
            [Operation.DIFF_DELETE, lastEquality]
          )
          // Change second copy to insert.
          diffs[equalities[equalitiesLength - 1] + 1][0] = Operation.DIFF_INSERT
          // Throw away the equality we just deleted.
          equalitiesLength--
          // Throw away the previous equality (it needs to be reevaluated).
          equalitiesLength--
          pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1
          lengthInsertions1 = 0 // Reset the counters.
          lengthDeletions1 = 0
          lengthInsertions2 = 0
          lengthDeletions2 = 0
          lastEquality = null
          changes = true
        }
      }
      pointer++
    }

    // Normalize the diff.
    if (changes) {
      this.diff_cleanupMerge(diffs)
    }
    this.diff_cleanupSemanticLossless(diffs)

    // Find any overlaps between deletions and insertions.
    // e.g: <del>abcxxx</del><ins>xxxdef</ins>
    //   -> <del>abc</del>xxx<ins>def</ins>
    // e.g: <del>xxxabc</del><ins>defxxx</ins>
    //   -> <ins>def</ins>xxx<del>abc</del>
    // Only extract an overlap if it is as big as the edit ahead or behind it.
    pointer = 1
    while (pointer < diffs.length) {
      if (
        diffs[pointer - 1][0] === Operation.DIFF_DELETE &&
        diffs[pointer][0] === Operation.DIFF_INSERT
      ) {
        const deletion = diffs[pointer - 1][1]
        const insertion = diffs[pointer][1]
        const overlapLength1 = this.diff_commonOverlap(deletion, insertion)
        const overlapLength2 = this.diff_commonOverlap(insertion, deletion)
        if (overlapLength1 >= overlapLength2) {
          if (
            overlapLength1 >= deletion.length / 2 ||
            overlapLength1 >= insertion.length / 2
          ) {
            // Overlap found.  Insert an equality and trim the surrounding edits.
            diffs.splice(
              pointer,
              0,
              [Operation.DIFF_EQUAL, insertion.substring(0, overlapLength1)]
            )
            diffs[pointer - 1][1] =
              deletion.substring(0, deletion.length - overlapLength1)
            diffs[pointer + 1][1] = insertion.substring(overlapLength1)
            pointer++
          }
        } else {
          if (
            overlapLength2 >= deletion.length / 2 ||
            overlapLength2 >= insertion.length / 2
          ) {
            // Reverse overlap found.
            // Insert an equality and swap and trim the surrounding edits.
            diffs.splice(
              pointer,
              0,
              [Operation.DIFF_EQUAL, deletion.substring(0, overlapLength2)]
            )
            diffs[pointer - 1][0] = Operation.DIFF_INSERT
            diffs[pointer - 1][1] =
              insertion.substring(0, insertion.length - overlapLength2)
            diffs[pointer + 1][0] = Operation.DIFF_DELETE
            diffs[pointer + 1][1] =
              deletion.substring(overlapLength2)
            pointer++
          }
        }
        pointer++
      }
      pointer++
    }
  }

  /**
   * Look for single edits surrounded on both sides by equalities
   * which can be shifted sideways to align the edit to a word boundary.
   * e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
   * @param {Diff[]} diffs Array of diff tuples.
   */
  diff_cleanupSemanticLossless (diffs: Diff[]): void {
    /**
     * Given two strings, compute a score representing whether the internal
     * boundary falls on logical boundaries.
     * Scores range from 6 (best) to 0 (worst).
     * Closure, but does not reference any external variables.
     * @param {string} one First string.
     * @param {string} two Second string.
     * @return {number} The score.
     * @private
     */
    function cleanupSemanticScore (one: string, two: string): number {
      if (one === '' || two === '') {
        // Edges are the best.
        return 6
      }

      // Each port of this function behaves slightly differently due to
      // subtle differences in each language's definition of things like
      // 'whitespace'.  Since this function's purpose is largely cosmetic,
      // the choice has been made to use each language's native features
      // rather than force total conformity.
      const char1 = one.charAt(one.length - 1)
      const char2 = two.charAt(0)
      const nonAlphaNumeric1 = char1.match(DiffMatchPatch.nonAlphaNumericRegex)
      const nonAlphaNumeric2 = char2.match(DiffMatchPatch.nonAlphaNumericRegex)
      const whitespace1 = (nonAlphaNumeric1 !== null) &&
        char1.match(DiffMatchPatch.whitespaceRegex)
      const whitespace2 = (nonAlphaNumeric2 !== null) &&
        char2.match(DiffMatchPatch.whitespaceRegex)
      const lineBreak1 = (whitespace1 !== null) &&
        char1.match(DiffMatchPatch.linebreakRegex)
      const lineBreak2 = (whitespace2 !== null) &&
        char2.match(DiffMatchPatch.linebreakRegex)
      const blankLine1 = (lineBreak1 !== null) &&
        one.match(DiffMatchPatch.blanklineEndRegex)
      const blankLine2 = (lineBreak2 !== null) &&
        two.match(DiffMatchPatch.blanklineStartRegex)

      if (Boolean(blankLine1) || Boolean(blankLine2)) {
        // Five points for blank lines.
        return 5
      } else if (Boolean(lineBreak1) || Boolean(lineBreak2)) {
        // Four points for line breaks.
        return 4
        // eslint-disable-next-line no-extra-boolean-cast
      } else if (Boolean(nonAlphaNumeric1) && !Boolean(whitespace1) && Boolean(whitespace2)) {
        // Three points for end of sentences.
        return 3
      } else if (Boolean(whitespace1) || Boolean(whitespace2)) {
        // Two points for whitespace.
        return 2
      } else if (Boolean(nonAlphaNumeric1) || Boolean(nonAlphaNumeric2)) {
        // One point for non-alphanumeric.
        return 1
      }
      return 0
    }

    let pointer = 1
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < diffs.length - 1) {
      if (
        diffs[pointer - 1][0] === Operation.DIFF_EQUAL &&
        diffs[pointer + 1][0] === Operation.DIFF_EQUAL
      ) {
        // This is a single edit surrounded by equalities.
        let equality1 = diffs[pointer - 1][1]
        let edit = diffs[pointer][1]
        let equality2 = diffs[pointer + 1][1]

        // First, shift the edit as far left as possible.
        const commonOffset = this.diff_commonSuffix(equality1, edit)
        if (commonOffset !== 0) {
          const commonString = edit.substring(edit.length - commonOffset)
          equality1 = equality1.substring(0, equality1.length - commonOffset)
          edit = commonString + edit.substring(0, edit.length - commonOffset)
          equality2 = commonString + equality2
        }

        // Second, step character by character right, looking for the best fit.
        let bestEquality1 = equality1
        let bestEdit = edit
        let bestEquality2 = equality2
        let bestScore = cleanupSemanticScore(equality1, edit) +
          cleanupSemanticScore(edit, equality2)
        while (edit.charAt(0) === equality2.charAt(0)) {
          equality1 += edit.charAt(0)
          edit = edit.substring(1) + equality2.charAt(0)
          equality2 = equality2.substring(1)
          const score = cleanupSemanticScore(equality1, edit) +
            cleanupSemanticScore(edit, equality2)
          // The >= encourages trailing rather than leading whitespace on edits.
          if (score >= bestScore) {
            bestScore = score
            bestEquality1 = equality1
            bestEdit = edit
            bestEquality2 = equality2
          }
        }

        if (diffs[pointer - 1][1] !== bestEquality1) {
        // We have an improvement, save it back to the diff.
          if (bestEquality1 !== '') {
            diffs[pointer - 1][1] = bestEquality1
          } else {
            diffs.splice(pointer - 1, 1)
            pointer--
          }
          diffs[pointer][1] = bestEdit
          if (bestEquality2 !== '') {
            diffs[pointer + 1][1] = bestEquality2
          } else {
            diffs.splice(pointer + 1, 1)
            pointer--
          }
        }
      }
      pointer++
    }
  }

  // Define some regex patterns for matching boundaries.
  static nonAlphaNumericRegex = /[^a-zA-Z0-9]/
  static whitespaceRegex = /\s/
  static linebreakRegex = /[\r\n]/
  static blanklineEndRegex = /\n\r?\n$/
  static blanklineStartRegex = /^\r?\n\r?\n/

  /**
   * Reduce the number of edits by eliminating operationally trivial equalities.
   * @param {Diff[]} diffs Array of diff tuples.
   */
  diff_cleanupEfficiency (diffs: Diff[]): void {
    let changes = false
    const equalities = [] // Stack of indices where equalities are found.
    let equalitiesLength = 0 // Keeping our own length var is faster in JS.
    /** @type {?string} */
    let lastEquality = null
    // Always equal to diffs[equalities[equalitiesLength - 1]][1]
    let pointer = 0 // Index of current position.
    // Is there an insertion operation before the last equality.
    let preIns = false
    // Is there a deletion operation before the last equality.
    let preDel = false
    // Is there an insertion operation after the last equality.
    let postIns = false
    // Is there a deletion operation after the last equality.
    let postDel = false
    while (pointer < diffs.length) {
      if (diffs[pointer][0] === Operation.DIFF_EQUAL) {
        // Equality found.
        if (
          diffs[pointer][1].length < this.diffEditCost &&
          (postIns || postDel)
        ) {
          // Candidate found.
          equalities[equalitiesLength++] = pointer
          preIns = postIns
          preDel = postDel
          lastEquality = diffs[pointer][1]
        } else {
          // Not a candidate, and can never become one.
          equalitiesLength = 0
          lastEquality = null
        }
        postIns = postDel = false
      } else {
        // An insertion or deletion.
        if (diffs[pointer][0] === Operation.DIFF_DELETE) {
          postDel = true
        } else {
          postIns = true
        }
        /*
        * Five types to be split:
        * <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
        * <ins>A</ins>X<ins>C</ins><del>D</del>
        * <ins>A</ins><del>B</del>X<ins>C</ins>
        * <ins>A</del>X<ins>C</ins><del>D</del>
        * <ins>A</ins><del>B</del>X<del>C</del>
        */
        if (
          lastEquality !== null &&
          (
            (
              preIns &&
              preDel &&
              postIns &&
              postDel
            ) || (
              (lastEquality.length < this.diffEditCost / 2) &&
              (Number(preIns) +
               Number(preDel) +
               Number(postIns) +
               Number(postDel)) === 3
            )
          )
        ) {
        // Duplicate record.
          diffs.splice(
            equalities[equalitiesLength - 1],
            0,
            [Operation.DIFF_DELETE, lastEquality]
          )
          // Change second copy to insert.
          diffs[equalities[equalitiesLength - 1] + 1][0] = Operation.DIFF_INSERT
          equalitiesLength-- // Throw away the equality we just deleted;
          lastEquality = null
          if (preIns && preDel) {
            // No changes made which could affect previous entry, keep going.
            postIns = postDel = true
            equalitiesLength = 0
          } else {
            equalitiesLength-- // Throw away the previous equality.
            pointer = equalitiesLength > 0
              ? equalities[equalitiesLength - 1]
              : -1
            postIns = postDel = false
          }
          changes = true
        }
      }
      pointer++
    }

    if (changes) {
      this.diff_cleanupMerge(diffs)
    }
  }

  /**
   * Reorder and merge like edit sections.  Merge equalities.
   * Any edit section can move as long as it doesn't cross an equality.
   * @param {Diff[]} diffs Array of diff tuples.
   */
  diff_cleanupMerge (diffs: Diff[]): void {
    // Add a dummy entry at the end.
    diffs.push([Operation.DIFF_EQUAL, ''])
    let pointer = 0
    let countDelete = 0
    let countInsert = 0
    let textDelete = ''
    let textInsert = ''
    let commonlength
    while (pointer < diffs.length) {
      switch (diffs[pointer][0]) {
        case Operation.DIFF_INSERT:
          countInsert++
          textInsert += diffs[pointer][1]
          pointer++
          break
        case Operation.DIFF_DELETE:
          countDelete++
          textDelete += diffs[pointer][1]
          pointer++
          break
        case Operation.DIFF_EQUAL:
          // Upon reaching an equality, check for prior redundancies.
          if (countDelete + countInsert > 1) {
            if (countDelete !== 0 && countInsert !== 0) {
              // Factor out any common prefixies.
              commonlength = this.diff_commonPrefix(textInsert, textDelete)
              if (commonlength !== 0) {
                if (
                  (pointer - countDelete - countInsert) > 0 &&
                  diffs[pointer - countDelete - countInsert - 1][0] === Operation.DIFF_EQUAL
                ) {
                  diffs[pointer - countDelete - countInsert - 1][1] +=
                    textInsert.substring(0, commonlength)
                } else {
                  diffs.splice(
                    0,
                    0,
                    [Operation.DIFF_EQUAL, textInsert.substring(0, commonlength)]
                  )
                  pointer++
                }
                textInsert = textInsert.substring(commonlength)
                textDelete = textDelete.substring(commonlength)
              }
              // Factor out any common suffixies.
              commonlength = this.diff_commonSuffix(textInsert, textDelete)
              if (commonlength !== 0) {
                diffs[pointer][1] = textInsert.substring(textInsert.length -
                  commonlength) + diffs[pointer][1]
                textInsert = textInsert.substring(0, textInsert.length -
                  commonlength)
                textDelete = textDelete.substring(0, textDelete.length -
                  commonlength)
              }
            }
            // Delete the offending records and add the merged ones.
            pointer -= countDelete + countInsert
            diffs.splice(pointer, countDelete + countInsert)
            if (textDelete.length !== 0) {
              diffs.splice(
                pointer,
                0,
                [Operation.DIFF_DELETE, textDelete]
              )
              pointer++
            }
            if (textInsert.length !== 0) {
              diffs.splice(
                pointer,
                0,
                [Operation.DIFF_INSERT, textInsert]
              )
              pointer++
            }
            pointer++
          } else if (pointer !== 0 && diffs[pointer - 1][0] === Operation.DIFF_EQUAL) {
            // Merge this equality with the previous one.
            diffs[pointer - 1][1] += diffs[pointer][1]
            diffs.splice(pointer, 1)
          } else {
            pointer++
          }
          countInsert = 0
          countDelete = 0
          textDelete = ''
          textInsert = ''
          break
      }
    }
    if (diffs[diffs.length - 1][1] === '') {
      diffs.pop() // Remove the dummy entry at the end.
    }

    // Second pass: look for single edits surrounded on both sides by equalities
    // which can be shifted sideways to eliminate an equality.
    // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
    let changes = false
    pointer = 1
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < diffs.length - 1) {
      if (
        diffs[pointer - 1][0] === Operation.DIFF_EQUAL &&
        diffs[pointer + 1][0] === Operation.DIFF_EQUAL
      ) {
        // This is a single edit surrounded by equalities.
        if (
          diffs[pointer][1].substring(diffs[pointer][1].length -
          diffs[pointer - 1][1].length) === diffs[pointer - 1][1]
        ) {
          // Shift the edit over the previous equality.
          diffs[pointer][1] = diffs[pointer - 1][1] +
            diffs[pointer][1].substring(0, diffs[pointer][1].length -
                                        diffs[pointer - 1][1].length)
          diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1]
          diffs.splice(pointer - 1, 1)
          changes = true
        } else if (
          diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ===
          diffs[pointer + 1][1]
        ) {
          // Shift the edit over the next equality.
          diffs[pointer - 1][1] += diffs[pointer + 1][1]
          diffs[pointer][1] =
            diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
            diffs[pointer + 1][1]
          diffs.splice(pointer + 1, 1)
          changes = true
        }
      }
      pointer++
    }
    // If shifts were made, the diff needs reordering and another shift sweep.
    if (changes) {
      this.diff_cleanupMerge(diffs)
    }
  }

  /**
   * loc is a location in text1, compute and return the equivalent location in
   * text2.
   * e.g. 'The cat' vs 'The big cat', 1->1, 5->8
   * @param {Diff[]} diffs Array of diff tuples.
   * @param {number} loc Location within text1.
   * @return {number} Location within text2.
   */
  diff_xIndex (diffs: Diff[], loc: number): number {
    let chars1 = 0
    let chars2 = 0
    let lastChars1 = 0
    let lastChars2 = 0
    let x
    for (x = 0; x < diffs.length; x++) {
      if (diffs[x][0] !== Operation.DIFF_INSERT) { // Equality or deletion.
        chars1 += diffs[x][1].length
      }
      if (diffs[x][0] !== Operation.DIFF_DELETE) { // Equality or insertion.
        chars2 += diffs[x][1].length
      }
      if (chars1 > loc) { // Overshot the location.
        break
      }
      lastChars1 = chars1
      lastChars2 = chars2
    }
    // Was the location was deleted?
    if (diffs.length !== x && diffs[x][0] === Operation.DIFF_DELETE) {
      return lastChars2
    }
    // Add the remaining character length.
    return lastChars2 + (loc - lastChars1)
  }

  /**
   * Convert a diff array into a pretty HTML report.
   * @param {Diff[]} diffs Array of diff tuples.
   * @return {string} HTML representation.
   */
  diff_prettyHtml (diffs: Diff[]): string {
    const html = []
    const patternAmp = /&/g
    const patternLt = /</g
    const patternGt = />/g
    const patternPara = /\n/g
    for (let x = 0; x < diffs.length; x++) {
      const op = diffs[x][0] // Operation (insert, delete, equal)
      const data = diffs[x][1] // Text of change.
      const text = data.replace(patternAmp, '&amp;').replace(patternLt, '&lt;')
        .replace(patternGt, '&gt;').replace(patternPara, '&para;<br>')
      switch (op) {
        case Operation.DIFF_INSERT:
          html[x] = '<ins style="background:#e6ffe6;">' + text + '</ins>'
          break
        case Operation.DIFF_DELETE:
          html[x] = '<del style="background:#ffe6e6;">' + text + '</del>'
          break
        case Operation.DIFF_EQUAL:
          html[x] = '<span>' + text + '</span>'
          break
      }
    }
    return html.join('')
  }

  /**
   * Compute and return the source text (all equalities and deletions).
   * @param {Diff[]} diffs Array of diff tuples.
   * @return {string} Source text.
   */
  diff_text1 (diffs: Diff[]): string {
    const text = []
    for (let x = 0; x < diffs.length; x++) {
      if (diffs[x][0] !== Operation.DIFF_INSERT) {
        text[x] = diffs[x][1]
      }
    }
    return text.join('')
  }

  /**
   * Compute and return the destination text (all equalities and insertions).
   * @param {Diff[]>} diffs Array of diff tuples.
   * @return {string} Destination text.
   */
  diff_text2 (diffs: Diff[]): string {
    const text = []
    for (let x = 0; x < diffs.length; x++) {
      if (diffs[x][0] !== Operation.DIFF_DELETE) {
        text[x] = diffs[x][1]
      }
    }
    return text.join('')
  }

  /**
   * Compute the Levenshtein distance; the number of inserted, deleted or
   * substituted characters.
   * @param {Diff[]>} diffs Array of diff tuples.
   * @return {number} Number of changes.
   */
  diff_levenshtein (diffs: Diff[]): number {
    let levenshtein = 0
    let insertions = 0
    let deletions = 0
    for (let x = 0; x < diffs.length; x++) {
      const op = diffs[x][0]
      const data = diffs[x][1]
      switch (op) {
        case Operation.DIFF_INSERT:
          insertions += data.length
          break
        case Operation.DIFF_DELETE:
          deletions += data.length
          break
        case Operation.DIFF_EQUAL:
        // A deletion and an insertion is one substitution.
          levenshtein += Math.max(insertions, deletions)
          insertions = 0
          deletions = 0
          break
      }
    }
    levenshtein += Math.max(insertions, deletions)
    return levenshtein
  }

  /**
   * Crush the diff into an encoded string which describes the operations
   * required to transform text1 into text2.
   * E.g. =3\t-2\t+ing  -> Keep 3 chars, delete 2 chars, insert 'ing'.
   * Operations are tab-separated.  Inserted text is escaped using %xx notation.
   * @param {Diff[]} diffs Array of diff tuples.
   * @return {string} Delta text.
   */
  diff_toDelta (diffs: Diff[]): string {
    const text = []
    for (let x = 0; x < diffs.length; x++) {
      switch (diffs[x][0]) {
        case Operation.DIFF_INSERT:
          text[x] = '+' + encodeURI(diffs[x][1])
          break
        case Operation.DIFF_DELETE:
          text[x] = '-' + diffs[x][1].length.toString()
          break
        case Operation.DIFF_EQUAL:
          text[x] = '=' + diffs[x][1].length.toString()
          break
      }
    }
    return text.join('\t').replace(/%20/g, ' ')
  }

  /**
   * Given the original text1, and an encoded string which describes the
   * operations required to transform text1 into text2, compute the full diff.
   * @param {string} text1 Source string for the diff.
   * @param {string} delta Delta text.
   * @return {Diff[]} Array of diff tuples.
   * @throws {!Error} If invalid input.
   */
  diff_fromDelta (text1: string, delta: string): Diff[] {
    const diffs: Diff[] = []
    let diffsLength = 0 // Keeping our own length var is faster in JS.
    let pointer = 0 // Cursor in text1
    const tokens = delta.split(/\t/g)
    for (let x = 0; x < tokens.length; x++) {
    // Each token begins with a one character parameter which specifies the
    // operation of this token (delete, insert, equality).
      const param = tokens[x].substring(1)
      switch (tokens[x].charAt(0)) {
        case '+':
          try {
            diffs[diffsLength++] = [Operation.DIFF_INSERT, decodeURI(param)]
          } catch (ex) {
            // Malformed URI sequence.
            throw new Error('Illegal escape in diff_fromDelta: ' + param)
          }
          break
        case '-':
        // Fall through.
        case '=': {
          const n = parseInt(param, 10)
          if (isNaN(n) || n < 0) {
            throw new Error('Invalid number in diff_fromDelta: ' + param)
          }
          const text = text1.substring(pointer, pointer += n)
          if (tokens[x].charAt(0) === '=') {
            diffs[diffsLength++] = [Operation.DIFF_EQUAL, text]
          } else {
            diffs[diffsLength++] = [Operation.DIFF_DELETE, text]
          }
          break
        }
        default:
        // Blank tokens are ok (from a trailing \t).
        // Anything else is an error.
          if (tokens[x] !== undefined && tokens[x] !== '') {
            throw new Error('Invalid diff operation in diff_fromDelta: ' +
                          tokens[x])
          }
      }
    }
    if (pointer !== text1.length) {
      throw new Error(`Delta length (${pointer}) does not equal source text length (${text1.length}).`)
    }
    return diffs
  }

  //  MATCH FUNCTIONS

  /**
   * Locate the best instance of 'pattern' in 'text' near 'loc'.
   * @param {string} text The text to search.
   * @param {string} pattern The pattern to search for.
   * @param {number} loc The location to search around.
   * @return {number} Best match index or -1.
   */
  match_main (text: string, pattern: string, loc: number): number {
    // Check for null inputs.
    if (text == null || pattern == null || loc == null) {
      throw new Error('Null input. (match_main)')
    }

    loc = Math.max(0, Math.min(loc, text.length))
    if (text === pattern) {
      // Shortcut (potentially not guaranteed by the algorithm)
      return 0
    } else if (text.length === 0) {
      // Nothing to match.
      return -1
    } else if (text.substring(loc, loc + pattern.length) === pattern) {
      // Perfect match at the perfect spot!  (Includes case of null pattern)
      return loc
    } else {
      // Do a fuzzy compare.
      return this.match_bitap(text, pattern, loc)
    }
  }

  /**
   * Locate the best instance of 'pattern' in 'text' near 'loc' using the
   * Bitap algorithm.
   * @param {string} text The text to search.
   * @param {string} pattern The pattern to search for.
   * @param {number} loc The location to search around.
   * @return {number} Best match index or -1.
   */
  match_bitap (text: string, pattern: string, loc: number): number {
    if (pattern.length > this.matchMaxBits) {
      throw new Error('Pattern too long for this browser.')
    }

    // Initialise the alphabet.
    const s = this.match_alphabet(pattern)

    /**
     * Compute and return the score for a match with e errors and x location.
     * Accesses loc and pattern through being a closure.
     * @param {number} e Number of errors in match.
     * @param {number} x Location of match.
     * @return {number} Overall score for match (0.0 = good, 1.0 = bad).
     * @private
     */
    const bitapScore = (e: number, x: number): number => {
      const accuracy = e / pattern.length
      const proximity = Math.abs(loc - x)
      if (this.matchDistance === 0) {
        // Dodge divide by zero error.
        return proximity !== 0 ? 1.0 : accuracy
      }
      return accuracy + (proximity / this.matchDistance)
    }

    // Highest score beyond which we give up.
    let scoreThreshold = this.matchThreshold
    // Is there a nearby exact match? (speedup)
    let bestLoc = text.indexOf(pattern, loc)
    if (bestLoc !== -1) {
      scoreThreshold = Math.min(bitapScore(0, bestLoc), scoreThreshold)
      // What about in the other direction? (speedup)
      bestLoc = text.lastIndexOf(pattern, loc + pattern.length)
      if (bestLoc !== -1) {
        scoreThreshold =
          Math.min(bitapScore(0, bestLoc), scoreThreshold)
      }
    }

    // Initialise the bit arrays.
    const matchmask = 1 << (pattern.length - 1)
    bestLoc = -1

    let binMin, binMid
    let binMax = pattern.length + text.length
    let lastRd: number[] = []
    for (let d = 0; d < pattern.length; d++) {
      // Scan for the best match; each iteration allows for one more error.
      // Run a binary search to determine how far from 'loc' we can stray at this
      // error level.
      binMin = 0
      binMid = binMax
      while (binMin < binMid) {
        if (bitapScore(d, loc + binMid) <= scoreThreshold) {
          binMin = binMid
        } else {
          binMax = binMid
        }
        binMid = Math.floor((binMax - binMin) / 2 + binMin)
      }
      // Use the result from this iteration as the maximum for the next.
      binMax = binMid
      let start = Math.max(1, loc - binMid + 1)
      const finish = Math.min(loc + binMid, text.length) + pattern.length

      const rd = Array<number>(finish + 2)
      rd[finish + 1] = (1 << d) - 1
      for (let j = finish; j >= start; j--) {
        // The alphabet (s) is a sparse hash, so the following line generates
        // warnings.
        const charMatch = s[text.charAt(j - 1)]
        if (d === 0) { // First pass: exact match.
          rd[j] = ((rd[j + 1] << 1) | 1) & charMatch
        } else { // Subsequent passes: fuzzy match.
          rd[j] = (((rd[j + 1] << 1) | 1) & charMatch) |
                (((lastRd[j + 1] | lastRd[j]) << 1) | 1) |
                lastRd[j + 1]
        }
        if ((rd[j] & matchmask) !== 0) {
          const score = bitapScore(d, j - 1)
          // This match will almost certainly be better than any existing match.
          // But check anyway.
          if (score <= scoreThreshold) {
          // Told you so.
            scoreThreshold = score
            bestLoc = j - 1
            if (bestLoc > loc) {
            // When passing loc, don't exceed our current distance from loc.
              start = Math.max(1, 2 * loc - bestLoc)
            } else {
            // Already passed loc, downhill from here on in.
              break
            }
          }
        }
      }
      // No hope for a (better) match at greater error levels.
      if (bitapScore(d + 1, loc) > scoreThreshold) {
        break
      }
      lastRd = rd
    }
    return bestLoc
  }

  /**
   * Initialise the alphabet for the Bitap algorithm.
   * @param {string} pattern The text to encode.
   * @return {Record<string, number>} Hash of character locations.
   * @private
   */
  match_alphabet (pattern: string): Record<string, number> {
    const s: Record<string, number> = {}
    for (let i = 0; i < pattern.length; i++) {
      s[pattern.charAt(i)] = 0
    }
    for (let i = 0; i < pattern.length; i++) {
      s[pattern.charAt(i)] |= 1 << (pattern.length - i - 1)
    }
    return s
  }

  //  PATCH FUNCTIONS

  /**
   * Increase the context until it is unique,
   * but don't let the pattern expand beyond matchMaxBits.
   * @param {PatchObj} patch The patch to grow.
   * @param {string} text Source text.
   * @private
   */
  patch_addContext (patch: PatchObj, text: string): void {
    if (text.length === 0) {
      return
    }
    if (patch.start1 === null || patch.start2 === null) {
      throw Error('patch not initialized')
    }
    let pattern = text.substring(patch.start2, patch.start2 + patch.length1)
    let padding = 0

    // Look for the first and last matches of pattern in text.  If two different
    // matches are found, increase the pattern length.
    while (text.indexOf(pattern) !== text.lastIndexOf(pattern) &&
         pattern.length < this.matchMaxBits - this.patchMargin -
         this.patchMargin) {
      padding += this.patchMargin
      pattern = text.substring(patch.start2 - padding,
        patch.start2 + patch.length1 + padding)
    }
    // Add one chunk for good luck.
    padding += this.patchMargin

    // Add the prefix.
    const prefix = text.substring(patch.start2 - padding, patch.start2)
    if (prefix !== '') {
      patch.diffs.unshift([Operation.DIFF_EQUAL, prefix])
    }
    // Add the suffix.
    const suffix = text.substring(patch.start2 + patch.length1,
      patch.start2 + patch.length1 + padding)
    if (suffix !== '') {
      patch.diffs.push([Operation.DIFF_EQUAL, suffix])
    }

    // Roll back the start points.
    patch.start1 -= prefix.length
    patch.start2 -= prefix.length
    // Extend the lengths.
    patch.length1 += prefix.length + suffix.length
    patch.length2 += prefix.length + suffix.length
  }

  /**
   * Compute a list of patches to turn text1 into text2.
   * Use diffs if provided, otherwise compute it ourselves.
   * There are four ways to call this function, depending on what data is
   * available to the caller:
   * Method 1:
   * a = text1, b = text2
   * Method 2:
   * a = diffs
   * Method 3 (optimal):
   * a = text1, b = diffs
   * Method 4 (deprecated, use method 3):
   * a = text1, b = text2, c = diffs
   *
   * @param {string|Diff[]} a text1 (methods 1,3,4) or
   * Array of diff tuples for text1 to text2 (method 2).
   * @param {string|Diff[]} b text2 (methods 1,4) or
   * Array of diff tuples for text1 to text2 (method 3) or undefined (method 2).
   * @param {string|Diff[]} c Array of diff tuples
   * for text1 to text2 (method 4) or undefined (methods 1,2,3).
   * @return {PatchObj[]} Array of PatchObj objects.
   */
  patch_make (
    text1: string,
    text2: string
  ): PatchObj[]
  patch_make (
    diffs: Diff[]
  ): PatchObj[]
  patch_make (
    text1: string,
    diffs: Diff[]
  ): PatchObj[]
  patch_make (
    text1: string,
    text2: string,
    diffs: Diff[]
  ): PatchObj[]
  patch_make (
    a: string | Diff[],
    b?: string | Diff[],
    c?: string | Diff[]
  ): PatchObj[] {
    let text1: string, diffs: Diff[]
    if (
      typeof a === 'string' &&
      typeof b === 'string' &&
      typeof c === 'undefined'
    ) {
      // Method 1: text1, text2
      // Compute diffs from text1 and text2.
      text1 = a
      diffs = this.diff_main(text1, b, true)
      if (diffs.length > 2) {
        this.diff_cleanupSemantic(diffs)
        this.diff_cleanupEfficiency(diffs)
      }
    } else if (
      a !== null && typeof a === 'object' &&
      typeof b === 'undefined' &&
      typeof c === 'undefined'
    ) {
      // Method 2: diffs
      // Compute text1 from diffs.
      diffs = a
      text1 = this.diff_text1(diffs)
    } else if (
      typeof a === 'string' &&
      b !== null && typeof b === 'object' &&
      typeof c === 'undefined'
    ) {
      // Method 3: text1, diffs
      text1 = a
      diffs = b
    } else if (
      typeof a === 'string' &&
      typeof b === 'string' &&
      c !== null && typeof c === 'object'
    ) {
      // Method 4: text1, text2, diffs
      // text2 is not used.
      text1 = a
      diffs = c
    } else {
      throw new Error('Unknown call format to patch_make.')
    }

    if (diffs.length === 0) {
      return [] // Get rid of the null case.
    }

    const patches = []
    let patch = new PatchObj()
    let patchDiffLength = 0 // Keeping our own length var is faster in JS.
    let charCount1 = 0 // Number of characters into the text1 string.
    let charCount2 = 0 // Number of characters into the text2 string.
    // Start with text1 (prepatchText) and apply the diffs until we arrive at
    // text2 (postpatchText).  We recreate the patches one by one to determine
    // context info.
    let prepatchText = text1
    let postpatchText = text1
    for (let x = 0; x < diffs.length; x++) {
      const diffType = diffs[x][0]
      const diffText = diffs[x][1]

      if (patchDiffLength === 0 && diffType !== Operation.DIFF_EQUAL) {
        // A new patch starts here.
        patch.start1 = charCount1
        patch.start2 = charCount2
      }

      switch (diffType) {
        case Operation.DIFF_INSERT:
          patch.diffs[patchDiffLength++] = diffs[x]
          patch.length2 += diffText.length
          postpatchText = postpatchText.substring(0, charCount2) + diffText +
                         postpatchText.substring(charCount2)
          break
        case Operation.DIFF_DELETE:
          patch.length1 += diffText.length
          patch.diffs[patchDiffLength++] = diffs[x]
          postpatchText = postpatchText.substring(0, charCount2) +
                         postpatchText.substring(charCount2 +
                             diffText.length)
          break
        case Operation.DIFF_EQUAL:
          if (
            diffText.length <= 2 * this.patchMargin &&
            patchDiffLength !== 0 &&
            diffs.length !== x + 1
          ) {
            // Small equality inside a patch.
            patch.diffs[patchDiffLength++] = diffs[x]
            patch.length1 += diffText.length
            patch.length2 += diffText.length
          } else if (diffText.length >= 2 * this.patchMargin) {
            // Time for a new patch.
            if (patchDiffLength !== 0) {
              this.patch_addContext(patch, prepatchText)
              patches.push(patch)
              patch = new PatchObj()
              patchDiffLength = 0
              // Unlike Unidiff, our patch lists have a rolling context.
              // https://github.com/google/diff-match-patch/wiki/Unidiff
              // Update prepatch text & pos to reflect the application of the
              // just completed patch.
              prepatchText = postpatchText
              charCount1 = charCount2
            }
          }
          break
      }

      // Update the current character count.
      if (diffType !== Operation.DIFF_INSERT) {
        charCount1 += diffText.length
      }
      if (diffType !== Operation.DIFF_DELETE) {
        charCount2 += diffText.length
      }
    }
    // Pick up the leftover patch if not empty.
    if (patchDiffLength !== 0) {
      this.patch_addContext(patch, prepatchText)
      patches.push(patch)
    }

    return patches
  }

  /**
   * Given an array of patches, return another array that is identical.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @return {PatchObj[]} Array of PatchObj objects.
   */
  patch_deepCopy (patches: PatchObj[]): PatchObj[] {
  // Making deep copies is hard in JavaScript.
    const patchesCopy = []
    for (let x = 0; x < patches.length; x++) {
      const patch = patches[x]
      const patchCopy = new PatchObj()
      patchCopy.diffs = []
      for (let y = 0; y < patch.diffs.length; y++) {
        patchCopy.diffs[y] = [patch.diffs[y][0], patch.diffs[y][1]]
      }
      patchCopy.start1 = patch.start1
      patchCopy.start2 = patch.start2
      patchCopy.length1 = patch.length1
      patchCopy.length2 = patch.length2
      patchesCopy[x] = patchCopy
    }
    return patchesCopy
  }

  /**
   * Merge a set of patches onto the text.  Return a patched text, as well
   * as a list of true/false values indicating which patches were applied.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @param {string} text Old text.
   * @return {!Array.<string|!Array.<boolean>>} Two element Array, containing the
   *      new text and an array of boolean values.
   */
  patch_apply (patches: PatchObj[], text: string): [string, boolean[]] {
    if (patches.length === 0) {
      return [text, []]
    }

    // Deep copy the patches so that no changes are made to originals.
    patches = this.patch_deepCopy(patches)

    const nullPadding = this.patch_addPadding(patches)
    text = nullPadding + text + nullPadding

    this.patch_splitMax(patches)
    // delta keeps track of the offset between the expected and actual location
    // of the previous patch.  If there are patches expected at positions 10 and
    // 20, but the first patch was found at 12, delta is 2 and the second patch
    // has an effective expected position of 22.
    let delta = 0
    const results = []
    for (let x = 0; x < patches.length; x++) {
      const patch = patches[x]

      if (patch.start1 === null || patch.start2 === null) {
        continue
      }

      const expectedLoc = patch.start2 + delta
      const text1 = this.diff_text1(patch.diffs)
      let startLoc
      let endLoc = -1
      if (text1.length > this.matchMaxBits) {
        // patch_splitMax will only provide an oversized pattern in the case of
        // a monster delete.
        startLoc = this.match_main(text, text1.substring(0, this.matchMaxBits),
          expectedLoc)
        if (startLoc !== -1) {
          endLoc = this.match_main(text,
            text1.substring(text1.length - this.matchMaxBits),
            expectedLoc + text1.length - this.matchMaxBits)
          if (endLoc === -1 || startLoc >= endLoc) {
            // Can't find valid trailing context.  Drop this patch.
            startLoc = -1
          }
        }
      } else {
        startLoc = this.match_main(text, text1, expectedLoc)
      }
      if (startLoc === -1) {
        // No match found.  :(
        results[x] = false
        // Subtract the delta for this failed patch from subsequent patches.
        delta -= patch.length2 - patch.length1
      } else {
        // Found a match.  :)
        results[x] = true
        delta = startLoc - expectedLoc
        let text2
        if (endLoc === -1) {
          text2 = text.substring(startLoc, startLoc + text1.length)
        } else {
          text2 = text.substring(startLoc, endLoc + this.matchMaxBits)
        }
        if (text1 === text2) {
          // Perfect match, just shove the replacement text in.
          text = text.substring(0, startLoc) +
               this.diff_text2(patch.diffs) +
               text.substring(startLoc + text1.length)
        } else {
          // Imperfect match.  Run a diff to get a framework of equivalent
          // indices.
          const diffs = this.diff_main(text1, text2, false)
          if (text1.length > this.matchMaxBits &&
            this.diff_levenshtein(diffs) / text1.length >
            this.patchDeleteThreshold) {
            // The end points match, but the content is unacceptably bad.
            results[x] = false
          } else {
            this.diff_cleanupSemanticLossless(diffs)
            let index1 = 0
            let index2 = 0
            for (let y = 0; y < patch.diffs.length; y++) {
              const mod = patch.diffs[y]
              if (mod[0] !== Operation.DIFF_EQUAL) {
                index2 = this.diff_xIndex(diffs, index1)
              }
              if (mod[0] === Operation.DIFF_INSERT) { // Insertion
                text = text.substring(0, startLoc + index2) + mod[1] +
                     text.substring(startLoc + index2)
              } else if (mod[0] === Operation.DIFF_DELETE) { // Deletion
                text = text.substring(0, startLoc + index2) +
                     text.substring(startLoc + this.diff_xIndex(diffs,
                       index1 + mod[1].length))
              }
              if (mod[0] !== Operation.DIFF_DELETE) {
                index1 += mod[1].length
              }
            }
          }
        }
      }
    }
    // Strip the padding off.
    text = text.substring(nullPadding.length, text.length - nullPadding.length)
    return [text, results]
  }

  /**
   * Add some padding on text start and end so that edges can match something.
   * Intended to be called only from within patch_apply.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @return {string} The padding string added to each side.
   */
  patch_addPadding (patches: PatchObj[]): string {
    const paddingLength = this.patchMargin
    let nullPadding = ''
    for (let x = 1; x <= paddingLength; x++) {
      nullPadding += String.fromCharCode(x)
    }

    // Bump all the patches forward.
    for (const patch of patches) {
      patch.start1 = (patch.start1 ?? 0) + paddingLength
      patch.start2 = (patch.start2 ?? 0) + paddingLength
    }

    // Add some padding on start of first diff.
    let patch = patches[0]
    let diffs = patch.diffs
    if (diffs.length === 0 || diffs[0][0] !== Operation.DIFF_EQUAL) {
      // Add nullPadding equality.
      diffs.unshift([Operation.DIFF_EQUAL, nullPadding])
      patch.start1 = (patch.start1 ?? 0) - paddingLength // Should be 0.
      patch.start2 = (patch.start2 ?? 0) - paddingLength // Should be 0.
      patch.length1 += paddingLength
      patch.length2 += paddingLength
    } else if (paddingLength > diffs[0][1].length) {
      // Grow first equality.
      const extraLength = paddingLength - diffs[0][1].length
      diffs[0][1] = nullPadding.substring(diffs[0][1].length) + diffs[0][1]
      patch.start1 = (patch.start1 ?? 0) - extraLength
      patch.start2 = (patch.start2 ?? 0) - extraLength
      patch.length1 += extraLength
      patch.length2 += extraLength
    }

    // Add some padding on end of last diff.
    patch = patches[patches.length - 1]
    diffs = patch.diffs
    if (diffs.length === 0 || diffs[diffs.length - 1][0] !== Operation.DIFF_EQUAL) {
      // Add nullPadding equality.
      diffs.push([Operation.DIFF_EQUAL, nullPadding])
      patch.length1 += paddingLength
      patch.length2 += paddingLength
    } else if (paddingLength > diffs[diffs.length - 1][1].length) {
      // Grow last equality.
      const extraLength = paddingLength - diffs[diffs.length - 1][1].length
      diffs[diffs.length - 1][1] += nullPadding.substring(0, extraLength)
      patch.length1 += extraLength
      patch.length2 += extraLength
    }

    return nullPadding
  }

  /**
   * Look through the patches and break up any which are longer than the maximum
   * limit of the match algorithm.
   * Intended to be called only from within patch_apply.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   */
  patch_splitMax (patches: PatchObj[]): void {
    const patchSize = this.matchMaxBits
    for (let x = 0; x < patches.length; x++) {
      if (patches[x].length1 <= patchSize) {
        continue
      }
      const bigpatch = patches[x]
      // Remove the big old patch.
      patches.splice(x--, 1)
      let start1 = bigpatch.start1 ?? 0
      let start2 = bigpatch.start2 ?? 0
      let precontext = ''
      while (bigpatch.diffs.length !== 0) {
      // Create one of several smaller patches.
        const patch = new PatchObj()
        let empty = true
        patch.start1 = start1 - precontext.length
        patch.start2 = start2 - precontext.length
        if (precontext !== '') {
          patch.length1 = patch.length2 = precontext.length
          patch.diffs.push([Operation.DIFF_EQUAL, precontext])
        }
        while (
          bigpatch.diffs.length !== 0 &&
          patch.length1 < patchSize - this.patchMargin
        ) {
          const diffType = bigpatch.diffs[0][0]
          let diffText = bigpatch.diffs[0][1]
          if (diffType === Operation.DIFF_INSERT) {
          // Insertions are harmless.
            patch.length2 += diffText.length
            start2 += diffText.length
            const p = bigpatch.diffs.shift()
            if (p !== undefined) {
              patch.diffs.push(p)
            }
            empty = false
          } else if (
            diffType === Operation.DIFF_DELETE &&
            patch.diffs.length === 1 &&
                   patch.diffs[0][0] === Operation.DIFF_EQUAL &&
                   diffText.length > 2 * patchSize
          ) {
            // This is a large deletion.  Let it pass in one chunk.
            patch.length1 += diffText.length
            start1 += diffText.length
            empty = false
            patch.diffs.push([diffType, diffText])
            bigpatch.diffs.shift()
          } else {
            // Deletion or equality.  Only take as much as we can stomach.
            diffText = diffText.substring(0,
              patchSize - patch.length1 - this.patchMargin)
            patch.length1 += diffText.length
            start1 += diffText.length
            if (diffType === Operation.DIFF_EQUAL) {
              patch.length2 += diffText.length
              start2 += diffText.length
            } else {
              empty = false
            }
            patch.diffs.push([diffType, diffText])
            if (diffText === bigpatch.diffs[0][1]) {
              bigpatch.diffs.shift()
            } else {
              bigpatch.diffs[0][1] =
                bigpatch.diffs[0][1].substring(diffText.length)
            }
          }
        }
        // Compute the head context for the next patch.
        precontext = this.diff_text2(patch.diffs)
        precontext =
          precontext.substring(precontext.length - this.patchMargin)
        // Append the end context for this patch.
        const postcontext = this.diff_text1(bigpatch.diffs)
          .substring(0, this.patchMargin)
        if (postcontext !== '') {
          patch.length1 += postcontext.length
          patch.length2 += postcontext.length
          if (patch.diffs.length !== 0 &&
            patch.diffs[patch.diffs.length - 1][0] === Operation.DIFF_EQUAL) {
            patch.diffs[patch.diffs.length - 1][1] += postcontext
          } else {
            patch.diffs.push([Operation.DIFF_EQUAL, postcontext])
          }
        }
        if (!empty) {
          patches.splice(++x, 0, patch)
        }
      }
    }
  }

  /**
   * Take a list of patches and return a textual representation.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @return {string} Text representation of patches.
   */
  patch_toText (patches: PatchObj[]): string {
    const text = []
    for (let x = 0; x < patches.length; x++) {
      text[x] = patches[x]
    }
    return text.join('')
  }

  /**
   * Parse a textual representation of patches and return a list of PatchObj objects.
   * @param {string} textline Text representation of patches.
   * @return {PatchObj[]} Array of PatchObj objects.
   * @throws {!Error} If invalid input.
   */
  patch_fromText (textline: string): PatchObj[] {
    const patches: PatchObj[] = []
    if (typeof textline !== 'string' || textline === '') {
      return patches
    }
    const text = textline.split('\n')
    let textPointer = 0
    const patchHeader = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@$/
    while (textPointer < text.length) {
      const m = text[textPointer].match(patchHeader)
      if (m == null) {
        throw new Error('Invalid patch string: ' + text[textPointer])
      }
      const patch = new PatchObj()
      patches.push(patch)
      patch.start1 = parseInt(m[1], 10)
      if (m[2] === '') {
        patch.start1--
        patch.length1 = 1
      } else if (m[2] === '0') {
        patch.length1 = 0
      } else {
        patch.start1--
        patch.length1 = parseInt(m[2], 10)
      }

      patch.start2 = parseInt(m[3], 10)
      if (m[4] === '') {
        patch.start2--
        patch.length2 = 1
      } else if (m[4] === '0') {
        patch.length2 = 0
      } else {
        patch.start2--
        patch.length2 = parseInt(m[4], 10)
      }
      textPointer++

      while (textPointer < text.length) {
        const sign = text[textPointer].charAt(0)
        let line
        try {
          line = decodeURI(text[textPointer].substring(1))
        } catch (ex) {
          // Malformed URI sequence.
          throw new Error(`Illegal escape in patch_fromText: ${line ?? ''}`)
        }
        if (sign === '-') {
          // Deletion.
          patch.diffs.push([Operation.DIFF_DELETE, line])
        } else if (sign === '+') {
          // Insertion.
          patch.diffs.push([Operation.DIFF_INSERT, line])
        } else if (sign === ' ') {
          // Minor equality.
          patch.diffs.push([Operation.DIFF_EQUAL, line])
        } else if (sign === '@') {
          // Start of next patch.
          break
        } else if (sign === '') {
          // Blank line?  Whatever.
        } else {
          // WTF?
          throw new Error('Invalid patch mode "' + sign + '" in: ' + line)
        }
        textPointer++
      }
    }
    return patches
  }
}
