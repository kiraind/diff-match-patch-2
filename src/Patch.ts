import Diff from './Diff'
import Match from './Match'
import PatchObj from './PatchObj'
import DiffObj from './types/DiffObj'
import Operation from './types/Operation'

export interface PatchParams {
  /**
   * When deleting a large block of text (over ~64 characters), how close do
   * the contents have to be to match the expected contents. (0.0 = perfection,
   * 1.0 = very loose).  Note that matchThreshold controls how closely the
   * end points of a delete need to match.
   */
  deleteThreshold?: number
  /** Chunk size for context length. */
  margin?: number
}

/**
 * Class containing patch methods.
 */
export default class Patch {
  private readonly diff: Diff
  private readonly match: Match

  deleteThreshold: number
  margin: number

  constructor (
    diff: Diff,
    match: Match,
    { deleteThreshold, margin }: PatchParams = {}
  ) {
    this.diff = diff
    this.match = match

    this.deleteThreshold = deleteThreshold ?? 0.5
    this.margin = margin ?? 4
  }

  //  PATCH FUNCTIONS

  /**
   * Increase the context until it is unique,
   * but don't let the pattern expand beyond matchMaxBits.
   * @param {PatchObj} patch The patch to grow.
   * @param {string} text Source text.
   * @private
   */
  addContext (patch: PatchObj, text: string): void {
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
         pattern.length < this.match.maxBits - this.margin -
         this.margin) {
      padding += this.margin
      pattern = text.substring(patch.start2 - padding,
        patch.start2 + patch.length1 + padding)
    }
    // Add one chunk for good luck.
    padding += this.margin

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
   * @param {string|DiffObj[]} a text1 (methods 1,3,4) or
   * Array of diff tuples for text1 to text2 (method 2).
   * @param {string|DiffObj[]} b text2 (methods 1,4) or
   * Array of diff tuples for text1 to text2 (method 3) or undefined (method 2).
   * @param {string|DiffObj[]} c Array of diff tuples
   * for text1 to text2 (method 4) or undefined (methods 1,2,3).
   * @return {PatchObj[]} Array of PatchObj objects.
   */
  make (
    text1: string,
    text2: string
  ): PatchObj[]
  make (
    diffs: DiffObj[]
  ): PatchObj[]
  make (
    text1: string,
    diffs: DiffObj[]
  ): PatchObj[]
  make (
    text1: string,
    text2: string,
    diffs: DiffObj[]
  ): PatchObj[]
  make (
    a: string | DiffObj[],
    b?: string | DiffObj[],
    c?: string | DiffObj[]
  ): PatchObj[] {
    let text1: string, diffs: DiffObj[]
    if (
      typeof a === 'string' &&
      typeof b === 'string' &&
      typeof c === 'undefined'
    ) {
      // Method 1: text1, text2
      // Compute diffs from text1 and text2.
      text1 = a
      diffs = this.diff.main(text1, b, true)
      if (diffs.length > 2) {
        this.diff.cleanupSemantic(diffs)
        this.diff.cleanupEfficiency(diffs)
      }
    } else if (
      a !== null && typeof a === 'object' &&
      typeof b === 'undefined' &&
      typeof c === 'undefined'
    ) {
      // Method 2: diffs
      // Compute text1 from diffs.
      diffs = a
      text1 = this.diff.text1(diffs)
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
      throw new Error('Unknown call format to make.')
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
            diffText.length <= 2 * this.margin &&
            patchDiffLength !== 0 &&
            diffs.length !== x + 1
          ) {
            // Small equality inside a patch.
            patch.diffs[patchDiffLength++] = diffs[x]
            patch.length1 += diffText.length
            patch.length2 += diffText.length
          } else if (diffText.length >= 2 * this.margin) {
            // Time for a new patch.
            if (patchDiffLength !== 0) {
              this.addContext(patch, prepatchText)
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
      this.addContext(patch, prepatchText)
      patches.push(patch)
    }

    return patches
  }

  /**
   * Given an array of patches, return another array that is identical.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @return {PatchObj[]} Array of PatchObj objects.
   */
  deepCopy (patches: PatchObj[]): PatchObj[] {
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
  apply (patches: PatchObj[], text: string): [string, boolean[]] {
    if (patches.length === 0) {
      return [text, []]
    }

    // Deep copy the patches so that no changes are made to originals.
    patches = this.deepCopy(patches)

    const nullPadding = this.addPadding(patches)
    text = nullPadding + text + nullPadding

    this.splitMax(patches)
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
      const text1 = this.diff.text1(patch.diffs)
      let startLoc
      let endLoc = -1
      if (text1.length > this.match.maxBits) {
        // splitMax will only provide an oversized pattern in the case of
        // a monster delete.
        startLoc = this.match.main(text, text1.substring(0, this.match.maxBits),
          expectedLoc)
        if (startLoc !== -1) {
          endLoc = this.match.main(text,
            text1.substring(text1.length - this.match.maxBits),
            expectedLoc + text1.length - this.match.maxBits)
          if (endLoc === -1 || startLoc >= endLoc) {
            // Can't find valid trailing context.  Drop this patch.
            startLoc = -1
          }
        }
      } else {
        startLoc = this.match.main(text, text1, expectedLoc)
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
          text2 = text.substring(startLoc, endLoc + this.match.maxBits)
        }
        if (text1 === text2) {
          // Perfect match, just shove the replacement text in.
          text = text.substring(0, startLoc) +
               this.diff.text2(patch.diffs) +
               text.substring(startLoc + text1.length)
        } else {
          // Imperfect match.  Run a diff to get a framework of equivalent
          // indices.
          const diffs = this.diff.main(text1, text2, false)
          if (text1.length > this.match.maxBits &&
            this.diff.levenshtein(diffs) / text1.length >
            this.deleteThreshold) {
            // The end points match, but the content is unacceptably bad.
            results[x] = false
          } else {
            this.diff.cleanupSemanticLossless(diffs)
            let index1 = 0
            let index2 = 0
            for (let y = 0; y < patch.diffs.length; y++) {
              const mod = patch.diffs[y]
              if (mod[0] !== Operation.DIFF_EQUAL) {
                index2 = this.diff.xIndex(diffs, index1)
              }
              if (mod[0] === Operation.DIFF_INSERT) { // Insertion
                text = text.substring(0, startLoc + index2) + mod[1] +
                     text.substring(startLoc + index2)
              } else if (mod[0] === Operation.DIFF_DELETE) { // Deletion
                text = text.substring(0, startLoc + index2) +
                     text.substring(startLoc + this.diff.xIndex(diffs,
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
   * Intended to be called only from within apply.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   * @return {string} The padding string added to each side.
   */
  addPadding (patches: PatchObj[]): string {
    const paddingLength = this.margin
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
   * Intended to be called only from within apply.
   * @param {PatchObj[]} patches Array of PatchObj objects.
   */
  splitMax (patches: PatchObj[]): void {
    const patchSize = this.match.maxBits
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
          patch.length1 < patchSize - this.margin
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
              patchSize - patch.length1 - this.margin)
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
        precontext = this.diff.text2(patch.diffs)
        precontext =
          precontext.substring(precontext.length - this.margin)
        // Append the end context for this patch.
        const postcontext = this.diff.text1(bigpatch.diffs)
          .substring(0, this.margin)
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
  toText (patches: PatchObj[]): string {
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
  fromText (textline: string): PatchObj[] {
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
          throw new Error(`Illegal escape in fromText: ${line ?? ''}`)
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
